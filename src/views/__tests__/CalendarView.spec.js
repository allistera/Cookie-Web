import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CalendarView from '../CalendarView.vue'
import { useInboxStore } from '../../stores/inbox'
import { resetCalendarsStateForTests } from '../../composables/useCalendars'

const SEED_EVENTS = [
  {
    id: 'team-sync',
    title: 'Team sync',
    date: '2026-07-20',
    start: '09:00',
    duration: 30,
    calendar: 'work',
    autoScheduled: true,
  },
  {
    id: 'priya',
    title: '1:1 with Priya',
    date: '2026-07-21',
    start: '10:00',
    duration: 30,
    calendar: 'work',
    autoScheduled: true,
  },
  {
    id: 'focus',
    title: 'Focus — Q3 planning',
    date: '2026-07-22',
    start: '13:00',
    duration: 120,
    tone: 'dark',
    calendar: 'focus',
  },
  // Dated within the next 30 days (REFERENCE_DATE is 2026-07-24) so the real
  // conflict detector in CalendarView.vue actually finds this overlap.
  { id: 'design', title: 'Design review', date: '2026-07-25', start: '11:00', duration: 60, calendar: 'work' },
  {
    id: 'client-call',
    title: 'Client call — Meridian',
    date: '2026-07-25',
    start: '11:30',
    duration: 60,
    tone: 'conflict',
    calendar: 'work',
  },
  { id: 'standup', title: 'Standup', date: '2026-07-24', start: '09:00', duration: 30, calendar: 'work' },
  {
    id: 'recurring-review-2026-07-24',
    seriesId: 'recurring-review',
    seriesDate: '2026-07-10',
    date: '2026-07-24',
    title: 'Recurring review',
    start: '16:00',
    duration: 30,
    calendar: 'work',
    recurrenceRule: 'FREQ=WEEKLY',
  },
  {
    id: 'coffee',
    title: 'Coffee with Sam',
    date: '2026-07-24',
    start: '14:30',
    duration: 30,
    tone: 'accepted',
    calendar: 'personal',
  },
  {
    id: 'holiday',
    title: 'Company Holiday',
    date: '2026-07-24',
    start: '00:00',
    duration: 1440,
    // Legacy rows may not include allDay even though their timing identifies
    // them as whole-day events.
    calendar: 'holidays',
  },
]

// A real fetch response always round-trips through JSON, so the object a
// caller receives is never reference-equal to anything the "server" holds.
// Skipping that clone here would let Vue's reactive-proxy `set` trap see
// "the same object" and silently skip the update (a mock-only artifact,
// not a real bug — see the git history for how this was diagnosed).
const clone = (value) => JSON.parse(JSON.stringify(value))

const SEED_CALENDARS = [
  { id: 'work', name: 'Work', color: '#4f7c6b' },
  { id: 'personal', name: 'Personal', color: '#2db985' },
  { id: 'focus', name: 'Focus time', color: '#795da8' },
  { id: 'birthdays', name: 'Birthdays', color: '#d8953b' },
  { id: 'holidays', name: 'Holidays', color: '#d15c4e' },
]
const CALENDARS_ENDPOINT = '/api/calendar-events?resource=calendars'
const isEventsEndpoint = (url) =>
  url === '/api/calendar-events' ||
  (url.startsWith('/api/calendar-events?') && !url.includes('resource='))

// Stands in for the calendar-events and calendar-management APIs with in-memory
// lists, mirroring the local Vite fixture middleware's behavior closely
// enough for these tests.
function mockCalendarApi() {
  let events = SEED_EVENTS.map((event) => ({ ...event }))
  let calendars = SEED_CALENDARS.map((calendar) => ({ ...calendar }))
  let nextId = 1
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, options = {}) => {
      const method = options.method || 'GET'
      const body = options.body ? JSON.parse(options.body) : {}

      if (isEventsEndpoint(url)) {
        if (method === 'GET') {
          // Honor the from/to window the way the real API does: non-recurring
          // rows are filtered by date, recurring masters always come back.
          const params = new URLSearchParams(url.split('?')[1] ?? '')
          const from = params.get('from')
          const to = params.get('to')
          const windowed =
            from && to
              ? events.filter((event) => event.recurrenceRule || (event.date >= from && event.date <= to))
              : events
          return { ok: true, json: async () => clone({ events: windowed }) }
        }
        if (method === 'POST') {
          const event = { id: `generated-${nextId++}`, ...body }
          events = [...events, event]
          return { ok: true, json: async () => clone({ event }) }
        }
        if (method === 'PATCH') {
          const index = events.findIndex((item) => item.id === body.id || item.seriesId === body.id)
          events[index] = { ...events[index], ...body }
          return { ok: true, json: async () => clone({ event: events[index] }) }
        }
        if (method === 'DELETE') {
          events = events.filter((item) => item.id !== body.id)
          return { ok: true, json: async () => ({ ok: true }) }
        }
      }

      if (url === CALENDARS_ENDPOINT) {
        if (method === 'GET') return { ok: true, json: async () => clone({ calendars }) }
        if (method === 'POST' && body.action === 'sync') {
          const calendar = calendars.find((item) => item.id === body.id)
          if (!calendar?.subscriptionUrl) return { ok: false, status: 404, json: async () => ({ error: 'not found' }) }
          calendar.subscriptionSyncedAt = '2026-07-24T12:00:00.000Z'
          calendar.subscriptionError = null
          events = [
            ...events.filter((event) => event.calendar !== calendar.id),
            { id: `synced-${nextId++}`, title: 'Synced meetup', date: '2026-07-24', start: '16:00', duration: 30, calendar: calendar.id },
          ]
          return { ok: true, json: async () => ({ ok: true, subscriptionSyncedAt: calendar.subscriptionSyncedAt, subscriptionError: null }) }
        }
        if (method === 'POST') {
          if (calendars.some((calendar) => calendar.name === body.name)) {
            return { ok: false, status: 409, json: async () => ({ error: 'duplicate' }) }
          }
          const calendar = { id: `generated-calendar-${nextId++}`, ...body }
          if (body.subscriptionUrl) {
            calendar.subscriptionSyncedAt = '2026-07-24T12:00:00.000Z'
            calendar.subscriptionError = null
            events = [
              ...events,
              { id: `synced-${nextId++}`, title: 'Imported standup', date: '2026-07-24', start: '10:00', duration: 30, calendar: calendar.id },
            ]
          }
          calendars = [...calendars, calendar]
          return { ok: true, json: async () => clone({ calendar }) }
        }
        if (method === 'PATCH') {
          const index = calendars.findIndex((item) => item.id === body.id)
          if (index === -1) return { ok: false, status: 404, json: async () => ({ error: 'not found' }) }
          if (calendars.some((item) => item.id !== body.id && item.name === body.name)) {
            return { ok: false, status: 409, json: async () => ({ error: 'duplicate' }) }
          }
          calendars[index] = { ...calendars[index], name: body.name }
          return { ok: true, json: async () => clone({ calendar: calendars[index] }) }
        }
        if (method === 'DELETE') {
          const eventCount = events.filter((event) => event.calendar === body.id).length
          if (eventCount > 0) {
            return {
              ok: false,
              status: 409,
              json: async () => ({
                error: `This calendar has ${eventCount} event${eventCount === 1 ? '' : 's'}. Delete or move them first.`,
              }),
            }
          }
          calendars = calendars.filter((item) => item.id !== body.id)
          return { ok: true, json: async () => ({ ok: true }) }
        }
      }

      throw new Error(`Unexpected fetch: ${method} ${url}`)
    }),
  )
}

function mockRect(element) {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    top: 0,
    left: 0,
    width: 700,
    height: 1056,
    right: 700,
    bottom: 1056,
    x: 0,
    y: 0,
    toJSON() {},
  })
}

// Mounts and waits for the initial GET /api/calendar-events to resolve, so
// the seed events are already rendered before the test interacts with them.
async function mountCalendar(options) {
  const wrapper = mount(CalendarView, options)
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  // CalendarView reads new Date() once at setup to compute "today" (REFERENCE_DATE).
  // Freeze it to match every fixture date below instead of drifting with the
  // real clock; individual tests can override the time-of-day further.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 6, 24, 10, 30))
  setActivePinia(createPinia())
  const store = useInboxStore()
  vi.spyOn(store, 'authHeaders').mockResolvedValue({})
  vi.spyOn(store, 'notify').mockImplementation(() => {})
  mockCalendarApi()
  // useCalendars' "already loaded" state is a module-level singleton (by
  // design, see its own comments); without this, a later test's mount would
  // reuse an earlier test's cached calendars instead of hitting the fake
  // backend mockCalendarApi() just reset above.
  resetCalendarsStateForTests()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('CalendarView', () => {
  it('shows the calendar sidebar and filters events by calendar', async () => {
    const wrapper = await mountCalendar()
    const calendarButtons = wrapper.findAll('.calendar-list-item')

    expect(calendarButtons).toHaveLength(5)
    expect(calendarButtons.map((button) => button.get('.nav-text').text())).toEqual([
      'Work',
      'Personal',
      'Focus time',
      'Birthdays',
      'Holidays',
    ])
    expect(wrapper.findAll('.calendar-sidebar-label').map((label) => label.text())).toEqual(['Calendars'])
    expect(wrapper.get('.calendar-manage-link').text()).toContain('Manage calendars')
    expect(wrapper.find('.calendar-add-btn').exists()).toBe(false)
    expect(wrapper.find('.day-event').text()).toContain('Standup')

    await calendarButtons[0].trigger('click')
    expect(calendarButtons[0].attributes('aria-pressed')).toBe('false')
    expect(wrapper.find('.day-event').exists()).toBe(true)
    expect(wrapper.find('.day-event').text()).toContain('Coffee with Sam')
    expect(wrapper.text()).not.toContain('Standup')

    await calendarButtons[0].trigger('click')
    expect(wrapper.text()).toContain('Standup')
  })

  it('colors an event chip to match its owning calendar', async () => {
    const wrapper = await mountCalendar()

    // Standup is on the Work calendar (#4f7c6b) with the default tone, so it
    // should pick up the calendar's color rather than a fixed neutral.
    const standup = wrapper.find('.day-event')
    expect(standup.text()).toContain('Standup')
    expect(standup.element.style.getPropertyValue('--event-color')).toBe('#4f7c6b')

    await wrapper.get('.calendar-view-tabs button:nth-child(3)').trigger('click')
    const designReview = wrapper.findAll('.month-event').find((event) => event.text().includes('Design review'))
    expect(designReview.element.style.getPropertyValue('--event-color')).toBe('#4f7c6b')
  })

  it('switches between the supplied Day, Week, and Month calendar states', async () => {
    const wrapper = await mountCalendar()

    expect(wrapper.get('h1').text()).toBe('Friday, July 24, 2026')
    expect(wrapper.find('.day-calendar').exists()).toBe(true)
    expect(wrapper.find('.calendar-insights').exists()).toBe(true)

    await wrapper.get('.calendar-view-tabs button:nth-child(2)').trigger('click')
    expect(wrapper.get('h1').text()).toBe('Jul 20 – 26, 2026')
    expect(wrapper.find('.week-calendar').exists()).toBe(true)
    expect(wrapper.find('.calendar-insights').exists()).toBe(false)

    await wrapper.get('.calendar-view-tabs button:nth-child(3)').trigger('click')
    expect(wrapper.get('h1').text()).toBe('July 2026')
    expect(wrapper.find('.month-calendar').exists()).toBe(true)
    expect(wrapper.findAll('.month-day')).toHaveLength(35)
    expect(wrapper.find('.calendar-insights').exists()).toBe(true)
  })

  it('fetches a window around the visible date and refetches when navigation leaves it', async () => {
    const wrapper = await mountCalendar()
    const fetchMock = globalThis.fetch
    const eventGets = () =>
      fetchMock.mock.calls.filter(
        ([url, options]) =>
          String(url).startsWith('/api/calendar-events?from=') &&
          !(options?.method && options.method !== 'GET'),
      )

    // The initial load is already windowed instead of fetching everything.
    expect(eventGets()).toHaveLength(1)
    const initialUrl = eventGets()[0][0]
    expect(initialUrl).toMatch(/from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}/)

    // A one-week hop stays inside the loaded window — no new request.
    await wrapper.get('[aria-label="Next period"]').trigger('click')
    await flushPromises()
    expect(eventGets()).toHaveLength(1)

    // Jumping months ahead leaves the window and refetches a later one.
    await wrapper.get('.calendar-view-tabs button:nth-child(3)').trigger('click')
    for (let i = 0; i < 6; i += 1) {
      await wrapper.get('[aria-label="Next period"]').trigger('click')
    }
    await flushPromises()
    const requests = eventGets()
    expect(requests.length).toBeGreaterThan(1)
    const lastTo = new URLSearchParams(requests.at(-1)[0].split('?')[1]).get('to')
    const initialTo = new URLSearchParams(initialUrl.split('?')[1]).get('to')
    expect(lastTo > initialTo).toBe(true)
  })

  it('positions the current-time line from the real clock in Day and Week views', async () => {
    // Fake only Date so flushPromises (which relies on real setTimeout) still works.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 6, 24, 10, 30))
    try {
      const wrapper = await mountCalendar()

      // 10:30 AM is 2.5 hours past the 8 AM grid start, at 96px per hour.
      const dayLine = wrapper.get('.day-current-time')
      expect(dayLine.element.style.top).toBe('240px')
      expect(dayLine.attributes('aria-label')).toBe('Current time 10:30 AM')

      await wrapper.get('.calendar-view-tabs button:nth-child(2)').trigger('click')
      const weekLine = wrapper.get('.week-current-time')
      expect(weekLine.element.style.top).toBe('180px')
      // Today (Friday) is the fifth column of the Monday-first week; jsdom
      // serializes calc(4 * (100% / 7)) down to a percentage.
      expect(weekLine.element.style.left).toBe('calc(57.1429%)')
    } finally {
      vi.useRealTimers()
    }
  })

  it('hides the current-time line when the clock is outside the visible hours', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 6, 24, 6, 0))
    try {
      const wrapper = await mountCalendar()
      expect(wrapper.find('.day-current-time').exists()).toBe(false)

      await wrapper.get('.calendar-view-tabs button:nth-child(2)').trigger('click')
      expect(wrapper.find('.week-current-time').exists()).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('renders a legacy 24-hour event as a banner chip in Day view, not a positioned block', async () => {
    const wrapper = await mountCalendar()

    const banner = wrapper.get('.all-day-row')
    expect(banner.text()).toContain('Company Holiday')
    expect(wrapper.findAll('.day-event').map((el) => el.text())).not.toContain('Company Holiday')
  })

  it('renders an all-day event in the week view banner under its own day column, not the hourly grid', async () => {
    const wrapper = await mountCalendar()
    await wrapper.get('.calendar-view-tabs button:nth-child(2)').trigger('click')

    const banner = wrapper.get('.week-all-day-row')
    expect(banner.text()).toContain('Company Holiday')
    expect(wrapper.findAll('.week-event').map((el) => el.text())).not.toContain('Company Holiday')
  })

  it('opens an all-day event from its banner chip', async () => {
    const wrapper = await mountCalendar({ attachTo: document.body })

    await wrapper.get('.all-day-event').trigger('click')

    expect(wrapper.get('.new-event-title-input').element.value).toBe('Company Holiday')
    wrapper.unmount()
  })

  it('navigates by the active view period and returns to the reference date', async () => {
    const wrapper = await mountCalendar()
    const next = wrapper.get('button[aria-label="Next period"]')

    await next.trigger('click')
    expect(wrapper.get('h1').text()).toBe('Saturday, July 25, 2026')
    await wrapper.get('.today-button').trigger('click')
    expect(wrapper.get('h1').text()).toBe('Friday, July 24, 2026')

    await wrapper.get('.calendar-view-tabs button:nth-child(2)').trigger('click')
    await next.trigger('click')
    expect(wrapper.get('h1').text()).toBe('Jul 27 – Aug 2, 2026')

    await wrapper.get('.calendar-view-tabs button:nth-child(3)').trigger('click')
    await next.trigger('click')
    expect(wrapper.get('h1').text()).toBe('August 2026')
  })

  it('opens the New event dialog as a manual form with title focused and no AI input', async () => {
    const wrapper = await mountCalendar({ attachTo: document.body })

    await wrapper.get('.calendar-sidebar-create').trigger('click')

    const title = wrapper.get('.new-event-title-input')
    expect(title.attributes('placeholder')).toBe('New event')
    expect(title.element).toBe(document.activeElement)

    const description = wrapper.get('.new-event-description-input')
    expect(description.attributes('placeholder')).toBe('Tell Cookie what you need — it fills in the rest')

    expect(wrapper.find('.composer-ai-inline').exists()).toBe(false)
    expect(wrapper.find('input[placeholder="Add location"]').exists()).toBe(true)
    expect(wrapper.get('.new-event-create').text()).toBe('Create Event')

    const create = wrapper.get('.new-event-create')
    expect(create.attributes('disabled')).toBeDefined()

    await title.setValue('Lunch with Mia')
    expect(wrapper.get('.new-event-create').attributes('disabled')).toBeUndefined()
    await wrapper.get('.new-event-create').trigger('click')
    await flushPromises()

    expect(wrapper.find('.new-event-dialog').exists()).toBe(false)
    expect(wrapper.text()).toContain('Lunch with Mia')
    wrapper.unmount()
  })

  it('ignores a second Create click fired before the first request resolves', async () => {
    const wrapper = await mountCalendar({ attachTo: document.body })

    await wrapper.get('.calendar-sidebar-create').trigger('click')
    await wrapper.get('.new-event-title-input').setValue('Lunch with Mia')

    const create = wrapper.get('.new-event-create')
    // Both dispatches run synchronously before either handler's first await
    // yields, so the second call must observe the in-flight guard.
    create.trigger('click')
    create.trigger('click')
    await flushPromises()

    const postCalls = fetch.mock.calls.filter(
      ([url, options]) => url === '/api/calendar-events' && options?.method === 'POST',
    )
    expect(postCalls).toHaveLength(1)
    wrapper.unmount()
  })

  it('creates an event by dragging on the day timeline, prefilling date, start, and end', async () => {
    const wrapper = await mountCalendar({ attachTo: document.body })
    const lane = wrapper.get('.day-event-lane')
    mockRect(lane.element)

    // DAY_HOUR_HEIGHT is 96px/hour starting at 8 AM: clientY 96 -> 9:00, clientY 192 -> 10:00.
    await lane.trigger('mousedown', { clientY: 96, button: 0 })
    await lane.trigger('mousemove', { clientY: 192, button: 0 })
    await lane.trigger('mouseup', { clientY: 192, button: 0 })

    expect(wrapper.find('.new-event-datetime').exists()).toBe(true)
    const timeInputs = wrapper.findAll('input[type="time"]')
    expect(wrapper.get('input[type="date"]').element.value).toBe('2026-07-24')
    expect(timeInputs[0].element.value).toBe('09:00')
    expect(timeInputs[1].element.value).toBe('10:00')

    await wrapper.get('.new-event-title-input').setValue('Dentist appointment')
    await wrapper.get('.new-event-create').trigger('click')
    await flushPromises()

    expect(wrapper.find('.new-event-dialog').exists()).toBe(false)
    expect(wrapper.text()).toContain('Dentist appointment')
    wrapper.unmount()
  })

  it('creates an event by dragging on a week-view day column, prefilling that day', async () => {
    const wrapper = await mountCalendar({ attachTo: document.body })
    await wrapper.get('.calendar-view-tabs button:nth-child(2)').trigger('click')

    const column = wrapper.findAll('.week-day-column')[2]
    mockRect(column.element)

    // WEEK_HOUR_HEIGHT is 72px/hour starting at 8 AM: clientY 72 -> 9:00, clientY 144 -> 10:00.
    await column.trigger('mousedown', { clientY: 72, button: 0 })
    await column.trigger('mousemove', { clientY: 144, button: 0 })
    await column.trigger('mouseup', { clientY: 144, button: 0 })

    expect(wrapper.get('input[type="date"]').element.value).toBe('2026-07-22')
    const timeInputs = wrapper.findAll('input[type="time"]')
    expect(timeInputs[0].element.value).toBe('09:00')
    expect(timeInputs[1].element.value).toBe('10:00')
    wrapper.unmount()
  })

  it('defaults to a 30-minute slot when the timeline is clicked without dragging', async () => {
    const wrapper = await mountCalendar({ attachTo: document.body })
    const lane = wrapper.get('.day-event-lane')
    mockRect(lane.element)

    await lane.trigger('mousedown', { clientY: 288, button: 0 })
    await lane.trigger('mouseup', { clientY: 288, button: 0 })

    const timeInputs = wrapper.findAll('input[type="time"]')
    expect(timeInputs[0].element.value).toBe('11:00')
    expect(timeInputs[1].element.value).toBe('11:30')
    wrapper.unmount()
  })

  it('clicking an event opens it prefilled and saves edits', async () => {
    const wrapper = await mountCalendar({ attachTo: document.body })

    const standup = wrapper.findAll('.day-event').find((event) => event.text().includes('Standup'))
    await standup.trigger('click')

    expect(wrapper.get('.new-event-title-input').element.value).toBe('Standup')
    expect(wrapper.get('input[type="date"]').element.value).toBe('2026-07-24')
    const timeInputs = wrapper.findAll('input[type="time"]')
    expect(timeInputs[0].element.value).toBe('09:00')
    expect(timeInputs[1].element.value).toBe('09:30')
    const calendarSelect = wrapper.get('select[aria-label="Event calendar"]')
    expect(calendarSelect.element.value).toBe('work')
    expect(wrapper.get('.new-event-create').text()).toBe('Save Event')

    await wrapper.get('.new-event-title-input').setValue('Daily Standup')
    await calendarSelect.setValue('personal')
    await wrapper.get('.new-event-create').trigger('click')
    await flushPromises()

    expect(wrapper.find('.new-event-dialog').exists()).toBe(false)
    const dayEventTitles = wrapper.findAll('.day-event strong').map((el) => el.text())
    expect(dayEventTitles).toContain('Daily Standup')
    expect(dayEventTitles).not.toContain('Standup')
    const updateCall = vi
      .mocked(fetch)
      .mock.calls.find(([url, options]) => url === '/api/calendar-events' && options?.method === 'PATCH')
    expect(JSON.parse(updateCall[1].body).calendar).toBe('personal')
    wrapper.unmount()
  })

  it('edits a recurring occurrence using the series master date', async () => {
    const wrapper = await mountCalendar({ attachTo: document.body })

    const occurrence = wrapper
      .findAll('.day-event')
      .find((event) => event.text().includes('Recurring review'))
    await occurrence.trigger('click')

    expect(wrapper.get('input[type="date"]').element.value).toBe('2026-07-10')
    await wrapper.get('.new-event-title-input').setValue('Recurring review updated')
    await wrapper.get('.new-event-create').trigger('click')
    await flushPromises()

    const updateCall = vi
      .mocked(fetch)
      .mock.calls.find(([url, options]) => url === '/api/calendar-events' && options?.method === 'PATCH')
    expect(JSON.parse(updateCall[1].body)).toMatchObject({
      id: 'recurring-review',
      date: '2026-07-10',
      title: 'Recurring review updated',
    })
    wrapper.unmount()
  })

  it('deletes an event from the edit dialog', async () => {
    const wrapper = await mountCalendar({ attachTo: document.body })

    const standup = wrapper.findAll('.day-event').find((event) => event.text().includes('Standup'))
    await standup.trigger('click')

    expect(wrapper.get('.new-event-delete').exists).toBeTruthy()
    await wrapper.get('.new-event-delete').trigger('click')
    await flushPromises()

    expect(wrapper.find('.new-event-dialog').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Standup')
    wrapper.unmount()
  })

  it('does not show a Delete button when creating a new event', async () => {
    const wrapper = await mountCalendar({ attachTo: document.body })

    await wrapper.get('.calendar-sidebar-create').trigger('click')

    expect(wrapper.find('.new-event-delete').exists()).toBe(false)
    expect(wrapper.get('.new-event-create').text()).toBe('Create Event')
    wrapper.unmount()
  })

  it('persists created, edited, and deleted events through the backend across a remount', async () => {
    const wrapper = await mountCalendar({ attachTo: document.body })
    await wrapper.get('.calendar-sidebar-create').trigger('click')
    await wrapper.get('.new-event-title-input').setValue('Board game night')
    await wrapper.get('.new-event-create').trigger('click')
    await flushPromises()
    wrapper.unmount()

    // A fresh mount re-fetches from the backend (the same mocked API session),
    // simulating a page reload after the create above.
    const reloaded = await mountCalendar({ attachTo: document.body })
    expect(reloaded.text()).toContain('Board game night')
    expect(reloaded.text()).toContain('Standup')

    const standup = reloaded.findAll('.day-event').find((event) => event.text() === 'Standup')
    await standup.trigger('click')
    await reloaded.get('.new-event-delete').trigger('click')
    await flushPromises()
    reloaded.unmount()

    const afterDelete = await mountCalendar({ attachTo: document.body })
    expect(afterDelete.text()).not.toContain('Standup')
    expect(afterDelete.text()).toContain('Board game night')
    afterDelete.unmount()
  })

  it('opens a subscribed-calendar event read-only, without Save or Delete', async () => {
    await fetch(CALENDARS_ENDPOINT, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Team Feed',
        color: '#3b82f6',
        subscriptionUrl: 'https://example.com/team.ics',
      }),
    })
    const wrapper = await mountCalendar({ attachTo: document.body })

    const sections = wrapper.findAll('.calendar-sidebar-section')
    expect(sections.map((section) => section.get('.calendar-sidebar-label').text())).toEqual([
      'Calendars',
      'Subscribed calendars',
    ])
    expect(sections[1].text()).toContain('Team Feed')

    const synced = wrapper.findAll('.day-event').find((event) => event.text().includes('Imported standup'))
    await synced.trigger('click')

    expect(wrapper.get('.new-event-title-input').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.new-event-delete').exists()).toBe(false)
    expect(wrapper.find('.new-event-create').exists()).toBe(false)
    expect(wrapper.text()).toContain('Synced from an external calendar')
    wrapper.unmount()
  })

  it('dismisses the conflict insight card through its action', async () => {
    const wrapper = await mountCalendar()

    await wrapper.get('.primary-small-button').trigger('click')
    expect(wrapper.text()).not.toContain('Scheduling conflict')
    expect(wrapper.text()).toContain('Auto-scheduled')
  })

  it('reports a real auto-scheduled count for this week, and hides the card when there are none', async () => {
    const wrapper = await mountCalendar()
    expect(wrapper.text()).toContain('Cookie booked 2 events this week around your availability.')

    // Rebuild the API with no auto-scheduled events: the card must hide
    // entirely rather than show fabricated/zeroed copy.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, options = {}) => {
        const method = options.method || 'GET'
        if (isEventsEndpoint(url) && method === 'GET') {
          return {
            ok: true,
            json: async () =>
              clone({ events: SEED_EVENTS.map(({ autoScheduled: _autoScheduled, ...event }) => event) }),
          }
        }
        if (url === CALENDARS_ENDPOINT && method === 'GET') {
          return { ok: true, json: async () => clone({ calendars: SEED_CALENDARS }) }
        }
        throw new Error(`Unexpected fetch: ${method} ${url}`)
      }),
    )
    const bare = await mountCalendar()
    expect(bare.find('.auto-scheduled-card').exists()).toBe(false)
  })

  function stubEventsOnly(events) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, options = {}) => {
        const method = options.method || 'GET'
        if (isEventsEndpoint(url) && method === 'GET') {
          return { ok: true, json: async () => clone({ events }) }
        }
        if (url === CALENDARS_ENDPOINT && method === 'GET') {
          return { ok: true, json: async () => clone({ calendars: SEED_CALENDARS }) }
        }
        throw new Error(`Unexpected fetch: ${method} ${url}`)
      }),
    )
  }

  it('shows the scheduling conflict card with a real detected overlap', async () => {
    const wrapper = await mountCalendar()

    expect(wrapper.text()).toContain(
      '"Client call — Meridian" overlaps "Design review" by 30 min on Sat.',
    )
  })

  it('hides the scheduling conflict card when no events overlap', async () => {
    stubEventsOnly(
      SEED_EVENTS.filter((event) => event.id !== 'design' && event.id !== 'client-call'),
    )
    const wrapper = await mountCalendar()

    expect(wrapper.text()).not.toContain('Scheduling conflict')
  })

  it('ignores an overlap more than 30 days out', async () => {
    stubEventsOnly([
      { id: 'far-a', title: 'Far A', date: '2026-09-10', start: '11:00', duration: 60, calendar: 'work' },
      { id: 'far-b', title: 'Far B', date: '2026-09-10', start: '11:30', duration: 60, calendar: 'work' },
    ])
    const wrapper = await mountCalendar()

    expect(wrapper.text()).not.toContain('Scheduling conflict')
  })

  it('ignores an all-day event overlapping a timed one', async () => {
    stubEventsOnly([
      { id: 'holiday-2', title: 'Company Holiday', date: '2026-07-25', start: '00:00', duration: 1440, allDay: true, calendar: 'holidays' },
      { id: 'meeting', title: 'Team meeting', date: '2026-07-25', start: '10:00', duration: 30, calendar: 'work' },
    ])
    const wrapper = await mountCalendar()

    expect(wrapper.text()).not.toContain('Scheduling conflict')
  })
})
