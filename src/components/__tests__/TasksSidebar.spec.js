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
    expect(wrapper.get('.sb-section-label').text()).toBe('My Projects')
  })

  // Inbox is the no-project bucket, so it must never appear as a project row
  // that could be renamed or deleted alongside the real ones.
  it('keeps Inbox out of the projects list', async () => {
    const store = useProjectsStore()
    store.projects = [{ id: 'p1', parentId: null, name: 'Work' }]
    store.isLoaded = true

    const wrapper = mountSidebar()
    await flushPromises()

    const names = wrapper.findAll('.tasks-projects-nav .nav-item').map((row) => row.text())
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
})
