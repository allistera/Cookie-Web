import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import NextCalendarEvent from '../NextCalendarEvent.vue'
import { useInboxStore } from '../../stores/inbox'
import { setCalendarsOwner } from '../../composables/useCalendars'
import { CALENDAR_API_URL } from '../../lib/apiWorkers'

const event = (title, start, extra = {}) => ({
  id: title,
  title,
  start,
  date: '2026-10-09',
  duration: 30,
  ...extra,
})
let wrapper
function respond(events) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ events }) }))
}
async function render() {
  wrapper = mount(NextCalendarEvent)
  await flushPromises()
  return wrapper
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 9, 9, 16, 2))
  setActivePinia(createPinia())
  vi.spyOn(useInboxStore(), 'authHeaders').mockResolvedValue({ Authorization: 'test' })
})
afterEach(() => {
  wrapper?.unmount()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
describe('NextCalendarEvent', () => {
  it('shows the earliest upcoming timed event, excluding all-day and past events', async () => {
    respond([
      event('Later', '18:00'),
      event('Past', '15:00'),
      event('Sprint planning', '16:30'),
      event('All day', '16:10', { allDay: true }),
      event('Legacy all day', '00:00', { duration: 1440 }),
      event('Tomorrow', '16:05', { date: '2026-10-10' }),
      event('Invalid', 'bad'),
    ])
    await render()
    expect(wrapper.text()).toContain('16:30')
    expect(wrapper.text()).toContain('Sprint planning')
    expect(wrapper.text()).toContain('in 28 min')
    expect(fetch).toHaveBeenCalledWith(
      `${CALENDAR_API_URL}/calendar-events?from=2026-10-09&to=2026-10-09`,
      { headers: { Authorization: 'test' } },
    )
  })
  it('updates the countdown and advances after the start time', async () => {
    respond([event('First', '16:03'), event('Second', '16:05')])
    await render()
    expect(wrapper.text()).toContain('in 1 min')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(wrapper.text()).toContain('Second')
    expect(wrapper.text()).toContain('in 2 min')
    await vi.advanceTimersByTimeAsync(120_000)
    expect(wrapper.find('.next-calendar-event').exists()).toBe(false)
  })
  it('stays hidden when there is no upcoming event or the request fails', async () => {
    respond([])
    await render()
    expect(wrapper.find('.next-calendar-event').exists()).toBe(false)
    fetch.mockResolvedValue({ ok: false })
    window.dispatchEvent(new Event('focus'))
    await flushPromises()
    expect(wrapper.find('.next-calendar-event').exists()).toBe(false)
  })
  it('refreshes on focus and clears stale events after a failed refresh', async () => {
    respond([event('Sprint planning', '16:30')])
    await render()
    fetch.mockResolvedValue({ ok: false })
    window.dispatchEvent(new Event('focus'))
    await flushPromises()
    expect(wrapper.find('.next-calendar-event').exists()).toBe(false)
  })
  it('refreshes at midnight and stops polling after unmount', async () => {
    respond([])
    vi.setSystemTime(new Date(2026, 9, 9, 23, 59, 50))
    await render()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(fetch).toHaveBeenLastCalledWith(
      `${CALENDAR_API_URL}/calendar-events?from=2026-10-10&to=2026-10-10`,
      { headers: { Authorization: 'test' } },
    )
    wrapper.unmount()
    wrapper = null
    const calls = fetch.mock.calls.length
    await vi.advanceTimersByTimeAsync(300_000)
    window.dispatchEvent(new Event('focus'))
    expect(fetch).toHaveBeenCalledTimes(calls)
  })
  it('ignores an event response from a previous account', async () => {
    let resolve
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise((done) => {
            resolve = done
          }),
      ),
    )
    wrapper = mount(NextCalendarEvent)
    await flushPromises()
    setCalendarsOwner('new-account')
    resolve({ ok: true, json: async () => ({ events: [event('Private', '16:30')] }) })
    await flushPromises()
    expect(wrapper.find('.next-calendar-event').exists()).toBe(false)
  })
})
