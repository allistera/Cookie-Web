import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import TasksView from '../TasksView.vue'
import { useProjectsStore } from '../../stores/projects'
import { useTaskItemsStore } from '../../stores/taskItems'

let router

function mountView() {
  return mount(TasksView, { global: { plugins: [router] } })
}

beforeEach(async () => {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/tasks', name: 'tasks', component: { template: '<div />' } }],
  })
  await router.push('/tasks?project=p2')
  await router.isReady()
  setActivePinia(createPinia())
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ items: [], projects: [] }) })),
  )
  const projects = useProjectsStore()
  projects.projects = [
    { id: 'p1', parentId: null, name: 'Technical Projects', description: null },
    { id: 'p2', parentId: 'p1', name: 'Githup', description: null },
  ]
  projects.isLoaded = true
})

describe('TasksView', () => {
  it('shows the ancestor chain and the project name', async () => {
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.get('.tasks-breadcrumb').text()).toContain('My Projects')
    expect(wrapper.get('.tasks-breadcrumb').text()).toContain('Technical Projects')
    expect(wrapper.get('.tasks-title').text()).toBe('Githup')
  })

  it('offers the description placeholder until one is written', async () => {
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.get('.tasks-description').text()).toBe('Add a description')
  })

  // Inbox is a rule, not a project row, so it has no ancestors to show.
  it('titles the Inbox without a breadcrumb chain', async () => {
    await router.push('/tasks?project=inbox')
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.get('.tasks-title').text()).toBe('Inbox')
    expect(wrapper.get('.tasks-breadcrumb').text()).not.toContain('Technical Projects')
  })

  it('renames the project from the title, submitting once on Enter then blur', async () => {
    const projects = useProjectsStore()
    const rename = vi.spyOn(projects, 'renameProject').mockResolvedValue(null)

    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('.tasks-title').trigger('click')
    const input = wrapper.get('.tasks-title-input')
    await input.setValue('Renamed')
    await input.trigger('keydown.enter')
    await input.trigger('blur')

    expect(rename).toHaveBeenCalledTimes(1)
    expect(rename).toHaveBeenCalledWith('p2', 'Renamed')
  })

  it('writes a description from the placeholder, submitting once on Enter then blur', async () => {
    const projects = useProjectsStore()
    const describeSpy = vi.spyOn(projects, 'describeProject').mockResolvedValue(null)

    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('.tasks-description').trigger('click')
    const input = wrapper.get('.tasks-description-input')
    await input.setValue('What this project is for')
    await input.trigger('keydown.enter')
    await input.trigger('blur')

    expect(describeSpy).toHaveBeenCalledTimes(1)
    expect(describeSpy).toHaveBeenCalledWith('p2', 'What this project is for')
  })

  it('lists tasks with their descriptions', async () => {
    const items = useTaskItemsStore()
    items.items = [
      {
        id: 't1',
        content: 'Add auto-merge',
        description: 'Rather than waiting',
        completedAt: null,
      },
    ]
    items.loadedProject = 'p2'

    const wrapper = mountView()
    await flushPromises()

    const row = wrapper.get('.task-row')
    expect(row.get('.task-content').text()).toBe('Add auto-merge')
    expect(row.get('.task-description').text()).toBe('Rather than waiting')
  })

  it('completes a task from its circle', async () => {
    const items = useTaskItemsStore()
    items.items = [{ id: 't1', content: 'Add auto-merge', description: null, completedAt: null }]
    items.loadedProject = 'p2'
    const setCompleted = vi.spyOn(items, 'setCompleted').mockResolvedValue(null)

    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('.task-check').trigger('click')

    expect(setCompleted).toHaveBeenCalledWith('t1', true)
  })

  // Enter commits and unmounts the composer, which fires blur: without the
  // guard the same task would be created twice.
  it('creates a task once when Enter is followed by blur', async () => {
    const items = useTaskItemsStore()
    items.loadedProject = 'p2'
    const create = vi.spyOn(items, 'createItem').mockResolvedValue({ id: 't9' })

    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('.add-task-btn').trigger('click')
    const input = wrapper.get('.add-task-row input')
    await input.setValue('Ship it')
    await input.trigger('keydown.enter')
    await input.trigger('blur')

    expect(create).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledWith({ content: 'Ship it', projectId: 'p2' })
  })

  // Regression: switching projects must never show the previous project's
  // tasks under the new heading, even while the new load is still pending.
  it('shows a loading state instead of the previous project tasks while switching', async () => {
    const items = useTaskItemsStore()
    items.items = [{ id: 't1', content: 'Old project task', description: null, completedAt: null }]
    items.loadedProject = 'p2'
    vi.spyOn(items, 'authHeaders').mockResolvedValue({})

    let resolveFetch
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve
          }),
      ),
    )

    const wrapper = mountView()
    await router.push('/tasks?project=p1')
    await flushPromises()

    expect(wrapper.text()).not.toContain('Old project task')
    expect(wrapper.get('.tasks-loading').text()).toBe('Loading tasks…')

    resolveFetch({ ok: true, json: async () => ({ items: [] }) })
    await flushPromises()
    expect(wrapper.find('.tasks-loading').exists()).toBe(false)
  })

  it('creates an Inbox task with no project', async () => {
    await router.push('/tasks?project=inbox')
    const items = useTaskItemsStore()
    items.loadedProject = 'inbox'
    const create = vi.spyOn(items, 'createItem').mockResolvedValue({ id: 't9' })

    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('.add-task-btn').trigger('click')
    await wrapper.get('.add-task-row input').setValue('Ship it')
    await wrapper.get('.add-task-row input').trigger('keydown.enter')

    expect(create).toHaveBeenCalledWith({ content: 'Ship it', projectId: null })
  })

  it('opens a task in the panel by putting its id in the query', async () => {
    const items = useTaskItemsStore()
    items.items = [{ id: 'a', content: 'First', description: null, dueDate: null, projectId: 'p2' }]
    items.loadedProject = 'p2'
    const wrapper = mountView()
    await flushPromises()

    await wrapper.get('.task-open').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.query.task).toBe('a')
  })

  it('shows a due date on the row when the task has one', async () => {
    const items = useTaskItemsStore()
    items.items = [
      { id: 'a', content: 'First', description: null, dueDate: '2026-09-01', projectId: 'p2' },
    ]
    items.loadedProject = 'p2'
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.get('.task-due').text()).toBe('1 Sep')
  })

  // A date is a plain calendar date with no zone. Formatting it through a
  // Date in the local zone slides the chip a day west of Greenwich.
  it('shows the due date without a timezone shift', async () => {
    const items = useTaskItemsStore()
    items.items = [
      { id: 'a', content: 'First', description: null, dueDate: '2026-01-01', projectId: 'p2' },
    ]
    items.loadedProject = 'p2'
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.get('.task-due').text()).toBe('1 Jan')
  })

  // Completing must stay on the circle: one click that both completes and
  // opens the panel would be unusable.
  it('does not open the panel when the completion circle is clicked', async () => {
    const items = useTaskItemsStore()
    items.items = [{ id: 'a', content: 'First', description: null, dueDate: null, projectId: 'p2' }]
    items.loadedProject = 'p2'
    vi.spyOn(items, 'setCompleted').mockResolvedValue({})
    const wrapper = mountView()
    await flushPromises()

    await wrapper.get('.task-check').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.query.task).toBeUndefined()
  })
})

describe('the Today view', () => {
  beforeEach(async () => {
    await router.push('/tasks?project=today')
  })

  it('titles the view Today and shows no breadcrumb trail', async () => {
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.get('.tasks-title').text()).toBe('Today')
    expect(wrapper.findAll('.tasks-breadcrumb a')).toHaveLength(0)
  })

  // Today spans every project, so there is no one project a new task would
  // belong to and nothing to describe.
  it('offers no description and no add-task composer', async () => {
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('.tasks-description').exists()).toBe(false)
    expect(wrapper.find('.add-task-btn').exists()).toBe(false)
  })

  it('does not let the title be edited', async () => {
    const wrapper = mountView()
    await flushPromises()

    await wrapper.get('.tasks-title').trigger('click')
    await flushPromises()

    expect(wrapper.find('.tasks-title-input').exists()).toBe(false)
  })

  // The rows come from different projects, so each says where it lives.
  it('names each task’s project on its row', async () => {
    const items = useTaskItemsStore()
    items.items = [
      { id: 'a', content: 'First', description: null, dueDate: '2026-08-29', projectId: 'p2' },
      { id: 'b', content: 'Second', description: null, dueDate: '2026-08-29', projectId: null },
    ]
    items.loadedProject = 'today'
    const wrapper = mountView()
    await flushPromises()

    const homes = wrapper.findAll('.task-home')
    expect(homes.map((home) => home.text())).toEqual(['Githup', 'Inbox'])
  })

  it('shows no project name on rows outside Today', async () => {
    await router.push('/tasks?project=p2')
    const items = useTaskItemsStore()
    items.items = [{ id: 'a', content: 'First', description: null, dueDate: null, projectId: 'p2' }]
    items.loadedProject = 'p2'
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('.task-home').exists()).toBe(false)
  })
})
