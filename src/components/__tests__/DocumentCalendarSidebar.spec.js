import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DocumentCalendarSidebar from '../DocumentCalendarSidebar.vue'
import { calendarEventsUrl, setCalendarsOwner, useCalendars } from '../../composables/useCalendars'
import { useInboxStore } from '../../stores/inbox'
import { useDocumentsStore } from '../../stores/documents'

import { CALENDAR_API_URL } from '../../lib/apiWorkers'

// The day's events window starts the day before, for an event that runs past
// midnight.
const eventsUrl = (day, dayBefore) => calendarEventsUrl(dayBefore, day)

const CALENDARS_ENDPOINT = `${CALENDAR_API_URL}/calendars`
const EVENTS = [
  {
    id: 'standup',
    title: 'Standup',
    date: '2026-08-13',
    start: '09:00',
    duration: 30,
    calendar: 'work',
  },
  {
    id: 'holiday',
    title: 'Company Holiday',
    date: '2026-08-13',
    start: '00:00',
    duration: 1440,
    allDay: true,
    calendar: 'holidays',
  },
]

function mockApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      if (url === CALENDARS_ENDPOINT) {
        return {
          ok: true,
          json: async () => ({ calendars: [{ id: 'work', name: 'Work', color: '#4f7c6b' }] }),
        }
      }
      if (url === eventsUrl('2026-08-13', '2026-08-12')) {
        return { ok: true, json: async () => ({ events: EVENTS }) }
      }
      return { ok: true, json: async () => ({ events: [] }) }
    }),
  )
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.spyOn(useInboxStore(), 'authHeaders').mockResolvedValue({})
  // useCalendars' state is module-level and shared; reset it between tests.
  useCalendars(vi.fn(), vi.fn()).calendars.value = []
})

describe('DocumentCalendarSidebar', () => {
  it("loads and renders that day's all-day and timed events", async () => {
    mockApi()
    const wrapper = mount(DocumentCalendarSidebar, { props: { date: new Date(2026, 7, 13) } })
    await flushPromises()

    expect(fetch).toHaveBeenCalledWith(eventsUrl('2026-08-13', '2026-08-12'), {
      headers: {},
    })
    expect(wrapper.get('.sidebar-all-day-chip').text()).toBe('Company Holiday')
    expect(wrapper.get('.sidebar-event').text()).toContain('Standup')
  })

  it('highlights the selected day in the mini month grid', async () => {
    mockApi()
    const wrapper = mount(DocumentCalendarSidebar, { props: { date: new Date(2026, 7, 13) } })
    await flushPromises()

    const selected = wrapper.find('.mini-month-day.selected')
    expect(selected.text()).toBe('13')
    expect(wrapper.get('.mini-month-label').text()).toBe('August 2026')
  })

  it('browsing the mini month forward does not change the selected day or re-fetch events', async () => {
    mockApi()
    const wrapper = mount(DocumentCalendarSidebar, { props: { date: new Date(2026, 7, 13) } })
    await flushPromises()
    const eventsCallCount = fetch.mock.calls.filter(([url]) =>
      url.includes('/calendar-events?from'),
    ).length

    await wrapper.get('[aria-label="Next month"]').trigger('click')

    expect(wrapper.get('.mini-month-label').text()).toBe('September 2026')
    expect(wrapper.find('.mini-month-day.selected').exists()).toBe(false)
    expect(fetch.mock.calls.filter(([url]) => url.includes('/calendar-events?from')).length).toBe(
      eventsCallCount,
    )
  })

  it('re-fetches when the date prop changes to a different day', async () => {
    mockApi()
    const wrapper = mount(DocumentCalendarSidebar, { props: { date: new Date(2026, 7, 13) } })
    await flushPromises()

    await wrapper.setProps({ date: new Date(2026, 7, 14) })
    await flushPromises()

    expect(fetch).toHaveBeenCalledWith(eventsUrl('2026-08-14', '2026-08-13'), {
      headers: {},
    })
    expect(wrapper.get('.mini-month-day.selected').text()).toBe('14')
  })

  it('re-fetches when a document autosave completes, picking up a synced event', async () => {
    mockApi()
    mount(DocumentCalendarSidebar, { props: { date: new Date(2026, 7, 13) } })
    await flushPromises()
    const before = fetch.mock.calls.filter(([url]) => url.includes('/calendar-events?from')).length

    useDocumentsStore().saveState = 'saving'
    await flushPromises()
    expect(fetch.mock.calls.filter(([url]) => url.includes('/calendar-events?from')).length).toBe(
      before,
    )

    useDocumentsStore().saveState = 'saved'
    await flushPromises()

    expect(fetch.mock.calls.filter(([url]) => url.includes('/calendar-events?from')).length).toBe(
      before + 1,
    )
  })
})

it('draws the part of an event from the day before that runs into this day', async () => {
  mockApi()
  const real = fetch.getMockImplementation()
  fetch.mockImplementation(async (url) =>
    url === eventsUrl('2026-08-13', '2026-08-12')
      ? {
          ok: true,
          json: async () => ({
            events: [
              { id: 'lunch', title: 'Lunch', date: '2026-08-12', start: '12:00', duration: 60 },
              {
                id: 'offsite',
                title: 'Offsite',
                date: '2026-08-12',
                start: '09:00',
                duration: 1440 + 600,
              },
              ...EVENTS,
            ],
          }),
        }
      : real(url),
  )
  const wrapper = mount(DocumentCalendarSidebar, { props: { date: new Date(2026, 7, 13) } })
  await flushPromises()

  const titles = wrapper.findAll('.sidebar-event').map((event) => event.text())
  expect(titles).toEqual(['Offsite', 'Standup'])
  // From the top of the 8 AM grid to 7 PM, where the event ends.
  const offsite = wrapper.findAll('.sidebar-event')[0].element.style
  expect(offsite.top).toBe('0px')
  expect(offsite.height).toBe(`${11 * 56}px`)
  wrapper.unmount()
})

it('moves the today mark on when the clock passes midnight', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  try {
    vi.setSystemTime(new Date(2026, 7, 13, 23, 59, 30))
    mockApi()
    const wrapper = mount(DocumentCalendarSidebar, { props: { date: new Date(2026, 7, 13) } })
    await flushPromises()
    expect(wrapper.get('.mini-month-day.today').text()).toBe('13')

    vi.advanceTimersByTime(60_000)
    await nextTick()
    expect(wrapper.get('.mini-month-day.today').text()).toBe('14')
    wrapper.unmount()
  } finally {
    vi.useRealTimers()
  }
})

it('shows partial schedule notices from a truncated response', async () => {
  mockApi()
  const real = fetch.getMockImplementation()
  fetch.mockImplementation(async (url) => {
    const response = await real(url)
    if (String(url).includes('calendar-events'))
      return { ...response, json: async () => ({ ...(await response.json()), truncated: true }) }
    return response
  })
  const wrapper = mount(DocumentCalendarSidebar, { props: { date: new Date(2026, 7, 13) } })
  await flushPromises()
  expect(wrapper.get('[role="status"]').text()).toContain('Some events could not be shown')
  wrapper.unmount()
})

it('drops a load that the account changed under before it was sent', async () => {
  mockApi()
  let release
  const gate = new Promise((resolve) => (release = resolve))
  let changed = false
  useInboxStore().authHeaders.mockImplementation(async () => {
    if (!changed) await gate
    return {}
  })
  // A day of its own: sidebars other tests left mounted reload on the change too.
  const wrapper = mount(DocumentCalendarSidebar, { props: { date: new Date(2026, 7, 20) } })
  await flushPromises()

  changed = true
  setCalendarsOwner('someone-else')
  release()
  await flushPromises()

  // Only the new account's load reached the network.
  const loads = fetch.mock.calls.filter(([url]) => url === eventsUrl('2026-08-20', '2026-08-19'))
  expect(loads).toHaveLength(1)
  wrapper.unmount()
  setCalendarsOwner(null)
})
