import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useLocalToday } from '../useLocalToday'

const Host = {
  setup() {
    return { today: useLocalToday() }
  },
  template: '<span>{{ today }}</span>',
}
let wrapper
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 9, 17, 23, 59, 59))
  wrapper = mount(Host)
})
afterEach(() => {
  wrapper.unmount()
  vi.useRealTimers()
})
it('refreshes at local midnight and schedules the following day', async () => {
  expect(wrapper.text()).toBe('2026-10-17')
  await vi.advanceTimersByTimeAsync(1000)
  expect(wrapper.text()).toBe('2026-10-18')
  await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
  expect(wrapper.text()).toBe('2026-10-19')
})
it.each(['focus', 'visibilitychange'])('refreshes after returning through %s', async (event) => {
  vi.setSystemTime(new Date(2026, 9, 20, 12))
  const target = event === 'focus' ? window : document
  target.dispatchEvent(new Event(event))
  await wrapper.vm.$nextTick()
  expect(wrapper.text()).toBe('2026-10-20')
  expect(vi.getTimerCount()).toBe(1)
})
it('stops refreshing after unmount', () => {
  wrapper.unmount()
  window.dispatchEvent(new Event('focus'))
  document.dispatchEvent(new Event('visibilitychange'))
  expect(vi.getTimerCount()).toBe(0)
})
