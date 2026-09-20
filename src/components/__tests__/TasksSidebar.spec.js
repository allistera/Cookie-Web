import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import TasksSidebar from '../TasksSidebar.vue'
import { useProjectsStore } from '../../stores/projects'
import { localToday } from '../../lib/localDate'
import { useTaskItemsStore } from '../../stores/taskItems'
import { useTaskLabelsStore } from '../../stores/taskLabels'

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
    vi.fn(async () => ({ ok: true, json: async () => ({ projects: [], labels: [] }) })),
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

  // Today is the default view: TasksView renders it for a bare /tasks, so the
  // sidebar has to highlight it there while keeping explicit Inbox working.
  it('marks Today active for a bare /tasks and Inbox active when explicitly selected', async () => {
    const wrapper = mountSidebar()
    const [inbox, today] = wrapper.findAll('.tasks-views-nav .nav-item')
    expect(today.classes()).toContain('active')
    expect(inbox.classes()).not.toContain('active')

    await router.push('/tasks?project=inbox')
    await wrapper.vm.$nextTick()

    expect(inbox.classes()).toContain('active')
    expect(today.classes()).not.toContain('active')
  })

  it('drops the Inbox highlight once a project is selected', async () => {
    const store = useProjectsStore()
    store.isLoaded = true
    store.projects = [{ id: 'p1', name: 'Roof', parentId: null, position: 0 }]
    const wrapper = mountSidebar()

    await router.push('/tasks?project=p1')
    await wrapper.vm.$nextTick()

    expect(wrapper.get('.tasks-views-nav .nav-item').classes()).not.toContain('active')
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
    vi.spyOn(useTaskItemsStore(), 'countForProjects').mockResolvedValue(0)
    const confirm = vi.fn(() => false)
    vi.stubGlobal('confirm', confirm)

    const wrapper = mountSidebar()
    await flushPromises()
    await wrapper.get('.project-item .row-action-btn[data-action="delete"]').trigger('click')
    await flushPromises()

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
    vi.spyOn(useTaskItemsStore(), 'countForProjects').mockResolvedValue(0)
    const confirm = vi.fn(() => false)
    vi.stubGlobal('confirm', confirm)

    const wrapper = mountSidebar()
    await flushPromises()
    await wrapper.get('.project-item .row-action-btn[data-action="delete"]').trigger('click')
    await flushPromises()

    expect(confirm).toHaveBeenCalledWith('Delete Work and its 2 sub-projects?')
    expect(remove).not.toHaveBeenCalled()
  })

  it('deletes a project with no sub-projects and no tasks without asking', async () => {
    const store = useProjectsStore()
    store.projects = [{ id: 'p1', parentId: null, name: 'Work' }]
    store.isLoaded = true
    const remove = vi.spyOn(store, 'deleteProject').mockResolvedValue(true)
    vi.spyOn(useTaskItemsStore(), 'countForProjects').mockResolvedValue(0)
    const confirm = vi.fn(() => true)
    vi.stubGlobal('confirm', confirm)

    const wrapper = mountSidebar()
    await flushPromises()
    await wrapper.get('.project-item .row-action-btn[data-action="delete"]').trigger('click')
    await flushPromises()

    expect(confirm).not.toHaveBeenCalled()
    expect(remove).toHaveBeenCalledWith('p1')
  })

  // The critical case: a project with no sub-projects at all can still lose
  // tasks with a single click if the confirm is gated only on sub-project
  // count. It must prompt, and must name the tasks.
  it('confirms before deleting a childless project that has tasks', async () => {
    const store = useProjectsStore()
    store.projects = [{ id: 'p1', parentId: null, name: 'Work' }]
    store.isLoaded = true
    const remove = vi.spyOn(store, 'deleteProject').mockResolvedValue(true)
    const count = vi.spyOn(useTaskItemsStore(), 'countForProjects').mockResolvedValue(7)
    const confirm = vi.fn(() => false)
    vi.stubGlobal('confirm', confirm)

    const wrapper = mountSidebar()
    await flushPromises()
    await wrapper.get('.project-item .row-action-btn[data-action="delete"]').trigger('click')
    await flushPromises()

    expect(count).toHaveBeenCalledWith(['p1'])
    expect(confirm).toHaveBeenCalledWith('Delete Work and its 7 tasks?')
    expect(remove).not.toHaveBeenCalled()
  })

  it('names a single task in the singular', async () => {
    const store = useProjectsStore()
    store.projects = [{ id: 'p1', parentId: null, name: 'Work' }]
    store.isLoaded = true
    vi.spyOn(store, 'deleteProject').mockResolvedValue(true)
    vi.spyOn(useTaskItemsStore(), 'countForProjects').mockResolvedValue(1)
    const confirm = vi.fn(() => false)
    vi.stubGlobal('confirm', confirm)

    const wrapper = mountSidebar()
    await flushPromises()
    await wrapper.get('.project-item .row-action-btn[data-action="delete"]').trigger('click')
    await flushPromises()

    expect(confirm).toHaveBeenCalledWith('Delete Work and its 1 task?')
  })

  it('names both sub-projects and tasks when a project has both', async () => {
    const store = useProjectsStore()
    store.projects = [
      { id: 'p1', parentId: null, name: 'Work' },
      { id: 'p2', parentId: 'p1', name: 'API' },
    ]
    store.isLoaded = true
    vi.spyOn(store, 'deleteProject').mockResolvedValue(true)
    const count = vi.spyOn(useTaskItemsStore(), 'countForProjects').mockResolvedValue(7)
    const confirm = vi.fn(() => false)
    vi.stubGlobal('confirm', confirm)

    const wrapper = mountSidebar()
    await flushPromises()
    await wrapper.get('.project-item .row-action-btn[data-action="delete"]').trigger('click')
    await flushPromises()

    expect(count).toHaveBeenCalledWith(['p1', 'p2'])
    expect(confirm).toHaveBeenCalledWith('Delete Work and its 1 sub-project and 7 tasks?')
  })

  it('routes to the Inbox when the deleted project is the one being viewed', async () => {
    router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/tasks', name: 'tasks', component: { template: '<div />' } }],
    })
    await router.push('/tasks?project=p1')
    await router.isReady()

    const store = useProjectsStore()
    store.projects = [{ id: 'p1', parentId: null, name: 'Work' }]
    store.isLoaded = true
    vi.spyOn(store, 'deleteProject').mockResolvedValue(true)
    vi.spyOn(useTaskItemsStore(), 'countForProjects').mockResolvedValue(0)

    const wrapper = mountSidebar()
    await flushPromises()
    await wrapper.get('.project-item .row-action-btn[data-action="delete"]').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.fullPath).toBe('/tasks?project=inbox')
  })

  it('routes to the Inbox when a deleted descendant is the one being viewed', async () => {
    router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/tasks', name: 'tasks', component: { template: '<div />' } }],
    })
    await router.push('/tasks?project=p2')
    await router.isReady()

    const store = useProjectsStore()
    store.projects = [
      { id: 'p1', parentId: null, name: 'Work' },
      { id: 'p2', parentId: 'p1', name: 'API' },
    ]
    store.isLoaded = true
    vi.spyOn(store, 'deleteProject').mockResolvedValue(true)
    vi.spyOn(useTaskItemsStore(), 'countForProjects').mockResolvedValue(0)
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    )

    const wrapper = mountSidebar()
    await flushPromises()
    await wrapper.get('.project-item .row-action-btn[data-action="delete"]').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.fullPath).toBe('/tasks?project=inbox')
  })

  it('does not navigate when the deleted project is unrelated to the one being viewed', async () => {
    router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/tasks', name: 'tasks', component: { template: '<div />' } }],
    })
    await router.push('/tasks?project=other')
    await router.isReady()

    const store = useProjectsStore()
    store.projects = [{ id: 'p1', parentId: null, name: 'Work' }]
    store.isLoaded = true
    vi.spyOn(store, 'deleteProject').mockResolvedValue(true)
    vi.spyOn(useTaskItemsStore(), 'countForProjects').mockResolvedValue(0)

    const wrapper = mountSidebar()
    await flushPromises()
    await wrapper.get('.project-item .row-action-btn[data-action="delete"]').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.fullPath).toBe('/tasks?project=other')
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

// A task row dragged out of the list carries its id under a MIME type of its
// own; the sidebar tells such a drag from a project drag by that type.
describe('dropping a task from the list', () => {
  const taskTransfer = (id) => ({
    types: ['application/x-cookie-task', 'text/plain'],
    dropEffect: '',
    getData: vi.fn(() => id),
  })

  it('moves the task into the project it is dropped on', async () => {
    const store = useProjectsStore()
    store.projects = [{ id: 'p1', parentId: null, name: 'Work' }]
    store.isLoaded = true
    const moveProject = vi.spyOn(store, 'moveProject').mockResolvedValue(null)
    const moveItem = vi.spyOn(useTaskItemsStore(), 'moveItem').mockResolvedValue(null)

    const wrapper = mountSidebar()
    await flushPromises()
    const row = wrapper.get('.project-item')
    const dataTransfer = taskTransfer('t1')

    await row.trigger('dragover', { dataTransfer })
    expect(row.classes()).toContain('drop-target')
    await row.trigger('drop', { dataTransfer })

    expect(moveItem).toHaveBeenCalledWith('t1', 'p1')
    expect(moveProject).not.toHaveBeenCalled()
    expect(row.classes()).not.toContain('drop-target')
  })

  it('moves the task to the Inbox when dropped on it', async () => {
    const moveItem = vi.spyOn(useTaskItemsStore(), 'moveItem').mockResolvedValue(null)
    const wrapper = mountSidebar()
    const inbox = wrapper.findAll('.tasks-views-nav .nav-item')[0]
    const dataTransfer = taskTransfer('t1')

    await inbox.trigger('dragover', { dataTransfer })
    expect(inbox.classes()).toContain('drop-target')
    await inbox.trigger('drop', { dataTransfer })

    expect(moveItem).toHaveBeenCalledWith('t1', null)
  })

  it('makes the task due today when dropped on Today', async () => {
    const setDueDate = vi.spyOn(useTaskItemsStore(), 'setDueDate').mockResolvedValue(null)
    const wrapper = mountSidebar()
    const today = wrapper.findAll('.tasks-views-nav .nav-item')[1]
    const dataTransfer = taskTransfer('t1')

    await today.trigger('dragover', { dataTransfer })
    await today.trigger('drop', { dataTransfer })

    expect(setDueDate).toHaveBeenCalledWith('t1', localToday())
  })

  // A divider has no date to set; Today refuses it in the air and on landing.
  it('refuses a divider dropped on Today', async () => {
    const setDueDate = vi.spyOn(useTaskItemsStore(), 'setDueDate').mockResolvedValue(null)
    const wrapper = mountSidebar()
    const today = wrapper.findAll('.tasks-views-nav .nav-item')[1]
    const dataTransfer = taskTransfer('d1')
    dataTransfer.types.push('application/x-cookie-divider')

    await today.trigger('dragover', { dataTransfer })
    expect(today.classes()).not.toContain('drop-target')
    await today.trigger('drop', { dataTransfer })

    expect(setDueDate).not.toHaveBeenCalled()
  })

  // The My Projects label is the root target for project re-parenting; a
  // task has nowhere to go there, so it must not silently land in the Inbox.
  it('ignores a task dropped on the My Projects label', async () => {
    const moveItem = vi.spyOn(useTaskItemsStore(), 'moveItem').mockResolvedValue(null)
    const wrapper = mountSidebar()
    const label = wrapper.get('.tasks-projects-label')
    const dataTransfer = taskTransfer('t1')

    await label.trigger('dragover', { dataTransfer })
    expect(label.classes()).not.toContain('drop-target')
    await label.trigger('drop', { dataTransfer })

    expect(moveItem).not.toHaveBeenCalled()
  })

  it('leaves a project drag to the project handlers', async () => {
    const moveItem = vi.spyOn(useTaskItemsStore(), 'moveItem').mockResolvedValue(null)
    const wrapper = mountSidebar()
    const inbox = wrapper.findAll('.tasks-views-nav .nav-item')[0]
    const dataTransfer = { types: ['text/plain'], dropEffect: '', getData: vi.fn(() => 'p1') }

    await inbox.trigger('dragover', { dataTransfer })
    expect(inbox.classes()).not.toContain('drop-target')
    await inbox.trigger('drop', { dataTransfer })

    expect(moveItem).not.toHaveBeenCalled()
  })
})

describe('the Today view', () => {
  it('lists Today under Inbox', async () => {
    const wrapper = mountSidebar()
    await flushPromises()

    const links = wrapper.findAll('.tasks-views-nav .nav-item')
    expect(links.map((link) => link.get('.nav-text').text())).toEqual(['Inbox', 'Today'])
    expect(links[1].attributes('href')).toBe('/tasks?project=today')
  })

  it('marks Today active for the bare route and when the route selects it', async () => {
    const wrapper = mountSidebar()
    const today = () => wrapper.findAll('.tasks-views-nav .nav-item')[1]
    expect(today().classes()).toContain('active')

    await router.push('/tasks?project=today')
    await wrapper.vm.$nextTick()

    expect(today().classes()).toContain('active')
    expect(wrapper.findAll('.tasks-views-nav .nav-item')[0].classes()).not.toContain('active')
  })
})

describe('the Add Task button', () => {
  it('shows no dialog until the button is pressed', async () => {
    const wrapper = mountSidebar()
    await flushPromises()

    expect(wrapper.findComponent({ name: 'AddTaskDialog' }).exists()).toBe(false)
  })

  it('opens the Add Task dialog', async () => {
    const wrapper = mountSidebar()
    await flushPromises()

    await wrapper.get('.compose-btn').trigger('click')

    expect(wrapper.findComponent({ name: 'AddTaskDialog' }).exists()).toBe(true)
  })

  it('closes the dialog when it asks to be closed', async () => {
    const wrapper = mountSidebar()
    await flushPromises()
    await wrapper.get('.compose-btn').trigger('click')

    await wrapper.findComponent({ name: 'AddTaskDialog' }).vm.$emit('close')

    expect(wrapper.findComponent({ name: 'AddTaskDialog' }).exists()).toBe(false)
  })
})

describe('the Labels section', () => {
  function seedLabels(labels) {
    const store = useTaskLabelsStore()
    store.labels = labels
    store.isLoaded = true
    return store
  }

  it('lists labels with their colour, linking to the label view', async () => {
    seedLabels([
      { id: 'l1', name: 'home', color: '#1a73e8', taskCount: 2 },
      { id: 'l2', name: 'work', color: '#e5484d', taskCount: 0 },
    ])
    const wrapper = mountSidebar()
    await flushPromises()

    const rows = wrapper.findAll('.tasks-labels-nav .label-item')
    expect(rows.map((row) => row.get('.nav-text').text())).toEqual(['home', 'work'])
    expect(rows[0].attributes('href')).toBe('/tasks?project=label:home')
    expect(rows[0].get('.label-dot').attributes('style')).toContain('rgb(26, 115, 232)')
  })

  it('marks the viewed label active', async () => {
    seedLabels([{ id: 'l1', name: 'home', color: '#1a73e8', taskCount: 0 }])
    await router.push('/tasks?project=label:home')
    const wrapper = mountSidebar()
    await flushPromises()

    expect(wrapper.get('.label-item').classes()).toContain('active')
    expect(wrapper.get('.tasks-views-nav .nav-item').classes()).not.toContain('active')
  })

  it('creates a label from the inline row, once, with the name normalised', async () => {
    const store = seedLabels([])
    const create = vi.spyOn(store, 'createLabel').mockResolvedValue({ id: 'l1', name: 'home' })
    const wrapper = mountSidebar()
    await flushPromises()

    await wrapper.get('[aria-label="New label"]').trigger('click')
    const input = wrapper.get('[aria-label="New label name"]')
    await input.setValue('@Home')
    await input.trigger('keydown', { key: 'Enter' })
    await input.trigger('blur')

    expect(create).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledWith({ name: 'home' })
  })

  it('renames on double-click', async () => {
    const store = seedLabels([{ id: 'l1', name: 'home', color: '#1a73e8', taskCount: 0 }])
    const rename = vi.spyOn(store, 'renameLabel').mockResolvedValue({})
    const wrapper = mountSidebar()
    await flushPromises()

    await wrapper.get('.label-item').trigger('dblclick')
    const input = wrapper.get('[aria-label="Rename home"]')
    await input.setValue('House')
    await input.trigger('keydown', { key: 'Enter' })

    expect(rename).toHaveBeenCalledWith('l1', 'house')
  })

  it('recolours from the swatches behind the dot', async () => {
    const store = seedLabels([{ id: 'l1', name: 'home', color: '#1a73e8', taskCount: 0 }])
    const recolour = vi.spyOn(store, 'recolourLabel').mockResolvedValue({})
    const wrapper = mountSidebar()
    await flushPromises()

    expect(wrapper.find('.label-swatches').exists()).toBe(false)
    await wrapper.get('.label-dot').trigger('click')
    const swatches = wrapper.findAll('.label-swatches .label-color-swatch')
    expect(swatches).toHaveLength(8)
    await swatches[2].trigger('click')

    expect(recolour).toHaveBeenCalledWith('l1', '#2f9e44')
    expect(wrapper.find('.label-swatches').exists()).toBe(false)
  })

  it('confirms before deleting a label that tasks carry, naming the count', async () => {
    const store = seedLabels([{ id: 'l1', name: 'home', color: '#1a73e8', taskCount: 3 }])
    const remove = vi.spyOn(store, 'deleteLabel').mockResolvedValue(true)
    const confirm = vi.fn(() => false)
    vi.stubGlobal('confirm', confirm)
    const wrapper = mountSidebar()
    await flushPromises()

    await wrapper.get('[aria-label="Delete label home"]').trigger('click')

    expect(confirm).toHaveBeenCalledWith('Remove @home from 3 tasks and delete it?')
    expect(remove).not.toHaveBeenCalled()
  })

  it('deletes an unused label without asking and routes away from its view', async () => {
    const store = seedLabels([{ id: 'l1', name: 'home', color: '#1a73e8', taskCount: 0 }])
    vi.spyOn(store, 'deleteLabel').mockResolvedValue(true)
    const confirm = vi.fn()
    vi.stubGlobal('confirm', confirm)
    await router.push('/tasks?project=label:home')
    const wrapper = mountSidebar()
    await flushPromises()

    await wrapper.get('[aria-label="Delete label home"]').trigger('click')
    await flushPromises()

    expect(confirm).not.toHaveBeenCalled()
    expect(router.currentRoute.value.query.project).toBe('inbox')
  })
})

describe('dropping a task on a label', () => {
  function seedLabels(labels) {
    const store = useTaskLabelsStore()
    store.labels = labels
    store.isLoaded = true
    return store
  }

  function taskDrag(id, types = ['application/x-cookie-task']) {
    return { dataTransfer: { types, getData: () => id, dropEffect: '' } }
  }

  it('shows the count beside a label that tasks carry', async () => {
    seedLabels([
      { id: 'l1', name: 'home', color: '#1a73e8', taskCount: 4 },
      { id: 'l2', name: 'work', color: '#e5484d', taskCount: 0 },
    ])
    const wrapper = mountSidebar()
    await flushPromises()

    const rows = wrapper.findAll('.label-item')
    expect(rows[0].get('.nav-badge').text()).toBe('4')
    expect(rows[1].find('.nav-badge').exists()).toBe(false)
  })

  it('adds the label to the dropped task, keeping its existing labels', async () => {
    seedLabels([{ id: 'l1', name: 'home', color: '#1a73e8', taskCount: 0 }])
    const items = useTaskItemsStore()
    items.items = [{ id: 't1', content: 'Call plumber', labels: ['calls'] }]
    const setLabels = vi.spyOn(items, 'setLabels').mockResolvedValue({})
    const wrapper = mountSidebar()
    await flushPromises()

    const row = wrapper.get('.label-item')
    await row.trigger('dragover', taskDrag('t1'))
    expect(row.classes()).toContain('drop-target')
    await row.trigger('drop', taskDrag('t1'))

    expect(setLabels).toHaveBeenCalledWith('t1', ['calls', 'home'])
    expect(row.classes()).not.toContain('drop-target')
  })

  it('does nothing when the task already carries the label', async () => {
    seedLabels([{ id: 'l1', name: 'home', color: '#1a73e8', taskCount: 1 }])
    const items = useTaskItemsStore()
    items.items = [{ id: 't1', content: 'Call plumber', labels: ['home'] }]
    const setLabels = vi.spyOn(items, 'setLabels').mockResolvedValue({})
    const wrapper = mountSidebar()
    await flushPromises()

    await wrapper.get('.label-item').trigger('drop', taskDrag('t1'))

    expect(setLabels).not.toHaveBeenCalled()
  })

  it('refuses a divider', async () => {
    seedLabels([{ id: 'l1', name: 'home', color: '#1a73e8', taskCount: 0 }])
    const items = useTaskItemsStore()
    items.items = [{ id: 'd1', kind: 'divider', content: '', labels: [] }]
    const setLabels = vi.spyOn(items, 'setLabels').mockResolvedValue({})
    const wrapper = mountSidebar()
    await flushPromises()

    const row = wrapper.get('.label-item')
    const drag = taskDrag('d1', ['application/x-cookie-task', 'application/x-cookie-divider'])
    await row.trigger('dragover', drag)
    expect(row.classes()).not.toContain('drop-target')
    await row.trigger('drop', drag)

    expect(setLabels).not.toHaveBeenCalled()
  })
})
