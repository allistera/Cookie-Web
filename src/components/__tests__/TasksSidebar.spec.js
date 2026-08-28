import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import TasksSidebar from '../TasksSidebar.vue'
import { useProjectsStore } from '../../stores/projects'

let router

function mountSidebar() {
  return mount(TasksSidebar, { global: { plugins: [router] } })
}

beforeEach(async () => {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/tasks', name: 'tasks', component: { template: '<div />' } }],
  })
  await router.push('/tasks')
  await router.isReady()
  setActivePinia(createPinia())

  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ projects: [] }) })),
  )
})

describe('TasksSidebar', () => {
  it('offers Add Task and an Inbox above the projects section', () => {
    const wrapper = mountSidebar()

    expect(wrapper.get('.compose-btn').text()).toContain('Add Task')
    const inbox = wrapper.get('.tasks-views-nav .nav-item')
    expect(inbox.text()).toContain('Inbox')
    expect(inbox.attributes('href')).toBe('/tasks?project=inbox')
    expect(wrapper.get('.sb-section-label > span').text()).toBe('My Projects')
  })

  // Inbox is the no-project bucket, so it must never appear as a project row
  // that could be renamed or deleted alongside the real ones.
  it('keeps Inbox out of the projects list', async () => {
    const store = useProjectsStore()
    store.projects = [{ id: 'p1', parentId: null, name: 'Work' }]
    store.isLoaded = true

    const wrapper = mountSidebar()
    await flushPromises()

    const names = wrapper.findAll('.tasks-projects-nav .nav-text').map((row) => row.text())
    expect(names).toEqual(['Work'])
    expect(names).not.toContain('Inbox')
  })

  it('nests a sub-project under its expanded parent', async () => {
    const store = useProjectsStore()
    store.projects = [
      { id: 'p1', parentId: null, name: 'Work' },
      { id: 'p2', parentId: 'p1', name: 'API' },
    ]
    store.isLoaded = true

    const wrapper = mountSidebar()
    await flushPromises()
    expect(wrapper.findAll('.tasks-projects-nav .nav-item')).toHaveLength(1)

    await wrapper.get('.project-arrow').trigger('click')

    const rows = wrapper.findAll('.tasks-projects-nav .nav-item')
    expect(rows).toHaveLength(2)
    expect(rows[1].text()).toContain('API')
    expect(rows[1].attributes('style')).toContain('padding-left: 24px')
  })

  it('shows the empty hint when there are no projects', async () => {
    const wrapper = mountSidebar()
    await flushPromises()
    expect(wrapper.get('.tasks-projects-empty').text()).toBe('No projects yet')
  })

  it('marks Inbox active only when the route selects it', async () => {
    const wrapper = mountSidebar()
    expect(wrapper.get('.tasks-views-nav .nav-item').classes()).not.toContain('active')

    await router.push('/tasks?project=inbox')
    await wrapper.vm.$nextTick()

    expect(wrapper.get('.tasks-views-nav .nav-item').classes()).toContain('active')
  })

  it('creates a project from the inline row', async () => {
    const store = useProjectsStore()
    store.isLoaded = true
    const create = vi.spyOn(store, 'createProject').mockResolvedValue({
      id: 'p1',
      parentId: null,
      name: 'Work',
    })

    const wrapper = mountSidebar()
    await flushPromises()
    await wrapper.get('.new-project-btn').trigger('click')
    await wrapper.get('.new-project-row input').setValue('Work')
    await wrapper.get('.new-project-row').trigger('submit')

    expect(create).toHaveBeenCalledWith({ name: 'Work', parentId: null })
  })

  // Same Enter-then-blur double-fire as rename below: Enter commits and
  // unmounts the input, which fires blur, re-entering the same handler.
  it('creates a project once when Enter is followed by blur', async () => {
    const store = useProjectsStore()
    store.isLoaded = true
    const create = vi.spyOn(store, 'createProject').mockResolvedValue({
      id: 'p1',
      parentId: null,
      name: 'Work',
    })

    const wrapper = mountSidebar()
    await flushPromises()
    await wrapper.get('.new-project-btn').trigger('click')
    const input = wrapper.get('.new-project-row input')
    await input.setValue('Work')
    await input.trigger('keydown.enter')
    await input.trigger('blur')

    expect(create).toHaveBeenCalledTimes(1)
  })

  // Enter commits and unmounts the input, which fires blur: without a guard
  // the same rename would be submitted twice.
  it('submits a rename once when Enter is followed by blur', async () => {
    const store = useProjectsStore()
    store.projects = [{ id: 'p1', parentId: null, name: 'Work' }]
    store.isLoaded = true
    const rename = vi.spyOn(store, 'renameProject').mockResolvedValue(null)

    const wrapper = mountSidebar()
    await flushPromises()
    await wrapper.get('.project-item').trigger('dblclick')
    const input = wrapper.get('.project-rename-input')
    await input.setValue('Renamed')
    await input.trigger('keydown.enter')
    await input.trigger('blur')

    expect(rename).toHaveBeenCalledTimes(1)
    expect(rename).toHaveBeenCalledWith('p1', 'Renamed')
  })

  it('confirms before deleting a project that has children', async () => {
    const store = useProjectsStore()
    store.projects = [
      { id: 'p1', parentId: null, name: 'Work' },
      { id: 'p2', parentId: 'p1', name: 'API' },
    ]
    store.isLoaded = true
    const remove = vi.spyOn(store, 'deleteProject').mockResolvedValue(true)
    const confirm = vi.fn(() => false)
    vi.stubGlobal('confirm', confirm)

    const wrapper = mountSidebar()
    await flushPromises()
    await wrapper.get('.project-item .row-action-btn[data-action="delete"]').trigger('click')

    expect(confirm).toHaveBeenCalledWith('Delete Work and its 1 sub-project?')
    expect(remove).not.toHaveBeenCalled()
  })

  it('counts the whole subtree, not just direct children, before deleting', async () => {
    const store = useProjectsStore()
    store.projects = [
      { id: 'p1', parentId: null, name: 'Work' },
      { id: 'p2', parentId: 'p1', name: 'Clients' },
      { id: 'p3', parentId: 'p2', name: 'Acme' },
    ]
    store.isLoaded = true
    const remove = vi.spyOn(store, 'deleteProject').mockResolvedValue(true)
    const confirm = vi.fn(() => false)
    vi.stubGlobal('confirm', confirm)

    const wrapper = mountSidebar()
    await flushPromises()
    await wrapper.get('.project-item .row-action-btn[data-action="delete"]').trigger('click')

    expect(confirm).toHaveBeenCalledWith('Delete Work and its 2 sub-projects?')
    expect(remove).not.toHaveBeenCalled()
  })

  it('deletes a childless project without asking', async () => {
    const store = useProjectsStore()
    store.projects = [{ id: 'p1', parentId: null, name: 'Work' }]
    store.isLoaded = true
    const remove = vi.spyOn(store, 'deleteProject').mockResolvedValue(true)
    const confirm = vi.fn(() => true)
    vi.stubGlobal('confirm', confirm)

    const wrapper = mountSidebar()
    await flushPromises()
    await wrapper.get('.project-item .row-action-btn[data-action="delete"]').trigger('click')

    expect(confirm).not.toHaveBeenCalled()
    expect(remove).toHaveBeenCalledWith('p1')
  })

  it('re-parents a project when dropped onto another', async () => {
    const store = useProjectsStore()
    store.projects = [
      { id: 'p1', parentId: null, name: 'Work' },
      { id: 'p2', parentId: null, name: 'Admin' },
    ]
    store.isLoaded = true
    const move = vi.spyOn(store, 'moveProject').mockResolvedValue(null)

    const wrapper = mountSidebar()
    await flushPromises()
    const rows = wrapper.findAll('.project-item')
    const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn() }

    // Rows render alphabetically, so Admin is first and Work second.
    await rows[0].trigger('dragstart', { dataTransfer })
    await rows[1].trigger('dragover', { dataTransfer })
    await rows[1].trigger('drop')

    expect(move).toHaveBeenCalledWith('p2', 'p1')
  })

  it('ignores a drop onto the row being dragged', async () => {
    const store = useProjectsStore()
    store.projects = [{ id: 'p1', parentId: null, name: 'Work' }]
    store.isLoaded = true
    const move = vi.spyOn(store, 'moveProject').mockResolvedValue(null)

    const wrapper = mountSidebar()
    await flushPromises()
    const row = wrapper.get('.project-item')
    const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn() }

    await row.trigger('dragstart', { dataTransfer })
    await row.trigger('drop')

    expect(move).not.toHaveBeenCalled()
  })
})
