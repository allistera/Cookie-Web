import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DocumentCalendarSidebar from '../DocumentCalendarSidebar.vue'
import { useCalendars } from '../../composables/useCalendars'
import { useInboxStore } from '../../stores/inbox'
import { useDocumentsStore } from '../../stores/documents'

const CALENDARS_ENDPOINT = '/api/calendar-events?resource=calendars'
const EVENTS = [
  { id: 'standup', title: 'Standup', date: '2026-08-13', start: '09:00', duration: 30, calendar: 'work' },
  { id: 'holiday', title: 'Company Holiday', date: '2026-08-13', start: '00:00', duration: 1440, allDay: true, calendar: 'holidays' },
]

function mockApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      if (url === CALENDARS_ENDPOINT) {
        return { ok: true, json: async () => ({ calendars: [{ id: 'work', name: 'Work', color: '#4f7c6b' }] }) }
      }
      if (url === '/api/calendar-events?from=2026-08-13&to=2026-08-13') {
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
  it('loads and renders that day\'s all-day and timed events', async () => {
    mockApi()
    const wrapper = mount(DocumentCalendarSidebar, { props: { date: new Date(2026, 7, 13) } })
    await flushPromises()

    expect(fetch).toHaveBeenCalledWith('/api/calendar-events?from=2026-08-13&to=2026-08-13', { headers: {} })
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
    const eventsCallCount = fetch.mock.calls.filter(([url]) => url.includes('/api/calendar-events?from')).length

    await wrapper.get('[aria-label="Next month"]').trigger('click')

    expect(wrapper.get('.mini-month-label').text()).toBe('September 2026')
    expect(wrapper.find('.mini-month-day.selected').exists()).toBe(false)
    expect(
      fetch.mock.calls.filter(([url]) => url.includes('/api/calendar-events?from')).length,
    ).toBe(eventsCallCount)
  })

  it('re-fetches when the date prop changes to a different day', async () => {
    mockApi()
    const wrapper = mount(DocumentCalendarSidebar, { props: { date: new Date(2026, 7, 13) } })
    await flushPromises()

    await wrapper.setProps({ date: new Date(2026, 7, 14) })
    await flushPromises()

    expect(fetch).toHaveBeenCalledWith('/api/calendar-events?from=2026-08-14&to=2026-08-14', { headers: {} })
    expect(wrapper.get('.mini-month-day.selected').text()).toBe('14')
  })

  it('re-fetches when a document autosave completes, picking up a synced event', async () => {
    mockApi()
    mount(DocumentCalendarSidebar, { props: { date: new Date(2026, 7, 13) } })
    await flushPromises()
    const before = fetch.mock.calls.filter(([url]) => url.includes('/api/calendar-events?from')).length

    useDocumentsStore().saveState = 'saving'
    await flushPromises()
    expect(
      fetch.mock.calls.filter(([url]) => url.includes('/api/calendar-events?from')).length,
    ).toBe(before)

    useDocumentsStore().saveState = 'saved'
    await flushPromises()

    expect(
      fetch.mock.calls.filter(([url]) => url.includes('/api/calendar-events?from')).length,
    ).toBe(before + 1)
  })
})
