import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TaskActivity from '../TaskActivity.vue'
import { createMemoryHistory, createRouter } from 'vue-router'

const requestMock = vi.fn()
let router
let push
const event = {
  id: 'e1',
  taskId: 'task1',
  title: 'Ship it',
  action: 'created',
  occurredAt: '2026-10-16T09:00:00Z',
  changes: {},
  taskExists: true,
}
const summary = () => ({
  summary: { daily: 2, weekly: 8 },
  goals: { daily: 3, weekly: 10 },
  timeZone: 'UTC',
})
function button(wrapper, text) {
  return wrapper.findAll('button').find((node) => node.text() === text)
}

beforeEach(async () => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/tasks', component: { template: '<div />' } }],
  })
  await router.push('/tasks')
  push = vi.spyOn(router, 'push')
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, options) => {
      const result = await requestMock(url, {
        ...options,
        body: options.body ? JSON.parse(options.body) : undefined,
      })
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      })
    }),
  )
  requestMock.mockImplementation(async (url) =>
    url.includes('task-progress') ? summary() : { activities: [event], nextCursor: null },
  )
})

describe('TaskActivity', () => {
  it('shows task history and account-wide daily/weekly progress', async () => {
    const wrapper = mount(TaskActivity, {
      props: { taskId: 'task1' },
      global: { plugins: [router] },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('2 completed')
    expect(wrapper.text()).toContain('8 completed')
    expect(wrapper.text()).toContain('Created')
    expect(requestMock.mock.calls.some(([url]) => url.endsWith('task-activity?task=task1'))).toBe(
      true,
    )
    expect(wrapper.findAll('progress')).toHaveLength(2)
    wrapper.unmount()
  })
  it('saves goals, keeps failed drafts and allows goals to be disabled', async () => {
    const wrapper = mount(TaskActivity, {
      props: { taskId: 'task1' },
      global: { plugins: [router] },
    })
    await flushPromises()
    await button(wrapper, 'Set completion goals').trigger('click')
    await wrapper.findAll('input')[0].setValue('0')
    await wrapper.findAll('input')[1].setValue('20')
    requestMock.mockRejectedValueOnce(new Error('Offline'))
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('Could not save goals.')
    expect(wrapper.findAll('input')[1].element.value).toBe('20')
    requestMock.mockResolvedValueOnce({ goals: { daily: 0, weekly: 20 } })
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(requestMock).toHaveBeenLastCalledWith(
      expect.stringContaining('/task-goals'),
      expect.objectContaining({ method: 'PUT', body: { daily: 0, weekly: 20 } }),
    )
    expect(wrapper.text()).toContain('No goal set')
    expect(wrapper.text()).toContain('Goal: 20')
    wrapper.unmount()
  })
  it('pages completed history, and never offers a deleted task link', async () => {
    const wrapper = mount(TaskActivity, {
      props: { taskId: 'task1' },
      global: { plugins: [router] },
    })
    await flushPromises()
    requestMock.mockResolvedValueOnce({
      activities: [{ ...event, action: 'completed', taskExists: false }],
      nextCursor: 'next',
    })
    await wrapper.get('select').setValue('completed')
    await flushPromises()
    expect(requestMock).toHaveBeenLastCalledWith(
      expect.stringContaining('completed=true'),
      expect.anything(),
    )
    expect(wrapper.text()).toContain('(deleted task)')
    expect(wrapper.find('.task-link').exists()).toBe(false)
    requestMock.mockResolvedValueOnce({ activities: [{ ...event, id: 'e2' }], nextCursor: null })
    await button(wrapper, 'More activity').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('li')).toHaveLength(2)
    expect(requestMock).toHaveBeenLastCalledWith(
      expect.stringContaining('after=next'),
      expect.anything(),
    )
    await wrapper.get('.task-link').trigger('click')
    expect(push).toHaveBeenCalledWith({ path: '/tasks', query: { task: 'task1' } })
    wrapper.unmount()
  })
  it('discards a stale response after switching tasks', async () => {
    let resolveOld
    requestMock.mockImplementation((url) => {
      if (url.includes('task-progress')) return Promise.resolve(summary())
      if (url.includes('task=task1'))
        return new Promise((resolve) => {
          resolveOld = resolve
        })
      return Promise.resolve({
        activities: [{ ...event, id: 'new', action: 'reopened' }],
        nextCursor: null,
      })
    })
    const wrapper = mount(TaskActivity, {
      props: { taskId: 'task1' },
      global: { plugins: [router] },
    })
    await flushPromises()
    await wrapper.setProps({ taskId: 'task2' })
    await flushPromises()
    resolveOld({ activities: [event], nextCursor: null })
    await flushPromises()
    expect(wrapper.text()).toContain('Reopened')
    expect(wrapper.text()).not.toContain('Created')
    wrapper.unmount()
  })
  it('reports loading failures with retry and renders changed values as text', async () => {
    requestMock.mockRejectedValue(new Error('Offline'))
    const wrapper = mount(TaskActivity, {
      props: { taskId: 'task1' },
      global: { plugins: [router] },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('Could not load activity.')
    expect(wrapper.text()).toContain('Could not load progress.')
    requestMock.mockResolvedValueOnce({
      activities: [
        {
          ...event,
          action: 'edited',
          changes: { content: { before: 'Old', after: '<script>bad</script>' } },
        },
      ],
      nextCursor: null,
    })
    await button(wrapper, 'Retry activity').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('<script>bad</script>')
    expect(wrapper.find('script').exists()).toBe(false)
    wrapper.unmount()
  })
})
