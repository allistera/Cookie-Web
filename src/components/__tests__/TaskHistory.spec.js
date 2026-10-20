import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import TaskHistory from '../TaskHistory.vue'
import { setAuth0Client } from '../../auth0-client'
import { useProjectsStore } from '../../stores/projects'
import { useTaskItemsStore } from '../../stores/taskItems'

const requestMock = vi.fn()
const created = {
  id: 'e1',
  taskId: 'task1',
  title: 'Ship it',
  action: 'created',
  occurredAt: '2026-10-16T09:00:00Z',
  changes: {},
  taskExists: true,
}
const edited = {
  ...created,
  id: 'e2',
  action: 'edited',
  occurredAt: '2026-10-16T09:05:00Z',
  changes: {
    content: { before: 'Ship', after: 'Ship it' },
    project_id: { before: null, after: 'p1' },
  },
}

function mountHistory(taskId = 'task1') {
  return mount(TaskHistory, { props: { taskId } })
}
function bullets(wrapper) {
  return wrapper.findAll('.task-history-entry').map((node) => node.get('.task-history-text').text())
}

beforeEach(() => {
  setAuth0Client(null)
  requestMock.mockReset()
  setActivePinia(createPinia())
  useProjectsStore().projects = [{ id: 'p1', parentId: null, name: 'Cookie', description: null }]
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, options) => {
      const result = await requestMock(url, options)
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      })
    }),
  )
  requestMock.mockResolvedValue({ activities: [edited, created], nextCursor: null })
})

describe('TaskHistory', () => {
  it("lists this task's changes as one bullet each, newest first", async () => {
    const wrapper = mountHistory()
    await flushPromises()

    expect(requestMock.mock.calls[0][0]).toContain('task-activity?task=task1')
    expect(bullets(wrapper)).toEqual([
      'Title changed from “Ship” to “Ship it”',
      'Moved to Cookie',
      'Created',
    ])
    expect(wrapper.findAll('time')).toHaveLength(3)
    expect(wrapper.find('progress').exists()).toBe(false)
    expect(wrapper.find('select').exists()).toBe(false)
    wrapper.unmount()
  })

  it('says so when there are no changes yet', async () => {
    requestMock.mockResolvedValue({ activities: [], nextCursor: null })
    const wrapper = mountHistory()
    await flushPromises()

    expect(wrapper.text()).toContain('No changes yet.')
    wrapper.unmount()
  })

  it('shows more on request and reports failures with a retry', async () => {
    requestMock.mockResolvedValueOnce({ activities: [edited], nextCursor: 'next' })
    const wrapper = mountHistory()
    await flushPromises()
    expect(bullets(wrapper)).toHaveLength(2)

    requestMock.mockRejectedValueOnce(new Error('Offline'))
    await wrapper.get('.task-history-more').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Could not load activity.')

    requestMock.mockResolvedValueOnce({ activities: [edited, created], nextCursor: null })
    await wrapper.get('.task-history-retry').trigger('click')
    await flushPromises()
    expect(bullets(wrapper)).toHaveLength(3)
    expect(wrapper.find('.task-history-more').exists()).toBe(false)
    wrapper.unmount()
  })

  it('appends the next page without repeating a row', async () => {
    requestMock.mockResolvedValueOnce({ activities: [edited], nextCursor: 'next' })
    const wrapper = mountHistory()
    await flushPromises()

    requestMock.mockResolvedValueOnce({ activities: [edited, created], nextCursor: null })
    await wrapper.get('.task-history-more').trigger('click')
    await flushPromises()

    expect(requestMock.mock.calls.at(-1)[0]).toContain('after=next')
    expect(bullets(wrapper)).toHaveLength(3)
    wrapper.unmount()
  })

  it('discards a stale response after switching tasks', async () => {
    let resolveOld
    requestMock.mockImplementation((url) =>
      url.includes('task=task1')
        ? new Promise((resolve) => {
            resolveOld = resolve
          })
        : Promise.resolve({ activities: [{ ...created, action: 'reopened' }], nextCursor: null }),
    )
    const wrapper = mountHistory()
    await flushPromises()
    await wrapper.setProps({ taskId: 'task2' })
    await flushPromises()
    resolveOld({ activities: [created], nextCursor: null })
    await flushPromises()

    expect(bullets(wrapper)).toEqual(['Reopened'])
    wrapper.unmount()
  })

  // An edit made in the panel goes through the items store, so its line
  // appears without a manual refresh.
  it('reloads after a confirmed task write', async () => {
    const wrapper = mountHistory()
    await flushPromises()
    expect(requestMock).toHaveBeenCalledTimes(1)

    requestMock.mockResolvedValueOnce({ items: [], nextCursor: null })
    await useTaskItemsStore().request('PATCH', { body: { id: 'task1', content: 'Updated' } })
    await flushPromises()

    expect(requestMock.mock.calls.filter(([url]) => url.includes('task-activity'))).toHaveLength(2)
    wrapper.unmount()
  })

  it('renders a changed value as text, never markup', async () => {
    requestMock.mockResolvedValue({
      activities: [
        { ...edited, changes: { content: { before: 'Old', after: '<script>bad</script>' } } },
      ],
      nextCursor: null,
    })
    const wrapper = mountHistory()
    await flushPromises()

    expect(wrapper.text()).toContain('<script>bad</script>')
    expect(wrapper.find('script').exists()).toBe(false)
    wrapper.unmount()
  })

  it('reloads when the tab becomes visible again, and stops after unmount', async () => {
    const wrapper = mountHistory()
    await flushPromises()
    expect(requestMock).toHaveBeenCalledTimes(1)

    requestMock.mockResolvedValue({
      activities: [{ ...edited, id: 'e3', occurredAt: '2026-10-16T10:00:00Z' }, edited, created],
      nextCursor: null,
    })
    document.dispatchEvent(new Event('visibilitychange'))
    await flushPromises()
    expect(requestMock).toHaveBeenCalledTimes(2)
    expect(bullets(wrapper)).toHaveLength(5)

    wrapper.unmount()
    document.dispatchEvent(new Event('visibilitychange'))
    await flushPromises()
    expect(requestMock).toHaveBeenCalledTimes(2)
  })
})
