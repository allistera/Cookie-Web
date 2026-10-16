import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { AUTH0_INJECTION_KEY } from '@auth0/auth0-vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { h, ref } from 'vue'
import { createMemoryHistory, createRouter, RouterView, useRoute } from 'vue-router'

import TaskDetailPanel from '../TaskDetailPanel.vue'
import { useProjectsStore } from '../../stores/projects'
import { useTaskCommentsStore } from '../../stores/taskComments'
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

// useAuth0() is inject()-based, so providing under its key signs the panel
// in as a named person through the real interface.
const AUTH = { [AUTH0_INJECTION_KEY]: { user: ref({ name: 'Allister Antosik' }) } }

async function mountPanel(taskId = 'b', options = {}) {
  await router.replace({ path: '/tasks', query: { task: taskId } })
  return mount(RouterView, { global: { plugins: [router], provide: AUTH }, ...options })
}

async function openMenu(wrapper) {
  await wrapper.get('.task-panel-more').trigger('click')
  await flushPromises()
}

function stubClipboard() {
  const writeText = vi.fn().mockResolvedValue()
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  return writeText
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
  it('steps to the previous and next sibling from the header', async () => {
    seed()
    const wrapper = await mountPanel()
    await flushPromises()

    await wrapper.get('.task-panel-prev').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.task).toBe('a')
    expect(wrapper.get('.task-panel-title').text()).toBe('First')

    await wrapper.get('.task-panel-next').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.task).toBe('b')
  })

  it('disables sibling navigation at the ends and skips dividers and sub-tasks', async () => {
    seed([
      ITEMS[0],
      { id: 'd', kind: 'divider', content: '', projectId: null },
      { id: 's', content: 'Step', parentId: 'a', projectId: null },
      ITEMS[1],
    ])
    const wrapper = await mountPanel('a')
    await flushPromises()

    expect(wrapper.get('.task-panel-prev').attributes('disabled')).toBeDefined()
    expect(wrapper.get('.task-panel-next').attributes('disabled')).toBeUndefined()
    await wrapper.get('.task-panel-next').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.task).toBe('b')
    expect(wrapper.get('.task-panel-next').attributes('disabled')).toBeDefined()
  })

  it('copies the task link from the header', async () => {
    seed()
    const writeText = stubClipboard()
    const wrapper = await mountPanel()
    await flushPromises()

    await wrapper.get('.task-panel-copy-link').trigger('click')
    await flushPromises()

    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/\/tasks\?task=b$/))
    expect(items.notify).toHaveBeenCalledWith('Link copied.', 'info')
  })

  it('expands the panel to fill the viewport and back', async () => {
    seed()
    const wrapper = await mountPanel()
    await flushPromises()

    await wrapper.get('.task-panel-expand').trigger('click')
    expect(wrapper.get('.task-panel').classes()).toContain('expanded')
    expect(wrapper.get('.task-panel-expand').attributes('aria-pressed')).toBe('true')
    await wrapper.get('.task-panel-expand').trigger('click')
    expect(wrapper.get('.task-panel').classes()).not.toContain('expanded')
  })

  it('opens the actions menu and closes it on Escape without closing the panel', async () => {
    seed()
    const wrapper = await mountPanel()
    await flushPromises()

    await openMenu(wrapper)
    expect(wrapper.get('.task-panel-more').attributes('aria-expanded')).toBe('true')
    // A row's text starts with its icon's ligature name; the label follows.
    const labels = wrapper
      .findAll('[role="menuitem"]')
      .map((row) => row.text().split(/\s+/).slice(1).join(' '))
    expect(labels).toEqual([
      'Duplicate',
      'Move to…',
      'Copy link to task',
      'Copy as text',
      'View activity',
      'Open in new window',
      'Delete task',
    ])

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(wrapper.find('.task-panel-menu').exists()).toBe(false)
    expect(router.currentRoute.value.query.task).toBe('b')
  })

  it('closes the actions menu on a click elsewhere in the panel', async () => {
    seed()
    const wrapper = await mountPanel()
    await flushPromises()

    await openMenu(wrapper)
    await wrapper.get('.task-panel-main').trigger('click')

    expect(wrapper.find('.task-panel-menu').exists()).toBe(false)
    expect(router.currentRoute.value.query.task).toBe('b')
  })

  it('saves and clears an estimated duration without requiring a schedule', async () => {
    seed()
    const save = vi.spyOn(items, 'setDuration').mockImplementation(async (id, value) => {
      items.itemById(id).durationMinutes = value
    })
    const wrapper = await mountPanel()
    const input = wrapper.get('[aria-label="Estimated duration in minutes"]')
    await input.setValue('75')
    expect(save).toHaveBeenLastCalledWith('b', 75)
    await input.setValue('')
    expect(save).toHaveBeenLastCalledWith('b', null)
  })

  it('duplicates the task with its fields beside it', async () => {
    seed([
      {
        ...ITEMS[1],
        description: 'Why',
        durationMinutes: 75,
        dueDate: '2026-10-20',
        dueTime: '09:00',
        timeZone: 'Europe/London',
        priority: 2,
        labels: ['home'],
        projectId: 'p1',
      },
    ])
    const createItem = vi.spyOn(items, 'createItem').mockResolvedValue({ id: 'copy' })
    const wrapper = await mountPanel()
    await flushPromises()

    await openMenu(wrapper)
    await wrapper.get('.task-panel-duplicate').trigger('click')
    await flushPromises()

    expect(createItem).toHaveBeenCalledWith({
      content: 'Second',
      projectId: 'p1',
      parentId: null,
      description: 'Why',
      durationMinutes: 75,
      dueDate: '2026-10-20',
      dueTime: '09:00',
      timeZone: 'Europe/London',
      priority: 2,
      labels: ['home'],
      recurrence: undefined,
    })
    expect(items.notify).toHaveBeenCalledWith('Task duplicated.', 'info')
    expect(wrapper.find('.task-panel-menu').exists()).toBe(false)
  })

  it('copies the task as text with its sub-tasks', async () => {
    seed([
      { ...ITEMS[1], description: '# Notes' },
      { id: 's1', content: 'Step one', parentId: 'b', completedAt: null, projectId: null },
    ])
    const writeText = stubClipboard()
    const wrapper = await mountPanel()
    await flushPromises()

    await openMenu(wrapper)
    await wrapper.get('.task-panel-copy-text').trigger('click')
    await flushPromises()

    expect(writeText).toHaveBeenCalledWith('Second\n\n# Notes\n\n- [ ] Step one')
  })

  it('reports a clipboard that refuses', async () => {
    seed()
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    })
    const wrapper = await mountPanel()
    await flushPromises()

    await wrapper.get('.task-panel-copy-link').trigger('click')
    await flushPromises()

    expect(items.notify).toHaveBeenCalledWith('Could not copy to the clipboard.', 'error')
  })

  it('switches to the Activity tab, also from the menu', async () => {
    seed()
    const wrapper = await mountPanel()
    await flushPromises()
    // v-show hides with an inline display: none; the elements stay mounted.
    const hidden = (selector) => /display: none/.test(wrapper.get(selector).attributes('style'))

    expect(hidden('[data-testid="task-comments"]')).toBe(false)
    expect(wrapper.find('.task-history').exists()).toBe(false)

    await openMenu(wrapper)
    await wrapper.get('.task-panel-view-activity').trigger('click')
    await flushPromises()
    expect(hidden('.task-history')).toBe(false)
    expect(hidden('[data-testid="task-comments"]')).toBe(true)
    expect(wrapper.get('#task-panel-tab-activity').attributes('aria-selected')).toBe('true')
    // The tab is this task's own changes, not the list view's progress report.
    expect(wrapper.find('.task-activity').exists()).toBe(false)

    await wrapper.get('#task-panel-tab-comments').trigger('click')
    expect(hidden('[data-testid="task-comments"]')).toBe(false)
    expect(hidden('.task-history')).toBe(true)
  })

  // The thread stays mounted behind the Activity tab, so a half-written
  // comment is still there on the way back.
  it('keeps a comment draft while the Activity tab is shown', async () => {
    seed()
    const wrapper = await mountPanel()
    await flushPromises()

    await wrapper.get('textarea[aria-label="Write a comment"]').setValue('Half written')
    await wrapper.get('#task-panel-tab-activity').trigger('click')
    await wrapper.get('#task-panel-tab-comments').trigger('click')

    expect(wrapper.get('textarea[aria-label="Write a comment"]').element.value).toBe('Half written')
  })

  it('marks the comment count as a lower bound while more pages remain', async () => {
    seed()
    const comments = useTaskCommentsStore()
    vi.spyOn(comments, 'loadThread').mockResolvedValue()
    comments.threads.b = {
      comments: [{ id: 'c1', body: 'x', mine: true, createdAt: '2026-10-16T09:00:00Z' }],
      nextCursor: 'more',
      loaded: true,
      loading: false,
      error: null,
    }
    const wrapper = await mountPanel()
    await flushPromises()

    expect(wrapper.get('.task-comments-count').text()).toBe('1+')
    comments.threads.b.nextCursor = null
    await flushPromises()
    expect(wrapper.get('.task-comments-count').text()).toBe('1')
  })

  // Pages are cut in the list's own order before a sort or filter applies,
  // so a later page never repeats or skips rows.
  it('sorts and filters within the page, not across pages', async () => {
    const page = Array.from({ length: 100 }, (_, index) => ({
      id: `z${index}`,
      content: `Z${String(index).padStart(3, '0')}`,
      parentId: 'b',
      completedAt: index === 0 ? '2026-09-01' : null,
      projectId: null,
    }))
    seed([...ITEMS, ...page, { id: 'a1', content: 'A001', parentId: 'b', projectId: null }])
    const wrapper = await mountPanel()
    await flushPromises()
    const names = () => wrapper.findAll('.subtask-content').map((row) => row.text())

    await wrapper.get('select[aria-label="Sort sub-tasks"]').setValue('name')
    expect(names()[0]).toBe('Z000')
    expect(names()).toHaveLength(100)
    await wrapper.get('.subtask-page-btn').trigger('click')
    await flushPromises()
    expect(names()).toEqual(['A001'])

    await wrapper.get('.task-subtasks-hide').trigger('click')
    expect(names()).toEqual(['A001'])
    expect(wrapper.find('.task-subtasks-empty').exists()).toBe(false)
  })

  it('tells a filtered page apart from an all-completed list', async () => {
    seed([
      ...ITEMS,
      { id: 's1', content: 'Done', parentId: 'b', completedAt: '2026-09-01', projectId: null },
    ])
    const wrapper = await mountPanel()
    await flushPromises()

    await wrapper.get('.task-subtasks-hide').trigger('click')
    expect(wrapper.get('.task-subtasks-empty').text()).toBe('All sub-tasks are completed.')
  })

  it('shows when the task was added and by whom', async () => {
    seed([{ ...ITEMS[1], createdAt: '2026-10-16T14:11:00' }])
    const wrapper = await mountPanel()
    await flushPromises()

    expect(wrapper.get('.task-panel-added').text()).toBe('Added 16 Oct · 14:11 by Allister A.')
  })

  it('renders the description as markdown when not editing', async () => {
    seed([{ ...ITEMS[1], description: '# heading 1\n\nParagraph\n\n```\nvar = "foo"\n```' }])
    const wrapper = await mountPanel()
    await flushPromises()

    const rendered = wrapper.get('.task-panel-description')
    expect(rendered.get('h1').text()).toBe('heading 1')
    expect(rendered.get('p').text()).toBe('Paragraph')
    expect(rendered.get('pre code').text()).toBe('var = "foo"')
  })

  it('opens the editor from the Format button and saves with Done', async () => {
    seed()
    const describeItem = vi.spyOn(items, 'describeItem').mockResolvedValue({})
    const wrapper = await mountPanel()
    await flushPromises()

    await wrapper.get('.task-panel-format').trigger('click')
    await flushPromises()
    await wrapper.get('.task-panel-description-input').setValue('Done this way')
    await wrapper.get('.task-panel-editor-done').trigger('click')
    await flushPromises()

    expect(describeItem).toHaveBeenCalledWith('b', 'Done this way')
    expect(wrapper.find('.task-panel-description-input').exists()).toBe(false)
  })

  it('wraps the selection in the mark a toolbar button names', async () => {
    seed([{ ...ITEMS[1], description: 'make it bold' }])
    const wrapper = await mountPanel()
    await flushPromises()

    await wrapper.get('.task-panel-description').trigger('click')
    await flushPromises()
    const field = wrapper.get('.task-panel-description-input').element
    field.setSelectionRange(8, 12)
    await wrapper.get('button[aria-label="Bold"]').trigger('click')
    await flushPromises()

    expect(field.value).toBe('make it **bold**')
    expect([field.selectionStart, field.selectionEnd]).toEqual([10, 14])
    expect(wrapper.find('.task-panel-description-input').exists()).toBe(true)
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
    wrapper.get('.task-panel-project').element.focus()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true }))
    expect(wrapper.get('.task-panel').element.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).not.toBe(wrapper.get('.task-panel-project').element)

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
    expect(wrapper.get('.task-subtasks-progress').attributes('aria-valuenow')).toBe('50')
    expect(wrapper.get('.task-subtasks-progress-bar').attributes('style')).toContain('width: 50%')
    const rows = wrapper.findAll('.subtask-row')
    expect(rows).toHaveLength(2)
    expect(rows[1].get('.subtask-content').classes()).toContain('done')

    await rows[0].get('.subtask-check').trigger('click')
    expect(setCompleted).toHaveBeenCalledWith('s1', true)
  })

  it('hides completed sub-tasks behind the header toggle', async () => {
    seed([
      ...ITEMS,
      { id: 's1', content: 'Step one', parentId: 'b', completedAt: null, projectId: null },
      { id: 's2', content: 'Step two', parentId: 'b', completedAt: '2026-09-01', projectId: null },
    ])
    const wrapper = await mountPanel()
    await flushPromises()

    await wrapper.get('.task-subtasks-hide').trigger('click')
    expect(wrapper.findAll('.subtask-content').map((row) => row.text())).toEqual(['Step one'])
    expect(wrapper.get('.task-subtasks-hide').text()).toBe('Show completed')
    expect(wrapper.get('.task-subtasks-count').text()).toBe('1/2')
    expect(wrapper.find('.add-subtask-btn').exists()).toBe(true)
  })

  it('sorts sub-tasks by name, date or priority', async () => {
    seed([
      ...ITEMS,
      {
        id: 's1',
        content: 'Zed',
        parentId: 'b',
        dueDate: '2026-10-02',
        priority: 4,
        projectId: null,
      },
      { id: 's2', content: 'Alpha', parentId: 'b', dueDate: null, priority: 1, projectId: null },
    ])
    const wrapper = await mountPanel()
    await flushPromises()
    const names = () => wrapper.findAll('.subtask-content').map((row) => row.text())

    expect(names()).toEqual(['Zed', 'Alpha'])
    await wrapper.get('select[aria-label="Sort sub-tasks"]').setValue('name')
    expect(names()).toEqual(['Alpha', 'Zed'])
    await wrapper.get('select[aria-label="Sort sub-tasks"]').setValue('date')
    expect(names()).toEqual(['Zed', 'Alpha'])
    await wrapper.get('select[aria-label="Sort sub-tasks"]').setValue('priority')
    expect(names()).toEqual(['Alpha', 'Zed'])
  })

  it('opens a sub-task in the panel from its row', async () => {
    seed([
      ...ITEMS,
      { id: 's1', content: 'Step one', parentId: 'b', completedAt: null, projectId: null },
    ])
    const wrapper = await mountPanel()
    await flushPromises()

    await wrapper.get('.subtask-open').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.query.task).toBe('s1')
    expect(wrapper.get('.task-panel-title').text()).toBe('Step one')
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
  it('reopens a completed task opened from history', async () => {
    seed([
      { id: 'b', content: 'Finished task', projectId: null, completedAt: '2026-10-16T09:00:00Z' },
    ])
    const reopen = vi.spyOn(items, 'setCompleted').mockResolvedValue({})
    const wrapper = await mountPanel()
    await flushPromises()
    const check = wrapper.get('button[aria-label="Reopen Finished task"]')
    expect(check.attributes('aria-pressed')).toBe('true')
    await check.trigger('click')
    await flushPromises()
    expect(reopen).toHaveBeenCalledWith('b', false)
    expect(router.currentRoute.value.query.task).toBeUndefined()
    wrapper.unmount()
  })

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

  // The panel is keyed by task id: a completion that settles after another
  // task was opened must not close that other task's panel.
  it('leaves the next task open when a completion settles after switching', async () => {
    seed()
    let settle
    vi.spyOn(items, 'setCompleted').mockReturnValue(
      new Promise((resolve) => {
        settle = resolve
      }),
    )
    const wrapper = await mountPanel()
    await flushPromises()

    await wrapper.get('.task-panel-check').trigger('click')
    await router.push({ path: '/tasks', query: { task: 'c' } })
    await flushPromises()
    settle({})
    await flushPromises()

    expect(router.currentRoute.value.query.task).toBe('c')
    expect(wrapper.get('.task-panel-title').text()).toBe('Third')
  })

  it('leaves the next task open when a delete settles after switching', async () => {
    seed()
    let settle
    vi.spyOn(items, 'deleteItem').mockReturnValue(
      new Promise((resolve) => {
        settle = resolve
      }),
    )
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const wrapper = await mountPanel()
    await flushPromises()

    await openMenu(wrapper)
    await wrapper.get('.task-panel-delete').trigger('click')
    await router.push({ path: '/tasks', query: { task: 'a' } })
    await flushPromises()
    settle(true)
    await flushPromises()

    expect(router.currentRoute.value.query.task).toBe('a')
  })

  const openPicker = async (wrapper) => {
    await wrapper.get('.task-panel-project').trigger('click')
    await flushPromises()
  }
  const pickerOption = (wrapper, name) =>
    wrapper
      .findAll('.task-project-option')
      .find((node) => node.get('.task-project-option-name').text() === name)

  it("marks the task's current project in the picker", async () => {
    seed([{ ...ITEMS[1], projectId: 'p1' }])
    const wrapper = await mountPanel()
    await flushPromises()
    await openPicker(wrapper)

    expect(pickerOption(wrapper, 'Githup').attributes('aria-selected')).toBe('true')
    expect(pickerOption(wrapper, 'Inbox').attributes('aria-selected')).toBe('false')
  })

  it('marks the Inbox when the task belongs to no project', async () => {
    seed()
    const wrapper = await mountPanel()
    await flushPromises()
    await openPicker(wrapper)

    expect(pickerOption(wrapper, 'Inbox').attributes('aria-selected')).toBe('true')
  })

  it('lists a search box, the Inbox and every project', async () => {
    seed()
    const wrapper = await mountPanel()
    await flushPromises()
    expect(wrapper.find('.task-project-menu').exists()).toBe(false)
    await openPicker(wrapper)

    expect(wrapper.get('.task-project-search').attributes('placeholder')).toBe(
      'Type a project name',
    )
    const options = wrapper.findAll('.task-project-option-name')
    expect(options.map((option) => option.text())).toEqual(['Inbox', 'Githup'])
  })

  it('moves the task to another project', async () => {
    seed()
    const move = vi.spyOn(items, 'moveItem').mockResolvedValue({})
    const wrapper = await mountPanel()
    await flushPromises()
    await openPicker(wrapper)

    await pickerOption(wrapper, 'Githup').trigger('click')
    await flushPromises()

    expect(move).toHaveBeenCalledWith('b', 'p1')
    expect(wrapper.find('.task-project-menu').exists()).toBe(false)
  })

  // The Inbox is the absence of a project, so it goes over the wire as null.
  it('moves the task to the Inbox as null', async () => {
    seed([{ ...ITEMS[1], projectId: 'p1' }])
    const move = vi.spyOn(items, 'moveItem').mockResolvedValue({})
    const wrapper = await mountPanel()
    await flushPromises()
    await openPicker(wrapper)

    await pickerOption(wrapper, 'Inbox').trigger('click')
    await flushPromises()

    expect(move).toHaveBeenCalledWith('b', null)
  })

  it('finds a project by typing its name', async () => {
    seed()
    const move = vi.spyOn(items, 'moveItem').mockResolvedValue({})
    const wrapper = await mountPanel()
    await flushPromises()
    await openPicker(wrapper)

    await wrapper.get('.task-project-search').setValue('git')
    expect(wrapper.findAll('.task-project-option-name').map((node) => node.text())).toEqual([
      'Githup',
    ])
    await wrapper.get('.task-project-search').trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(move).toHaveBeenCalledWith('b', 'p1')
  })

  // "Move to…" in the menu is the same picker, opened with its search ready.
  it('opens the picker from Move to… in the menu', async () => {
    seed()
    await router.replace({ path: '/tasks', query: { task: 'b' } })
    const wrapper = mount(RouterView, {
      global: { plugins: [router], provide: AUTH },
      attachTo: document.body,
    })
    await flushPromises()

    await openMenu(wrapper)
    await wrapper.get('.task-panel-move').trigger('click')
    await flushPromises()
    await flushPromises()

    expect(wrapper.find('.task-project-menu').exists()).toBe(true)
    expect(document.activeElement).toBe(wrapper.get('.task-project-search').element)
    wrapper.unmount()
  })

  const openSchedule = async (wrapper) => {
    await wrapper.get('.task-panel-schedule').trigger('click')
    await flushPromises()
  }
  const typeDate = async (wrapper, text) => {
    await wrapper.get('.task-panel-date-input').setValue(text)
    await wrapper.get('.task-panel-date-input').trigger('keydown', { key: 'Enter' })
    await flushPromises()
  }

  it('sets a due date typed into the schedule picker', async () => {
    seed()
    const setDue = vi.spyOn(items, 'setDueDate').mockResolvedValue({})
    const wrapper = await mountPanel()
    await flushPromises()
    expect(wrapper.find('.task-schedule-menu').exists()).toBe(false)

    await openSchedule(wrapper)
    await typeDate(wrapper, '2026-09-01')

    expect(setDue).toHaveBeenCalledWith('b', '2026-09-01')
    expect(wrapper.find('.task-schedule-menu').exists()).toBe(false)
  })

  it('sets a due date from a calendar day', async () => {
    seed()
    const setDue = vi.spyOn(items, 'setDueDate').mockResolvedValue({})
    const wrapper = await mountPanel()
    await flushPromises()
    await openSchedule(wrapper)

    const day = wrapper.findAll('.task-schedule-day[data-date]').at(-1)
    await day.trigger('click')
    await flushPromises()

    expect(setDue).toHaveBeenCalledWith('b', day.attributes('data-date'))
  })

  it('shows the date the task already has on the chip', async () => {
    seed([{ ...ITEMS[1], dueDate: '2026-09-01' }])
    const wrapper = await mountPanel()
    await flushPromises()

    expect(wrapper.get('.task-panel-schedule').text()).toContain('1 Sep')
    expect(wrapper.get('.task-panel-schedule').classes()).toContain('set')
  })

  it('clears a due date with No date', async () => {
    seed([{ ...ITEMS[1], dueDate: '2026-09-01' }])
    const setDue = vi.spyOn(items, 'setDueDate').mockResolvedValue({})
    const wrapper = await mountPanel()
    await flushPromises()
    await openSchedule(wrapper)

    await wrapper.get('.task-schedule-nodate').trigger('click')
    await flushPromises()

    expect(setDue).toHaveBeenCalledWith('b', null)
  })

  // An emptied date box means "no date", which is null on the wire — not
  // an empty string, which the server would refuse.
  it('sends null when the typed date is emptied', async () => {
    seed([{ ...ITEMS[1], dueDate: '2026-09-01' }])
    const setDue = vi.spyOn(items, 'setDueDate').mockResolvedValue({})
    const wrapper = await mountPanel()
    await flushPromises()
    await openSchedule(wrapper)

    await typeDate(wrapper, '')

    expect(setDue).toHaveBeenCalledWith('b', null)
  })

  it('keeps the picker open and explains a date it cannot read', async () => {
    seed()
    const setDue = vi.spyOn(items, 'setDueDate').mockResolvedValue({})
    const wrapper = await mountPanel()
    await flushPromises()
    await openSchedule(wrapper)

    await typeDate(wrapper, 'soon')

    expect(setDue).not.toHaveBeenCalled()
    expect(wrapper.get('.task-schedule-error').text()).toContain('Could not read that date')
    expect(wrapper.find('.task-schedule-menu').exists()).toBe(true)
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
    expect(wrapper.get('.task-panel-schedule').text()).toContain('15:00')

    await openSchedule(wrapper)
    expect(wrapper.get('.task-schedule-time-toggle').text()).toContain('15:00')
    await wrapper.get('.task-schedule-time-toggle').trigger('click')
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
    await openSchedule(wrapper)
    await wrapper.get('.task-schedule-time-toggle').trigger('click')

    expect(wrapper.get('.task-panel-time-input').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('Choose a date first.')
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
    await openSchedule(wrapper)
    await wrapper.get('.task-schedule-time-toggle').trigger('click')

    await wrapper.get('.task-panel-time-input').setValue('')
    await flushPromises()

    expect(setDueTime).toHaveBeenCalledWith('b', null, null)
  })

  // Escape with the picker open leaves the picker, not the panel.
  it('closes the schedule picker on Escape and keeps the panel', async () => {
    seed()
    await router.replace({ path: '/tasks', query: { task: 'b' } })
    const wrapper = mount(RouterView, {
      global: { plugins: [router], provide: AUTH },
      attachTo: document.body,
    })
    await flushPromises()
    await openSchedule(wrapper)
    expect(document.activeElement).toBe(wrapper.get('.task-panel-date-input').element)

    await wrapper.get('.task-panel-date-input').trigger('keydown', { key: 'Escape' })
    await flushPromises()

    expect(wrapper.find('.task-schedule-menu').exists()).toBe(false)
    expect(router.currentRoute.value.query.task).toBe('b')
    expect(document.activeElement).toBe(wrapper.get('.task-panel-schedule').element)
    wrapper.unmount()
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

  // Priority is Todoist's four levels: 1 the most urgent, 4 the default,
  // laid out as four buttons with the current one pressed.
  it('shows the default priority pressed for a task that has none', async () => {
    seed()
    const wrapper = await mountPanel()
    await flushPromises()

    const buttons = wrapper.findAll('.task-panel-priority-button')
    expect(buttons.map((button) => button.get('.task-panel-priority-short').text())).toEqual([
      'P1',
      'P2',
      'P3',
      'P4',
    ])
    expect(buttons.map((button) => button.attributes('aria-pressed'))).toEqual([
      'false',
      'false',
      'false',
      'true',
    ])
    expect(buttons[3].get('.priority-flag').classes()).toContain('priority-4')
    expect(wrapper.get('.task-panel-priority-current').text()).toBe('Priority 4')
  })

  it('shows the priority the task already has', async () => {
    seed([{ ...ITEMS[1], priority: 1 }])
    const wrapper = await mountPanel()
    await flushPromises()

    const pressed = wrapper.get('.task-panel-priority-button[aria-pressed="true"]')
    expect(pressed.attributes('aria-label')).toBe('Priority 1')
    expect(pressed.get('.priority-flag').classes()).toContain('priority-1')
  })

  it('sets a priority from its button', async () => {
    seed()
    const setPriority = vi.spyOn(items, 'setPriority').mockResolvedValue({})
    const wrapper = await mountPanel()
    await flushPromises()

    await wrapper.findAll('.task-panel-priority-button')[0].trigger('click')
    await flushPromises()

    expect(setPriority).toHaveBeenCalledWith('b', 1)
  })

  it('does not send the priority the task already has', async () => {
    seed([{ ...ITEMS[1], priority: 3 }])
    const setPriority = vi.spyOn(items, 'setPriority').mockResolvedValue({})
    const wrapper = await mountPanel()
    await flushPromises()

    await wrapper.findAll('.task-panel-priority-button')[2].trigger('click')
    await flushPromises()

    expect(setPriority).not.toHaveBeenCalled()
  })

  it('deletes the task and closes', async () => {
    seed()
    const remove = vi.spyOn(items, 'deleteItem').mockResolvedValue(true)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const wrapper = await mountPanel()
    await flushPromises()

    await openMenu(wrapper)
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

    await openMenu(wrapper)
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

    await openMenu(wrapper)
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

    await openMenu(wrapper)
    await wrapper.get('.task-panel-delete').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.query.task).toBe('b')
  })
})

// The repeat rule lives behind the schedule chip's Repeat button.
async function openRepeat(wrapper) {
  await flushPromises()
  await wrapper.get('.task-panel-schedule').trigger('click')
  await flushPromises()
  await wrapper.get('.task-schedule-repeat-toggle').trigger('click')
  await flushPromises()
}

it('edits and removes a repeat schedule', async () => {
  seed()
  const save = vi.spyOn(items, 'setRecurrence').mockResolvedValue({ id: 'b' })
  const wrapper = await mountPanel()
  await openRepeat(wrapper)
  await wrapper.get('.task-repeat input').setValue('every 2nd Tuesday')
  await wrapper.get('form.task-panel-repeat').trigger('submit')
  await flushPromises()
  expect(save).toHaveBeenCalledWith('b', 'every 2nd Tuesday')
  await wrapper.get('.task-repeat input').setValue('')
  await wrapper.get('form.task-panel-repeat').trigger('submit')
  await flushPromises()
  expect(save).toHaveBeenLastCalledWith('b', null)
  wrapper.unmount()
})

it('keeps a rejected repeat draft for correction', async () => {
  seed()
  vi.spyOn(items, 'setRecurrence').mockResolvedValue(null)
  const wrapper = await mountPanel()
  await openRepeat(wrapper)
  await wrapper.get('.task-repeat input').setValue('every nonsense')
  await wrapper.get('form.task-panel-repeat').trigger('submit')
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
  await openRepeat(wrapper)
  await wrapper.get('.task-repeat input').setValue('every Monday')
  await wrapper.get('form.task-panel-repeat').trigger('submit')
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
