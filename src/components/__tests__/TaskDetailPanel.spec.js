import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import TaskDetailPanel from '../TaskDetailPanel.vue'
import { useProjectsStore } from '../../stores/projects'
import { useTaskItemsStore } from '../../stores/taskItems'

let router
let items

const ITEMS = [
  { id: 'a', content: 'First', description: null, dueDate: null, projectId: null },
  { id: 'b', content: 'Second', description: null, dueDate: null, projectId: null },
  { id: 'c', content: 'Third', description: null, dueDate: null, projectId: null },
]

function mountPanel(taskId = 'b') {
  return mount(TaskDetailPanel, { props: { taskId }, global: { plugins: [router] } })
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
    routes: [{ path: '/tasks', name: 'tasks', component: { template: '<div />' } }],
  })
  await router.push('/tasks?task=b')
  await router.isReady()
  setActivePinia(createPinia())
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
  it('renders the task the URL names', async () => {
    seed()
    const wrapper = mountPanel()
    await flushPromises()

    expect(wrapper.get('.task-panel-title').text()).toBe('Second')
  })

  it('names the Inbox when the task belongs to no project', async () => {
    seed()
    const wrapper = mountPanel()
    await flushPromises()

    expect(wrapper.get('.task-panel-project').text()).toContain('Inbox')
  })

  it('names the project when the task has one', async () => {
    seed([{ ...ITEMS[1], projectId: 'p1' }])
    const wrapper = mountPanel()
    await flushPromises()

    expect(wrapper.get('.task-panel-project').text()).toContain('Githup')
  })

  it('closes on Escape by dropping task from the query', async () => {
    seed()
    const wrapper = mountPanel()
    await flushPromises()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()

    expect(router.currentRoute.value.query.task).toBeUndefined()
    wrapper.unmount()
  })

  it('closes on a backdrop click but not on a click inside', async () => {
    seed()
    const wrapper = mountPanel()
    await flushPromises()

    await wrapper.get('.task-panel').trigger('click')
    expect(router.currentRoute.value.query.task).toBe('b')

    await wrapper.get('.task-panel-backdrop').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.task).toBeUndefined()
  })

  it('steps to the previous sibling', async () => {
    seed()
    const wrapper = mountPanel()
    await flushPromises()

    await wrapper.get('.task-panel-prev').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.query.task).toBe('a')
  })

  it('steps to the next sibling', async () => {
    seed()
    const wrapper = mountPanel()
    await flushPromises()

    await wrapper.get('.task-panel-next').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.query.task).toBe('c')
  })

  it('disables sibling navigation at the ends of the list', async () => {
    seed()
    const wrapper = mountPanel('a')
    await flushPromises()

    expect(wrapper.get('.task-panel-prev').attributes('disabled')).toBeDefined()
    expect(wrapper.get('.task-panel-next').attributes('disabled')).toBeUndefined()
  })

  // A stale link, a deleted task, or one hidden because it is complete.
  it('closes and notifies when the task is not in the loaded list', async () => {
    const wrapper = mountPanel('missing')
    seed()
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
    const wrapper = mountPanel('missing')
    await flushPromises()

    expect(items.notify).not.toHaveBeenCalled()
    expect(router.currentRoute.value.query.task).toBe('b')
    wrapper.unmount()
  })

  it('deletes the task and closes', async () => {
    seed()
    const remove = vi.spyOn(items, 'deleteItem').mockResolvedValue(true)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const wrapper = mountPanel()
    await flushPromises()

    await wrapper.get('.task-panel-delete').trigger('click')
    await flushPromises()

    expect(remove).toHaveBeenCalledWith('b')
    expect(router.currentRoute.value.query.task).toBeUndefined()
  })

  it('does not delete when the confirmation is dismissed', async () => {
    seed()
    const remove = vi.spyOn(items, 'deleteItem').mockResolvedValue(true)
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const wrapper = mountPanel()
    await flushPromises()

    await wrapper.get('.task-panel-delete').trigger('click')
    await flushPromises()

    expect(remove).not.toHaveBeenCalled()
    expect(router.currentRoute.value.query.task).toBe('b')
  })
})
