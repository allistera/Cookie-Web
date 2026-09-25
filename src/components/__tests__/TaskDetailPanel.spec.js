import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { h } from 'vue'
import { createMemoryHistory, createRouter, RouterView, useRoute } from 'vue-router'

import TaskDetailPanel from '../TaskDetailPanel.vue'
import { useProjectsStore } from '../../stores/projects'
import { useTaskItemsStore } from '../../stores/taskItems'
import { useTaskLabelsStore } from '../../stores/taskLabels'

let router
let items

const ITEMS = [
  { id: 'a', content: 'First', description: null, dueDate: null, projectId: null },
  { id: 'b', content: 'Second', description: null, dueDate: null, projectId: null },
  { id: 'c', content: 'Third', description: null, dueDate: null, projectId: null },
]

// Mounts the panel the way TasksView does: keyed on and fed from ?task=, so
// the prop and the URL always name the same task and a route change swaps it.
const TasksHost = {
  setup() {
    const route = useRoute()
    return () =>
      route.query.task
        ? h(TaskDetailPanel, { key: route.query.task, taskId: route.query.task })
        : null
  },
}

async function mountPanel(taskId = 'b') {
  await router.replace({ path: '/tasks', query: { task: taskId } })
  return mount(RouterView, { global: { plugins: [router] } })
}

// The list is already loaded by the time the panel opens; the panel reads from
// it rather than fetching, so loadedProject has to look settled.
function seed(rows = ITEMS) {
  items.items = rows.map((row) => ({ ...row }))
  items.loadedProject = 'inbox'
  items.isLoading = false
}

beforeEach(async () => {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/tasks', name: 'tasks', component: TasksHost }],
  })
  await router.push('/tasks')
  await router.isReady()
  setActivePinia(createPinia())
  useTaskLabelsStore().isLoaded = true
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ items: [], projects: [] }) })),
  )
  items = useTaskItemsStore()
  vi.spyOn(items, 'notify').mockImplementation(() => {})
  const projects = useProjectsStore()
  projects.projects = [{ id: 'p1', parentId: null, name: 'Githup', description: null }]
  projects.isLoaded = true
})

describe('TaskDetailPanel', () => {
  it('has no sibling navigation in the header', async () => {
    seed()
    const wrapper = await mountPanel()
    await flushPromises()

    expect(wrapper.find('.task-panel-prev').exists()).toBe(false)
    expect(wrapper.find('.task-panel-next').exists()).toBe(false)
    expect(wrapper.find('.task-panel-close').exists()).toBe(true)
  })

  it('renders the task the URL names and follows it when the URL changes', async () => {
    seed()
    const wrapper = await mountPanel()
    await flushPromises()
    expect(wrapper.get('.task-panel-title').text()).toBe('Second')

    await router.push({ path: '/tasks', query: { task: 'c' } })
    await flushPromises()
    expect(wrapper.get('.task-panel-title').text()).toBe('Third')
  })

  it('names the Inbox when the task belongs to no project', async () => {
    seed()
    const wrapper = await mountPanel()
    await flushPromises()

    expect(wrapper.get('.task-panel-project').text()).toContain('Inbox')
  })

  it('names the project when the task has one', async () => {
    seed([{ ...ITEMS[1], projectId: 'p1' }])
    const wrapper = await mountPanel()
    await flushPromises()

    expect(wrapper.get('.task-panel-project').text()).toContain('Githup')
  })

  it('closes on Escape by dropping task from the query', async () => {
    seed()
    const wrapper = await mountPanel()
    await flushPromises()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()

    expect(router.currentRoute.value.query.task).toBeUndefined()
    wrapper.unmount()
  })

  it('cancels a title edit on Escape without closing the panel', async () => {
    seed()
    // Attached, so the input's keydown bubbles to the panel's document listener.
    await router.replace({ path: '/tasks', query: { task: 'b' } })
    const wrapper = mount(RouterView, { global: { plugins: [router] }, attachTo: document.body })
    await flushPromises()

    await wrapper.get('.task-panel-title').trigger('click')
    await flushPromises()
    await wrapper.get('.task-panel-title-input').trigger('keydown', { key: 'Escape' })
    await flushPromises()

    expect(wrapper.find('.task-panel-title-input').exists()).toBe(false)
    expect(router.currentRoute.value.query.task).toBe('b')
    wrapper.unmount()
  })

  it('opens the description editor from the keyboard', async () => {
    seed()
    const wrapper = await mountPanel()
    await flushPromises()

    await wrapper.get('.task-panel-description').trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(wrapper.find('.task-panel-description-input').exists()).toBe(true)
  })

  it('moves focus in on open, keeps Tab inside, and restores it on close', async () => {
    seed()
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    await router.replace({ path: '/tasks', query: { task: 'b' } })
    const wrapper = mount(RouterView, { global: { plugins: [router] }, attachTo: document.body })
    await flushPromises()

    const close = wrapper.get('.task-panel-close').element
    expect(document.activeElement).toBe(close)

    // Shift+Tab from the first control wraps to the last one in the panel.
    wrapper.get('.task-panel-delete').element.focus()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true }))
    expect(wrapper.get('.task-panel').element.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).not.toBe(wrapper.get('.task-panel-delete').element)

    await router.push('/tasks')
    await flushPromises()
    expect(document.activeElement).toBe(opener)
    wrapper.unmount()
    opener.remove()
  })

  it('leaves Tab alone when focus sits in an overlay outside the panel', async () => {
    seed()
    await router.replace({ path: '/tasks', query: { task: 'b' } })
    const wrapper = mount(RouterView, { global: { plugins: [router] }, attachTo: document.body })
    await flushPromises()

    const overlayInput = document.createElement('input')
    document.body.appendChild(overlayInput)
    overlayInput.focus()
    const event = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true })
    document.dispatchEvent(event)
    expect(document.activeElement).toBe(overlayInput)
    expect(event.defaultPrevented).toBe(false)

    wrapper.unmount()
    overlayInput.remove()
  })

  it('closes on a backdrop click but not on a click inside', async () => {
    seed()
    const wrapper = await mountPanel()
    await flushPromises()

    await wrapper.get('.task-panel').trigger('click')
    expect(router.currentRoute.value.query.task).toBe('b')

    await wrapper.get('.task-panel-backdrop').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.task).toBeUndefined()
  })

  // A stale link, a deleted task, or one hidden because it is complete.
  it('closes and notifies only when detail lookup confirms the task is missing', async () => {
    vi.spyOn(items, 'request').mockRejectedValue(
      Object.assign(new Error('Missing'), { status: 404 }),
    )
    seed()
    const wrapper = await mountPanel('missing')
    await flushPromises()

    expect(items.notify).toHaveBeenCalledWith('That task no longer exists.', 'error')
    expect(router.currentRoute.value.query.task).toBeUndefined()
    wrapper.unmount()
  })

  // Judging too early would close a panel opened by a deep link while the
  // list is still in flight.
  it('waits for the load to settle before deciding the task is missing', async () => {
    items.loadedProject = null
    items.isLoading = true
    const wrapper = await mountPanel('missing')
    await flushPromises()

    expect(items.notify).not.toHaveBeenCalled()
    expect(router.currentRoute.value.query.task).toBe('missing')
    wrapper.unmount()
  })

  it.each([null, '2026-09-01T00:00:00Z'])(
    'keeps a slow deep link open, including completed tasks (%s)',
    async (completedAt) => {
      seed()
      let resolveDetail
      vi.spyOn(items, 'request').mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveDetail = resolve
          }),
      )
      const wrapper = await mountPanel('older-task')
      await flushPromises()
      expect(router.currentRoute.value.query.task).toBe('older-task')
      expect(items.notify).not.toHaveBeenCalled()
      resolveDetail({
        item: {
          id: 'older-task',
          content: 'Older task',
          projectId: null,
          completedAt,
          summary: false,
        },
        subtasks: [],
      })
      await flushPromises()
      expect(wrapper.get('.task-panel-title').text()).toBe('Older task')
      expect(router.currentRoute.value.query.task).toBe('older-task')
      wrapper.unmount()
    },
  )

  it('keeps a failed lookup open for retry instead of reporting deletion', async () => {
    seed()
    vi.spyOn(items, 'request').mockRejectedValue(new Error('Offline'))
    const wrapper = await mountPanel('older-task')
    await flushPromises()
    expect(router.currentRoute.value.query.task).toBe('older-task')
    expect(wrapper.text()).toContain('Retry')
    expect(items.notify).not.toHaveBeenCalledWith('That task no longer exists.', 'error')
    wrapper.unmount()
  })

  it('renames the task from the title', async () => {
    seed()
    const rename = vi.spyOn(items, 'renameItem').mockResolvedValue({})
    const wrapper = await mountPanel()
    await flushPromises()

    await wrapper.get('.task-panel-title').trigger('click')
    await flushPromises()
    await wrapper.get('.task-panel-title-input').setValue('Second, renamed')
    await wrapper.get('.task-panel-title-input').trigger('keydown.enter')
    await flushPromises()

    expect(rename).toHaveBeenCalledWith('b', 'Second, renamed')
  })

  it('does not rename when the title is cleared', async () => {
    seed()
    const rename = vi.spyOn(items, 'renameItem').mockResolvedValue({})
    const wrapper = await mountPanel()
    await flushPromises()

    await wrapper.get('.task-panel-title').trigger('click')
    await flushPromises()
    await wrapper.get('.task-panel-title-input').setValue('   ')
    await wrapper.get('.task-panel-title-input').trigger('keydown.enter')
    await flushPromises()

    expect(rename).not.toHaveBeenCalled()
  })

  it('saves a description', async () => {
    seed()
    const describeItem = vi.spyOn(items, 'describeItem').mockResolvedValue({})
    const wrapper = await mountPanel()
    await flushPromises()

    await wrapper.get('.task-panel-description').trigger('click')
    await flushPromises()
    await wrapper.get('.task-panel-description-input').setValue('Why this matters')
    await wrapper.get('.task-panel-description-input').trigger('blur')
    await flushPromises()

    expect(describeItem).toHaveBeenCalledWith('b', 'Why this matters')
  })

  it('keeps the newlines of a multi-line description', async () => {
    seed()
    const describeItem = vi.spyOn(items, 'describeItem').mockResolvedValue({})
    const wrapper = await mountPanel()
    await flushPromises()

    await wrapper.get('.task-panel-description').trigger('click')
    await flushPromises()
    await wrapper.get('.task-panel-description-input').setValue('First line\nSecond line')
    await wrapper.get('.task-panel-description-input').trigger('blur')
    await flushPromises()

    expect(describeItem).toHaveBeenCalledWith('b', 'First line\nSecond line')
  })

  it('clears a description by emptying it', async () => {
    seed([{ ...ITEMS[1], description: 'Existing' }])
    const describeItem = vi.spyOn(items, 'describeItem').mockResolvedValue({})
    const wrapper = await mountPanel()
    await flushPromises()

    await wrapper.get('.task-panel-description').trigger('click')
    await flushPromises()
    await wrapper.get('.task-panel-description-input').setValue('')
    await wrapper.get('.task-panel-description-input').trigger('blur')
    await flushPromises()

    expect(describeItem).toHaveBeenCalledWith('b', null)
  })

  it('lists sub-tasks with a done/total count and completes one in place', async () => {
    seed([
      ...ITEMS,
      { id: 's1', content: 'Step one', parentId: 'b', completedAt: null, projectId: null },
      {
        id: 's2',
        content: 'Step two',
        parentId: 'b',
        completedAt: '2026-09-01T10:00:00Z',
        projectId: null,
      },
    ])
    const setCompleted = vi.spyOn(items, 'setCompleted').mockResolvedValue({})
    const wrapper = await mountPanel()
    await flushPromises()

    expect(wrapper.get('.task-subtasks-count').text()).toBe('1/2')
    const rows = wrapper.findAll('.subtask-row')
    expect(rows).toHaveLength(2)
    expect(rows[1].get('.subtask-content').classes()).toContain('done')

    await rows[0].get('.subtask-check').trigger('click')
    expect(setCompleted).toHaveBeenCalledWith('s1', true)
  })

  it('collapses the sub-task list behind the header toggle', async () => {
    seed([
      ...ITEMS,
      { id: 's1', content: 'Step one', parentId: 'b', completedAt: null, projectId: null },
    ])
    const wrapper = await mountPanel()
    await flushPromises()

    await wrapper.get('.task-subtasks-toggle').trigger('click')
    expect(wrapper.find('.subtask-row').exists()).toBe(false)
    expect(wrapper.find('.add-subtask-btn').exists()).toBe(false)
  })

  it('adds a sub-task against the open task', async () => {
    seed()
    const createItem = vi.spyOn(items, 'createItem').mockResolvedValue({})
    const wrapper = await mountPanel()
    await flushPromises()

    // No sub-tasks yet: no header row, just the add affordance.
    expect(wrapper.find('.task-subtasks-header').exists()).toBe(false)
    await wrapper.get('.add-subtask-btn').trigger('click')
    await flushPromises()
    await wrapper.get('.add-subtask-row input').setValue('Step one')
    await wrapper.get('.add-subtask-row input').trigger('keydown.enter')
    await flushPromises()

    expect(createItem).toHaveBeenCalledTimes(1)
    expect(createItem).toHaveBeenCalledWith({ content: 'Step one', parentId: 'b' })
  })

  it('shows the placeholder when there is no description', async () => {
    seed()
    const wrapper = await mountPanel()
    await flushPromises()

    expect(wrapper.get('.task-panel-description').text()).toBe('Add a description')
  })

  // Completing removes the task from the visible list, so leaving the panel
  // open would point it at something no longer there.
  it('completes the task and closes', async () => {
    seed()
    const complete = vi.spyOn(items, 'setCompleted').mockResolvedValue({})
    const wrapper = await mountPanel()
    await flushPromises()

    await wrapper.get('.task-panel-check').trigger('click')
    await flushPromises()

    expect(complete).toHaveBeenCalledWith('b', true)
    expect(router.currentRoute.value.query.task).toBeUndefined()
  })

  it("selects the task's current project in the picker", async () => {
    seed([{ ...ITEMS[1], projectId: 'p1' }])
    const wrapper = await mountPanel()
    await flushPromises()

    expect(wrapper.get('.task-panel-project-select').element.value).toBe('p1')
  })

  it('selects Inbox when the task belongs to no project', async () => {
    seed()
    const wrapper = await mountPanel()
    await flushPromises()

    expect(wrapper.get('.task-panel-project-select').element.value).toBe('inbox')
  })

  it('lists the Inbox and every project as options', async () => {
    seed()
    const wrapper = await mountPanel()
    await flushPromises()

    const options = wrapper.findAll('.task-panel-project-select option')
    expect(options.map((option) => option.text().trim())).toEqual(['Inbox', 'Githup'])
  })

  it('moves the task to another project', async () => {
    seed()
    const move = vi.spyOn(items, 'moveItem').mockResolvedValue({})
    const wrapper = await mountPanel()
    await flushPromises()

    await wrapper.get('.task-panel-project-select').setValue('p1')
    await flushPromises()

    expect(move).toHaveBeenCalledWith('b', 'p1')
  })

  // The Inbox is the absence of a project, so it goes over the wire as null.
  it('moves the task to the Inbox as null', async () => {
    seed([{ ...ITEMS[1], projectId: 'p1' }])
    const move = vi.spyOn(items, 'moveItem').mockResolvedValue({})
    const wrapper = await mountPanel()
    await flushPromises()

    await wrapper.get('.task-panel-project-select').setValue('inbox')
    await flushPromises()

    expect(move).toHaveBeenCalledWith('b', null)
  })

  it('sets a due date', async () => {
    seed()
    const setDue = vi.spyOn(items, 'setDueDate').mockResolvedValue({})
    const wrapper = await mountPanel()
    await flushPromises()

    await wrapper.get('.task-panel-date-input').setValue('2026-09-01')
    await flushPromises()

    expect(setDue).toHaveBeenCalledWith('b', '2026-09-01')
  })

  it('shows the date the task already has', async () => {
    seed([{ ...ITEMS[1], dueDate: '2026-09-01' }])
    const wrapper = await mountPanel()
    await flushPromises()

    expect(wrapper.get('.task-panel-date-input').element.value).toBe('2026-09-01')
  })

  it('clears a due date', async () => {
    seed([{ ...ITEMS[1], dueDate: '2026-09-01' }])
    const setDue = vi.spyOn(items, 'setDueDate').mockResolvedValue({})
    const wrapper = await mountPanel()
    await flushPromises()

    await wrapper.get('.task-panel-date-clear').trigger('click')
    await flushPromises()

    expect(setDue).toHaveBeenCalledWith('b', null)
  })

  // An emptied date input means "no date", which is null on the wire — not
  // an empty string, which the server would refuse.
  it('sends null when the date input is emptied', async () => {
    seed([{ ...ITEMS[1], dueDate: '2026-09-01' }])
    const setDue = vi.spyOn(items, 'setDueDate').mockResolvedValue({})
    const wrapper = await mountPanel()
    await flushPromises()

    await wrapper.get('.task-panel-date-input').setValue('')
    await flushPromises()

    expect(setDue).toHaveBeenCalledWith('b', null)
  })

  it('offers no clear control when there is no date', async () => {
    seed()
    const wrapper = await mountPanel()
    await flushPromises()

    expect(wrapper.find('.task-panel-date-clear').exists()).toBe(false)
  })

  it('shows and updates the task due time in its stored time zone', async () => {
    seed([
      {
        ...ITEMS[1],
        dueDate: '2026-09-11',
        dueTime: '15:00',
        timeZone: 'Europe/London',
      },
    ])
    const setDueTime = vi.spyOn(items, 'setDueTime').mockResolvedValue({})
    const wrapper = await mountPanel()
    await flushPromises()

    expect(wrapper.get('.task-panel-time-input').element.value).toBe('15:00')
    expect(wrapper.text()).toContain('Europe/London')
    await wrapper.get('.task-panel-time-input').setValue('16:30')
    await flushPromises()

    expect(setDueTime).toHaveBeenCalledWith('b', '16:30', 'Europe/London')
  })

  it('disables due time until the task has a due date', async () => {
    seed()
    const wrapper = await mountPanel()
    await flushPromises()

    expect(wrapper.get('.task-panel-time-input').attributes('disabled')).toBeDefined()
  })

  it('clears a due time as null', async () => {
    seed([
      {
        ...ITEMS[1],
        dueDate: '2026-09-11',
        dueTime: '15:00',
        timeZone: 'Europe/London',
      },
    ])
    const setDueTime = vi.spyOn(items, 'setDueTime').mockResolvedValue({})
    const wrapper = await mountPanel()
    await flushPromises()

    await wrapper.get('.task-panel-time-input').setValue('')
    await flushPromises()

    expect(setDueTime).toHaveBeenCalledWith('b', null, null)
  })

  it('shows the labels as chips and saves a change at once', async () => {
    seed([{ ...ITEMS[1], labels: ['home', 'errands'] }])
    const setLabels = vi.spyOn(items, 'setLabels').mockResolvedValue({})
    const wrapper = await mountPanel()
    await flushPromises()

    expect(wrapper.findAll('.task-label-chip-text').map((chip) => chip.text())).toEqual([
      '@home',
      '@errands',
    ])
    const input = wrapper.get('.task-label-picker-input')
    await input.setValue('@Calls')
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(setLabels).toHaveBeenCalledWith('b', ['home', 'errands', 'calls'])
  })

  // Priority is Todoist's four levels: 1 the most urgent, 4 the default.
  it('shows the default priority for a task that has none', async () => {
    seed()
    const wrapper = await mountPanel()
    await flushPromises()

    expect(wrapper.get('.task-panel-priority-short').text()).toBe('P4')
    expect(wrapper.get('.task-panel-priority-button .priority-flag').classes()).toContain(
      'priority-4',
    )
    expect(wrapper.find('.task-panel-priority-menu').exists()).toBe(false)
  })

  it('shows the priority the task already has', async () => {
    seed([{ ...ITEMS[1], priority: 1 }])
    const wrapper = await mountPanel()
    await flushPromises()

    expect(wrapper.get('.task-panel-priority-short').text()).toBe('P1')
    expect(wrapper.get('.task-panel-priority-button').attributes('aria-label')).toBe(
      'Priority: Priority 1',
    )
    expect(wrapper.get('.task-panel-priority-button .priority-flag').classes()).toContain(
      'priority-1',
    )
  })

  it('opens a menu of the four levels with the current one marked', async () => {
    seed([{ ...ITEMS[1], priority: 2 }])
    const wrapper = await mountPanel()
    await flushPromises()

    await wrapper.get('.task-panel-priority-button').trigger('click')

    const options = wrapper.findAll('.task-panel-priority-option')
    expect(options.map((option) => option.get('.task-panel-priority-option-label').text())).toEqual(
      ['Priority 1', 'Priority 2', 'Priority 3', 'Priority 4'],
    )
    expect(options.map((option) => option.attributes('aria-selected'))).toEqual([
      'false',
      'true',
      'false',
      'false',
    ])
    expect(options[1].find('.task-panel-priority-check').exists()).toBe(true)
    expect(options[0].find('.task-panel-priority-check').exists()).toBe(false)
    expect(wrapper.get('.task-panel-priority-button').attributes('aria-expanded')).toBe('true')
  })

  it('sets a priority from the menu and closes it', async () => {
    seed()
    const setPriority = vi.spyOn(items, 'setPriority').mockResolvedValue({})
    const wrapper = await mountPanel()
    await flushPromises()

    await wrapper.get('.task-panel-priority-button').trigger('click')
    await wrapper.findAll('.task-panel-priority-option')[0].trigger('click')
    await flushPromises()

    expect(setPriority).toHaveBeenCalledWith('b', 1)
    expect(wrapper.find('.task-panel-priority-menu').exists()).toBe(false)
  })

  it('does not send the priority the task already has', async () => {
    seed([{ ...ITEMS[1], priority: 3 }])
    const setPriority = vi.spyOn(items, 'setPriority').mockResolvedValue({})
    const wrapper = await mountPanel()
    await flushPromises()

    await wrapper.get('.task-panel-priority-button').trigger('click')
    await wrapper.findAll('.task-panel-priority-option')[2].trigger('click')
    await flushPromises()

    expect(setPriority).not.toHaveBeenCalled()
    expect(wrapper.find('.task-panel-priority-menu').exists()).toBe(false)
  })

  // Escape with the menu open is asking to leave the menu, not the panel.
  it('closes the priority menu on Escape without closing the panel', async () => {
    seed()
    const wrapper = await mountPanel()
    await flushPromises()

    await wrapper.get('.task-panel-priority-button').trigger('click')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()

    expect(wrapper.find('.task-panel-priority-menu').exists()).toBe(false)
    expect(router.currentRoute.value.query.task).toBe('b')
  })

  it('closes the priority menu on a click elsewhere in the panel', async () => {
    seed()
    const wrapper = await mountPanel()
    await flushPromises()

    await wrapper.get('.task-panel-priority-button').trigger('click')
    expect(wrapper.find('.task-panel-priority-menu').exists()).toBe(true)

    await wrapper.get('.task-panel-main').trigger('click')

    expect(wrapper.find('.task-panel-priority-menu').exists()).toBe(false)
    expect(router.currentRoute.value.query.task).toBe('b')
  })

  // The dialog clips its overflow and the field sits at the bottom of the
  // rail, so a menu positioned inside the rail was cut off at the dialog's
  // edge. It is fixed to the viewport instead, measured from the button.
  it('places the menu under the button, matching its width', async () => {
    seed()
    const wrapper = await mountPanel()
    await flushPromises()
    const button = wrapper.get('.task-panel-priority-button').element
    button.getBoundingClientRect = () => ({ left: 100, width: 220, top: 500, bottom: 530 })
    window.innerHeight = 900

    await button.click()
    await flushPromises()

    const style = wrapper.get('.task-panel-priority-menu').attributes('style')
    expect(style).toContain('left: 100px')
    expect(style).toContain('width: 220px')
    expect(style).toContain('top: 534px')
  })

  it('flips the menu above the button when the viewport has no room below', async () => {
    seed()
    const wrapper = await mountPanel()
    await flushPromises()
    const button = wrapper.get('.task-panel-priority-button').element
    button.getBoundingClientRect = () => ({ left: 100, width: 220, top: 500, bottom: 530 })
    window.innerHeight = 520

    await button.click()
    await flushPromises()

    // jsdom gives the menu no height, so "above" is the gap alone.
    expect(wrapper.get('.task-panel-priority-menu').attributes('style')).toContain('top: 496px')
  })

  it('deletes the task and closes', async () => {
    seed()
    const remove = vi.spyOn(items, 'deleteItem').mockResolvedValue(true)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const wrapper = await mountPanel()
    await flushPromises()

    await wrapper.get('.task-panel-delete').trigger('click')
    await flushPromises()

    expect(remove).toHaveBeenCalledWith('b')
    expect(router.currentRoute.value.query.task).toBeUndefined()
  })

  // Deleting takes the task's sub-tasks with it via ON DELETE CASCADE and
  // there is no undo, so it asks first.
  it('does not delete when the confirmation is dismissed', async () => {
    seed()
    const remove = vi.spyOn(items, 'deleteItem').mockResolvedValue(true)
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const wrapper = await mountPanel()
    await flushPromises()

    await wrapper.get('.task-panel-delete').trigger('click')
    await flushPromises()

    expect(remove).not.toHaveBeenCalled()
    expect(router.currentRoute.value.query.task).toBe('b')
  })

  it('names the task in the confirmation', async () => {
    seed()
    vi.spyOn(items, 'deleteItem').mockResolvedValue(true)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const wrapper = await mountPanel()
    await flushPromises()

    await wrapper.get('.task-panel-delete').trigger('click')

    expect(confirm).toHaveBeenCalledWith('Delete "Second"?')
  })

  // A failed delete has already notified; the panel stays put rather than
  // closing over a task that is still there.
  it('stays open when the delete fails', async () => {
    seed()
    vi.spyOn(items, 'deleteItem').mockResolvedValue(false)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const wrapper = await mountPanel()
    await flushPromises()

    await wrapper.get('.task-panel-delete').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.query.task).toBe('b')
  })
})

it('edits and removes a repeat schedule', async () => {
  seed()
  const save = vi.spyOn(items, 'setRecurrence').mockResolvedValue({ id: 'b' })
  const wrapper = await mountPanel()
  await wrapper.get('.task-repeat input').setValue('every 2nd Tuesday')
  await wrapper.get('form.task-panel-field').trigger('submit')
  await flushPromises()
  expect(save).toHaveBeenCalledWith('b', 'every 2nd Tuesday')
  await wrapper.get('.task-repeat input').setValue('')
  await wrapper.get('form.task-panel-field').trigger('submit')
  await flushPromises()
  expect(save).toHaveBeenLastCalledWith('b', null)
  wrapper.unmount()
})

it('keeps a rejected repeat draft for correction', async () => {
  seed()
  vi.spyOn(items, 'setRecurrence').mockResolvedValue(null)
  const wrapper = await mountPanel()
  await wrapper.get('.task-repeat input').setValue('every nonsense')
  await wrapper.get('form.task-panel-field').trigger('submit')
  await flushPromises()
  expect(wrapper.get('.task-repeat input').element.value).toBe('every nonsense')
  wrapper.unmount()
})

it('closes without a missing-task notification after rescheduling out of Today', async () => {
  seed([
    {
      id: 'b',
      projectId: null,
      parentId: null,
      content: 'Repeat',
      recurrence: 'every day',
      dueDate: '2026-09-05',
    },
  ])
  items.loadedProject = 'today'
  vi.spyOn(items, 'request').mockResolvedValue({
    item: { ...items.items[0], dueDate: '9999-01-01' },
  })
  const wrapper = await mountPanel()
  await wrapper.get('.task-repeat input').setValue('every Monday')
  await wrapper.get('form.task-panel-field').trigger('submit')
  await flushPromises()
  expect(items.items).toEqual([])
  expect(items.notify).not.toHaveBeenCalled()
  expect(router.currentRoute.value.query.task).toBeUndefined()
  wrapper.unmount()
})

it('stays open when completing fails', async () => {
  seed()
  vi.spyOn(items, 'setCompleted').mockResolvedValue(null)
  const wrapper = await mountPanel()
  await wrapper.get('.task-panel-check').trigger('click')
  await flushPromises()
  expect(router.currentRoute.value.query.task).toBe('b')
  wrapper.unmount()
})
