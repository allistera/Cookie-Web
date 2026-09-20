import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import TasksView from '../TasksView.vue'
import { useProjectsStore } from '../../stores/projects'
import { localToday } from '../../lib/localDate'
import { useTaskItemsStore } from '../../stores/taskItems'
import { useTaskLabelsStore } from '../../stores/taskLabels'

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
    vi.fn(async () => ({ ok: true, json: async () => ({ items: [], projects: [], labels: [] }) })),
  )
  const projects = useProjectsStore()
  projects.projects = [
    { id: 'p1', parentId: null, name: 'Technical Projects', description: null },
    { id: 'p2', parentId: 'p1', name: 'Githup', description: null },
  ]
  projects.isLoaded = true
})

describe('TasksView', () => {
  it('switches between priority and label boards while keeping task actions available', async () => {
    const wrapper = mountView()
    await flushPromises()
    const items = useTaskItemsStore()
    items.items = [
      { id: 'a', content: 'Urgent task', priority: 1, labels: ['Work', 'Calls'] },
      { id: 'b', content: 'Unlabelled task', priority: 4, labels: [] },
      { id: 'd', kind: 'divider', content: '' },
      { id: 'child', parentId: 'a', content: 'Child task', priority: 2 },
    ]
    await wrapper.get('.display-layouts button:last-child').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.task-column')).toHaveLength(4)
    expect(wrapper.findAll('.task-column')[0].text()).toContain('Urgent task')
    expect(wrapper.findAll('.task-column')[3].text()).toContain('Unlabelled task')
    expect(wrapper.find('.task-divider').exists()).toBe(false)
    expect(wrapper.find('.task-board').text()).not.toContain('Child task')
    await wrapper.get('[aria-label="Group tasks by"]').setValue('labels')
    await flushPromises()
    expect(wrapper.findAll('.task-column-title').map((node) => node.text())).toEqual([
      'Calls 1',
      'Work 1',
      'No label 1',
    ])
    const complete = vi.spyOn(items, 'setCompleted').mockResolvedValue(null)
    await wrapper.get('[aria-label="Complete Urgent task"]').trigger('click')
    expect(complete).toHaveBeenCalledWith('a', true)
    await wrapper.get('.task-open').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({
      layout: 'board',
      group: 'labels',
      task: 'a',
    })
    await wrapper.get('.display-layouts button:first-child').trigger('click')
    await flushPromises()
    expect(wrapper.find('.task-board').exists()).toBe(false)
    expect(wrapper.find('.task-divider').exists()).toBe(true)
  })

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

  it('defaults a bare /tasks route to Today and loads Today items', async () => {
    await router.push('/tasks')
    const items = useTaskItemsStore()
    const loadItems = vi.spyOn(items, 'loadItems').mockResolvedValue(null)
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.get('.tasks-title').text()).toBe('Today')
    expect(loadItems).toHaveBeenCalledWith('today')
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

  it('writes a description from the placeholder on blur; Enter only makes a newline', async () => {
    const projects = useProjectsStore()
    const describeSpy = vi.spyOn(projects, 'describeProject').mockResolvedValue(null)

    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('.tasks-description').trigger('click')
    const input = wrapper.get('.tasks-description-input')
    await input.setValue('What this project is for')
    await input.trigger('keydown.enter')
    expect(describeSpy).not.toHaveBeenCalled()
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

  // Sub-tasks live inside their parent's panel; the list shows only the
  // top level even though the store loads both.
  it('keeps sub-tasks out of the task list', async () => {
    const items = useTaskItemsStore()
    items.items = [
      { id: 't1', content: 'Parent', description: null, parentId: null, completedAt: null },
      { id: 't2', content: 'Child', description: null, parentId: 't1', completedAt: null },
    ]
    items.loadedProject = 'p2'

    const wrapper = mountView()
    await flushPromises()

    const rows = wrapper.findAll('.task-row')
    expect(rows).toHaveLength(1)
    expect(rows[0].get('.task-content').text()).toBe('Parent')
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

  it('shows a due time and labels on the task row', async () => {
    const items = useTaskItemsStore()
    items.items = [
      {
        id: 'a',
        content: 'Call plumber',
        description: null,
        dueDate: '2026-09-01',
        dueTime: '15:00',
        labels: ['home', 'calls'],
        projectId: 'p2',
      },
    ]
    items.loadedProject = 'p2'
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.get('.task-due').text()).toBe('1 Sep · 3:00 PM')
    expect(wrapper.findAll('.task-label').map((label) => label.text())).toEqual(['@home', '@calls'])
  })

  // The completion circle carries the priority's colour, the way Todoist's
  // list does. P4 (and a row from before the column existed) stays plain.
  it('colours the completion circle by priority', async () => {
    const items = useTaskItemsStore()
    items.items = [
      {
        id: 'a',
        content: 'Urgent',
        description: null,
        dueDate: null,
        projectId: 'p2',
        priority: 1,
      },
      { id: 'b', content: 'Plain', description: null, dueDate: null, projectId: 'p2', priority: 4 },
      { id: 'c', content: 'Legacy', description: null, dueDate: null, projectId: 'p2' },
    ]
    items.loadedProject = 'p2'
    const wrapper = mountView()
    await flushPromises()

    const checks = wrapper.findAll('.task-check')
    expect(checks[0].classes()).toContain('priority-1')
    expect(checks[1].classes()).toContain('priority-4')
    expect(checks[2].classes()).toContain('priority-4')
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

describe('dragging rows', () => {
  const dataTransfer = () => ({ effectAllowed: '', dropEffect: '', setData: vi.fn() })

  function threeTasks() {
    const items = useTaskItemsStore()
    items.items = [
      { id: 't1', content: 'One', position: 1, completedAt: null },
      { id: 't2', content: 'Two', position: 2, completedAt: null },
      { id: 't3', content: 'Three', position: 3, completedAt: null },
    ]
    items.loadedProject = 'p2'
    return items
  }

  it('drags by a grip at the row edge and names the task for the sidebar', async () => {
    threeTasks()
    const wrapper = mountView()
    await flushPromises()
    const transfer = dataTransfer()

    const row = wrapper.get('.task-row')
    expect(row.attributes('draggable')).toBeUndefined()
    const grip = row.get('.task-grip')
    expect(grip.attributes('draggable')).toBe('true')
    expect(grip.text()).toBe('drag_indicator')
    expect(grip.attributes('aria-label')).toBe('Drag One')
    await grip.trigger('dragstart', { dataTransfer: transfer })

    expect(transfer.setData).toHaveBeenCalledWith('application/x-cookie-task', 't1')
    expect(row.classes()).toContain('dragging')

    await grip.trigger('dragend')
    expect(row.classes()).not.toContain('dragging')
  })

  // jsdom reports every row at 0×0, so any positive pointer is "below the
  // middle": dropping there means after the row.
  it('drops a row after another and sends the whole new order', async () => {
    const items = threeTasks()
    const reorder = vi.spyOn(items, 'reorderItems').mockResolvedValue(true)
    const wrapper = mountView()
    await flushPromises()
    const rows = wrapper.findAll('.task-row')
    const transfer = dataTransfer()

    await rows[0].get('.task-grip').trigger('dragstart', { dataTransfer: transfer })
    await rows[2].trigger('dragover', { dataTransfer: transfer, clientY: 10 })
    expect(rows[2].classes()).toContain('drop-after')
    await rows[2].trigger('drop')

    expect(reorder).toHaveBeenCalledWith(['t2', 't3', 't1'])
    expect(rows[2].classes()).not.toContain('drop-after')
  })

  it('drops a row before another', async () => {
    const items = threeTasks()
    const reorder = vi.spyOn(items, 'reorderItems').mockResolvedValue(true)
    const wrapper = mountView()
    await flushPromises()
    const rows = wrapper.findAll('.task-row')
    const transfer = dataTransfer()

    await rows[2].get('.task-grip').trigger('dragstart', { dataTransfer: transfer })
    await rows[1].trigger('dragover', { dataTransfer: transfer, clientY: -10 })
    expect(rows[1].classes()).toContain('drop-before')
    await rows[1].trigger('drop')

    expect(reorder).toHaveBeenCalledWith(['t1', 't3', 't2'])
  })

  it('ignores a drop onto the row being dragged', async () => {
    const items = threeTasks()
    const reorder = vi.spyOn(items, 'reorderItems').mockResolvedValue(true)
    const wrapper = mountView()
    await flushPromises()
    const row = wrapper.get('.task-row')
    const transfer = dataTransfer()

    await row.get('.task-grip').trigger('dragstart', { dataTransfer: transfer })
    await row.trigger('dragover', { dataTransfer: transfer, clientY: 10 })
    await row.trigger('drop')

    expect(row.classes()).not.toContain('drop-after')
    expect(reorder).not.toHaveBeenCalled()
  })

  // Today is ordered by due date, so a row there can be re-arranged among
  // the rows due the same day — and only those are sent — but not across
  // days, where the drop would visibly do nothing.
  describe('in Today', () => {
    function todayTasks() {
      const items = useTaskItemsStore()
      items.items = [
        { id: 'y1', content: 'Late one', dueDate: '2026-09-01', position: 1, completedAt: null },
        { id: 'y2', content: 'Late two', dueDate: '2026-09-01', position: 2, completedAt: null },
        { id: 'd1', content: 'Due today', dueDate: '2026-09-03', position: 3, completedAt: null },
      ]
      items.loadedProject = 'today'
      return items
    }

    it('re-arranges within a day and sends only that day', async () => {
      await router.push('/tasks?project=today')
      const items = todayTasks()
      const reorder = vi.spyOn(items, 'reorderItems').mockResolvedValue(true)
      const wrapper = mountView()
      await flushPromises()
      const rows = wrapper.findAll('.task-row')
      const transfer = dataTransfer()

      await rows[1].get('.task-grip').trigger('dragstart', { dataTransfer: transfer })
      await rows[0].trigger('dragover', { dataTransfer: transfer, clientY: -10 })
      expect(rows[0].classes()).toContain('drop-before')
      await rows[0].trigger('drop')

      expect(reorder).toHaveBeenCalledWith(['y2', 'y1'])
    })

    it('refuses a drop on a row due another day', async () => {
      await router.push('/tasks?project=today')
      const items = todayTasks()
      const reorder = vi.spyOn(items, 'reorderItems').mockResolvedValue(true)
      const wrapper = mountView()
      await flushPromises()
      const rows = wrapper.findAll('.task-row')
      const transfer = dataTransfer()

      await rows[0].get('.task-grip').trigger('dragstart', { dataTransfer: transfer })
      expect(transfer.setData).toHaveBeenCalledWith('application/x-cookie-task', 'y1')
      await rows[2].trigger('dragover', { dataTransfer: transfer, clientY: 10 })
      expect(rows[2].classes()).not.toContain('drop-after')
      await rows[2].trigger('drop')

      expect(reorder).not.toHaveBeenCalled()
    })
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

  // Today now carries overdue tasks, so its rows no longer share one date.
  it('dates an overdue row and marks it overdue', async () => {
    const items = useTaskItemsStore()
    items.items = [
      { id: 'a', content: 'Late', description: null, dueDate: '2020-01-02', projectId: 'p2' },
    ]
    items.loadedProject = 'today'
    const wrapper = mountView()
    await flushPromises()

    const due = wrapper.get('.task-due')
    expect(due.text()).toBe('2 Jan')
    expect(due.classes()).toContain('overdue')
  })

  it('leaves a row due today undated and unmarked', async () => {
    const items = useTaskItemsStore()
    items.items = [
      { id: 'a', content: 'Today', description: null, dueDate: localToday(), projectId: 'p2' },
    ]
    items.loadedProject = 'today'
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('.task-due').exists()).toBe(false)
  })

  it('still shows the time for a row due today', async () => {
    const items = useTaskItemsStore()
    items.items = [
      {
        id: 'a',
        content: 'Today at three',
        description: null,
        dueDate: localToday(),
        dueTime: '15:00',
        projectId: 'p2',
      },
    ]
    items.loadedProject = 'today'
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.get('.task-due').text()).toBe('3:00 PM')
  })
})

// Deleting was reachable only from the detail panel, so removing a task meant
// opening it first.
describe('deleting a task from the list', () => {
  function seedOne() {
    const items = useTaskItemsStore()
    items.items = [
      { id: 'a', content: 'Drop me', description: null, dueDate: null, projectId: 'p2' },
    ]
    items.loadedProject = 'p2'
    return items
  }

  it('deletes the row after confirming', async () => {
    const items = seedOne()
    const remove = vi.spyOn(items, 'deleteItem').mockResolvedValue(true)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const wrapper = mountView()
    await flushPromises()

    await wrapper.get('.task-delete').trigger('click')
    await flushPromises()

    expect(remove).toHaveBeenCalledWith('a')
  })

  it('names the task in the confirmation', async () => {
    const items = seedOne()
    vi.spyOn(items, 'deleteItem').mockResolvedValue(true)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const wrapper = mountView()
    await flushPromises()

    await wrapper.get('.task-delete').trigger('click')

    expect(confirm).toHaveBeenCalledWith('Delete "Drop me"?')
  })

  it('does not delete when the confirmation is dismissed', async () => {
    const items = seedOne()
    const remove = vi.spyOn(items, 'deleteItem').mockResolvedValue(true)
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const wrapper = mountView()
    await flushPromises()

    await wrapper.get('.task-delete').trigger('click')
    await flushPromises()

    expect(remove).not.toHaveBeenCalled()
  })

  // The row itself is a button that opens the task; deleting must not do both.
  it('does not open the task when the delete control is clicked', async () => {
    const items = seedOne()
    vi.spyOn(items, 'deleteItem').mockResolvedValue(true)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const wrapper = mountView()
    await flushPromises()

    await wrapper.get('.task-delete').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.query.task).toBeUndefined()
  })

  it('gives every row its own delete control', async () => {
    const items = useTaskItemsStore()
    items.items = [
      { id: 'a', content: 'One', description: null, dueDate: null, projectId: 'p2' },
      { id: 'b', content: 'Two', description: null, dueDate: null, projectId: 'p2' },
    ]
    items.loadedProject = 'p2'
    const wrapper = mountView()
    await flushPromises()

    const labels = wrapper.findAll('.task-delete').map((b) => b.attributes('aria-label'))
    expect(labels).toEqual(['Delete One', 'Delete Two'])
  })
})

// A divider is a rule between rows. The line under each row grows a plus on
// hover that adds one there; the divider's own delete sits on its midpoint.
describe('dividers', () => {
  function seedTwo() {
    const items = useTaskItemsStore()
    items.items = [
      { id: 'a', content: 'One', position: 1, projectId: 'p2', completedAt: null },
      { id: 'b', content: 'Two', position: 2, projectId: 'p2', completedAt: null },
    ]
    items.loadedProject = 'p2'
    return items
  }

  function seedWithDivider() {
    const items = useTaskItemsStore()
    items.items = [
      { id: 'a', content: 'One', position: 1, projectId: 'p2', completedAt: null },
      { id: 'd', kind: 'divider', content: '', position: 2, projectId: 'p2', completedAt: null },
      { id: 'b', content: 'Two', position: 3, projectId: 'p2', completedAt: null },
    ]
    items.loadedProject = 'p2'
    return items
  }

  it('offers a plus on the line under every row that adds a divider there', async () => {
    const items = seedTwo()
    const add = vi.spyOn(items, 'addDivider').mockResolvedValue(null)
    const wrapper = mountView()
    await flushPromises()

    const inserts = wrapper.findAll('.task-insert')
    expect(inserts).toHaveLength(2)
    const plus = inserts[0].get('.task-insert-btn')
    expect(plus.text()).toBe('add')
    expect(plus.attributes('aria-label')).toBe('Add divider after One')
    await plus.trigger('click')

    expect(add).toHaveBeenCalledWith({ projectId: 'p2', afterId: 'a' })
  })

  it('adds an Inbox divider with no project', async () => {
    await router.push('/tasks?project=inbox')
    const items = seedTwo()
    items.loadedProject = 'inbox'
    const add = vi.spyOn(items, 'addDivider').mockResolvedValue(null)
    const wrapper = mountView()
    await flushPromises()

    await wrapper.findAll('.task-insert-btn')[1].trigger('click')

    expect(add).toHaveBeenCalledWith({ projectId: null, afterId: 'b' })
  })

  // Two rules in a row say nothing, so neither side of a divider offers one.
  it('offers no plus beside a divider', async () => {
    seedWithDivider()
    const wrapper = mountView()
    await flushPromises()

    const inserts = wrapper.findAll('.task-insert')
    expect(inserts).toHaveLength(1)
    expect(inserts[0].get('.task-insert-btn').attributes('aria-label')).toBe(
      'Add divider after Two',
    )
  })

  it('ignores a second click while a divider is still being added', async () => {
    const items = seedTwo()
    let finish
    const add = vi
      .spyOn(items, 'addDivider')
      .mockImplementation(() => new Promise((resolve) => (finish = resolve)))
    const wrapper = mountView()
    await flushPromises()

    const plus = wrapper.get('.task-insert-btn')
    await plus.trigger('click')
    expect(plus.attributes('disabled')).toBeDefined()
    await plus.trigger('click')
    expect(add).toHaveBeenCalledTimes(1)

    finish(null)
    await flushPromises()
    expect(plus.attributes('disabled')).toBeUndefined()
  })

  // Two rules in a row say nothing, so a divider will not land beside one.
  it('refuses to drop a divider beside another divider', async () => {
    const items = useTaskItemsStore()
    items.items = [
      { id: 'a', content: 'One', position: 1, projectId: 'p2', completedAt: null },
      { id: 'd1', kind: 'divider', content: '', position: 2, projectId: 'p2', completedAt: null },
      { id: 'b', content: 'Two', position: 3, projectId: 'p2', completedAt: null },
      { id: 'd2', kind: 'divider', content: '', position: 4, projectId: 'p2', completedAt: null },
    ]
    items.loadedProject = 'p2'
    const reorder = vi.spyOn(items, 'reorderItems').mockResolvedValue(true)
    const wrapper = mountView()
    await flushPromises()
    const rows = wrapper.findAll('.task-row')
    const transfer = { effectAllowed: '', dropEffect: '', setData: vi.fn() }

    await rows[3].get('.task-grip').trigger('dragstart', { dataTransfer: transfer })
    // After Two would put d2 straight after... Two, which is fine; before
    // Two is straight after d1, which is not. jsdom rows are 0×0, so a
    // negative pointer is "before".
    await rows[2].trigger('dragover', { dataTransfer: transfer, clientY: -10 })
    expect(rows[2].classes()).not.toContain('drop-before')
    await rows[2].trigger('drop')
    expect(reorder).not.toHaveBeenCalled()

    // A drop ends the drag, so each try starts it afresh.
    // Onto the other divider is refused on either side.
    await rows[3].get('.task-grip').trigger('dragstart', { dataTransfer: transfer })
    await rows[1].trigger('dragover', { dataTransfer: transfer, clientY: 10 })
    expect(rows[1].classes()).not.toContain('drop-after')

    // Before One is beside nothing but One.
    await rows[0].trigger('dragover', { dataTransfer: transfer, clientY: -10 })
    expect(rows[0].classes()).toContain('drop-before')
    await rows[0].trigger('drop')
    expect(reorder).toHaveBeenCalledWith(['d2', 'a', 'd1', 'b'])
  })

  it('draws a divider as a rule with a grip and a delete, and no circle or title', async () => {
    seedWithDivider()
    const wrapper = mountView()
    await flushPromises()

    const row = wrapper.findAll('.task-row')[1]
    expect(row.classes()).toContain('task-divider')
    expect(row.find('.divider-line').exists()).toBe(true)
    expect(row.find('.task-check').exists()).toBe(false)
    expect(row.find('.task-open').exists()).toBe(false)
    expect(row.get('.task-grip').attributes('aria-label')).toBe('Drag divider')
    expect(row.get('.divider-delete').text()).toBe('delete')
  })

  it('deletes a divider without asking', async () => {
    const items = seedWithDivider()
    const remove = vi.spyOn(items, 'deleteItem').mockResolvedValue(true)
    // The spy is shared with earlier tests in this file, so its calls are
    // cleared before counting them.
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    confirm.mockClear()
    const wrapper = mountView()
    await flushPromises()

    await wrapper.get('.divider-delete').trigger('click')

    expect(confirm).not.toHaveBeenCalled()
    expect(remove).toHaveBeenCalledWith('d')
  })

  it('marks a dragged divider so the sidebar can refuse it for Today', async () => {
    seedWithDivider()
    const wrapper = mountView()
    await flushPromises()
    const transfer = { effectAllowed: '', dropEffect: '', setData: vi.fn() }

    await wrapper.findAll('.task-row')[1].get('.task-grip').trigger('dragstart', {
      dataTransfer: transfer,
    })

    expect(transfer.setData).toHaveBeenCalledWith('application/x-cookie-task', 'd')
    expect(transfer.setData).toHaveBeenCalledWith('application/x-cookie-divider', 'd')
  })

  it('offers no plus in Today', async () => {
    await router.push('/tasks?project=today')
    const items = useTaskItemsStore()
    items.items = [
      { id: 'a', content: 'One', dueDate: localToday(), position: 1, completedAt: null },
    ]
    items.loadedProject = 'today'
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.find('.task-insert').exists()).toBe(false)

    await router.push('/tasks?project=p2')
    await flushPromises()
    items.items = [{ id: 'a', content: 'One', position: 1, completedAt: null }]
    items.loadedProject = 'p2'
    await flushPromises()
    expect(wrapper.find('.task-insert').exists()).toBe(true)
    expect(wrapper.find('[aria-label="Search tasks"]').exists()).toBe(false)
  })
})

describe('a label view', () => {
  beforeEach(() => {
    const labels = useTaskLabelsStore()
    labels.labels = [{ id: 'l1', name: 'home', color: '#1a73e8', taskCount: 1 }]
    labels.isLoaded = true
  })

  it('loads the label list and titles the view with the label', async () => {
    const items = useTaskItemsStore()
    const load = vi.spyOn(items, 'loadItems').mockResolvedValue()
    await router.push('/tasks?project=label:home')
    const wrapper = mountView()
    await flushPromises()

    expect(load).toHaveBeenCalledWith('label:home')
    const title = wrapper.get('.tasks-title-label')
    expect(title.text()).toBe('@home')
    expect(title.attributes('style')).toContain('rgb(26, 115, 232)')
    expect(wrapper.get('.tasks-breadcrumb').text()).toContain('Labels')
    expect(wrapper.find('.tasks-description').exists()).toBe(false)
  })

  it('offers no divider plus in a label list', async () => {
    await router.push('/tasks?project=label:home')
    const wrapper = mountView()
    await flushPromises()
    const items = useTaskItemsStore()
    items.items = [
      { id: 'a', content: 'One', labels: ['home'] },
      { id: 'b', content: 'Two', labels: ['home'] },
    ]
    await flushPromises()

    expect(wrapper.find('.task-insert').exists()).toBe(false)
  })
})

describe('label colours', () => {
  it('colours chips and group headers from the label store', async () => {
    const labels = useTaskLabelsStore()
    labels.labels = [{ id: 'l1', name: 'home', color: '#1a73e8', taskCount: 1 }]
    labels.isLoaded = true
    const wrapper = mountView()
    await flushPromises()
    const items = useTaskItemsStore()
    items.items = [{ id: 'a', content: 'One', priority: 4, labels: ['home', 'calls'] }]
    await flushPromises()

    const chips = wrapper.findAll('.task-label')
    expect(chips[0].attributes('style')).toContain('rgb(26, 115, 232)')
    // A name with no row keeps the default grey.
    expect(chips[1].attributes('style')).toContain('rgb(100, 116, 139)')

    await wrapper.get('.display-layouts button:last-child').trigger('click')
    await flushPromises()
    await wrapper.get('[aria-label="Group tasks by"]').setValue('labels')
    await flushPromises()
    const homeColumn = wrapper
      .findAll('.task-column-title')
      .find((node) => node.text().startsWith('home'))
    expect(homeColumn.get('.task-column-dot').attributes('style')).toContain('rgb(26, 115, 232)')
  })
})
