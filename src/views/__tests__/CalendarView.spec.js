import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CalendarView from '../CalendarView.vue'
import { useInboxStore } from '../../stores/inbox'

const SEED_EVENTS = [
  { id: 'team-sync', title: 'Team sync', date: '2026-07-20', start: '09:00', duration: 30, calendar: 'work' },
  { id: 'priya', title: '1:1 with Priya', date: '2026-07-21', start: '10:00', duration: 30, calendar: 'work' },
  {
    id: 'focus',
    title: 'Focus — Q3 planning',
    date: '2026-07-22',
    start: '13:00',
    duration: 120,
    tone: 'dark',
    calendar: 'focus',
  },
  { id: 'design', title: 'Design review', date: '2026-07-23', start: '11:00', duration: 60, calendar: 'work' },
  {
    id: 'client-call',
    title: 'Client call — Meridian',
    date: '2026-07-23',
    start: '11:30',
    duration: 60,
    tone: 'conflict',
    calendar: 'work',
  },
  { id: 'standup', title: 'Standup', date: '2026-07-24', start: '09:00', duration: 30, calendar: 'work' },
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

      if (url === '/api/calendar-events') {
        if (method === 'GET') return { ok: true, json: async () => clone({ events }) }
        if (method === 'POST') {
          const event = { id: `generated-${nextId++}`, ...body }
          events = [...events, event]
          return { ok: true, json: async () => clone({ event }) }
        }
        if (method === 'PATCH') {
          const index = events.findIndex((item) => item.id === body.id)
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

function findCalendarRow(wrapper, name) {
  return wrapper.findAll('.calendar-list-row').find((row) => row.text().includes(name))
}

beforeEach(() => {
  setActivePinia(createPinia())
  const store = useInboxStore()
  vi.spyOn(store, 'authHeaders').mockResolvedValue({})
  vi.spyOn(store, 'notify').mockImplementation(() => {})
  mockCalendarApi()
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
    expect(wrapper.find('.day-event').text()).toContain('Standup')

    await calendarButtons[0].trigger('click')
    expect(calendarButtons[0].attributes('aria-pressed')).toBe('false')
    expect(wrapper.find('.day-event').exists()).toBe(true)
    expect(wrapper.find('.day-event').text()).toContain('Coffee with Sam')
    expect(wrapper.text()).not.toContain('Standup')

    await calendarButtons[0].trigger('click')
    expect(wrapper.text()).toContain('Standup')
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

  it('creates a new calendar and can assign events to it', async () => {
    const wrapper = await mountCalendar({ attachTo: document.body })

    await wrapper.get('.calendar-add-btn').trigger('click')
    await wrapper.get('input[aria-label="New calendar name"]').setValue('Trips')
    await wrapper.get('.calendar-edit-form').trigger('submit')
    await flushPromises()

    const rows = wrapper.findAll('.nav-text').map((el) => el.text())
    expect(rows).toContain('Trips')
    expect(wrapper.find('.calendar-edit-form').exists()).toBe(false)

    await wrapper.get('.calendar-sidebar-create').trigger('click')
    const calendarSelect = wrapper.get('select[aria-label="Event calendar"]')
    expect(calendarSelect.findAll('option').map((option) => option.text())).toContain('Trips')
    await calendarSelect.setValue('generated-calendar-1')
    await wrapper.get('.new-event-title-input').setValue('Pack for holiday')
    await wrapper.get('.new-event-create').trigger('click')
    await flushPromises()

    const createCall = vi
      .mocked(fetch)
      .mock.calls.find(([url, options]) => url === '/api/calendar-events' && options?.method === 'POST')
    expect(JSON.parse(createCall[1].body).calendar).toBe('generated-calendar-1')
    expect(wrapper.text()).toContain('Pack for holiday')
    wrapper.unmount()
  })

  it('subscribes to a calendar via URL and shows its synced events', async () => {
    const wrapper = await mountCalendar({ attachTo: document.body })

    await wrapper.get('.calendar-add-btn').trigger('click')
    await wrapper.get('input[aria-label="New calendar name"]').setValue('Team Feed')
    await wrapper.get('.calendar-subscription-toggle').trigger('click')
    await wrapper.get('input[aria-label="Calendar subscription URL"]').setValue('https://example.com/team.ics')
    await wrapper.get('.calendar-edit-form').trigger('submit')
    await flushPromises()

    const createCall = vi
      .mocked(fetch)
      .mock.calls.find(([url, options]) => url === CALENDARS_ENDPOINT && options?.method === 'POST')
    expect(JSON.parse(createCall[1].body).subscriptionUrl).toBe('https://example.com/team.ics')
    expect(wrapper.findAll('.nav-text').map((el) => el.text())).toContain('Team Feed')
    const sections = wrapper.findAll('.calendar-sidebar-section')
    expect(sections.map((section) => section.get('.calendar-sidebar-label').text())).toEqual([
      'Calendars',
      'Subscribed calendars',
    ])
    expect(sections[0].findAll('.calendar-list-item .nav-text').map((el) => el.text())).not.toContain('Team Feed')
    expect(sections[1].findAll('.calendar-list-item .nav-text').map((el) => el.text())).toEqual(['Team Feed'])
    expect(wrapper.text()).toContain('Imported standup')
    wrapper.unmount()
  })

  it('manually re-syncs a subscribed calendar', async () => {
    const wrapper = await mountCalendar({ attachTo: document.body })
    await wrapper.get('.calendar-add-btn').trigger('click')
    await wrapper.get('input[aria-label="New calendar name"]').setValue('Team Feed')
    await wrapper.get('.calendar-subscription-toggle').trigger('click')
    await wrapper.get('input[aria-label="Calendar subscription URL"]').setValue('https://example.com/team.ics')
    await wrapper.get('.calendar-edit-form').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('Imported standup')

    await wrapper.get('button[aria-label="Sync Team Feed"]').trigger('click')
    await flushPromises()

    const syncCall = vi
      .mocked(fetch)
      .mock.calls.find(
        ([url, options]) => url === CALENDARS_ENDPOINT && JSON.parse(options?.body || '{}').action === 'sync',
      )
    expect(syncCall).toBeTruthy()
    expect(wrapper.text()).toContain('Synced meetup')
    expect(wrapper.text()).not.toContain('Imported standup')
    wrapper.unmount()
  })

  it('opens a subscribed-calendar event read-only, without Save or Delete', async () => {
    const wrapper = await mountCalendar({ attachTo: document.body })
    await wrapper.get('.calendar-add-btn').trigger('click')
    await wrapper.get('input[aria-label="New calendar name"]').setValue('Team Feed')
    await wrapper.get('.calendar-subscription-toggle').trigger('click')
    await wrapper.get('input[aria-label="Calendar subscription URL"]').setValue('https://example.com/team.ics')
    await wrapper.get('.calendar-edit-form').trigger('submit')
    await flushPromises()

    const synced = wrapper.findAll('.day-event').find((event) => event.text().includes('Imported standup'))
    await synced.trigger('click')

    expect(wrapper.get('.new-event-title-input').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.new-event-delete').exists()).toBe(false)
    expect(wrapper.find('.new-event-create').exists()).toBe(false)
    expect(wrapper.text()).toContain('Synced from an external calendar')
    wrapper.unmount()
  })

  it('shows an inline error and keeps the form open when creating a duplicate calendar name', async () => {
    const wrapper = await mountCalendar({ attachTo: document.body })

    await wrapper.get('.calendar-add-btn').trigger('click')
    await wrapper.get('input[aria-label="New calendar name"]').setValue('Work')
    await wrapper.get('.calendar-edit-form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('.calendar-edit-error').text()).toContain('already exists')
    expect(wrapper.find('.calendar-edit-form').exists()).toBe(true)
  })

  it('renames a calendar', async () => {
    const wrapper = await mountCalendar({ attachTo: document.body })

    const workRow = findCalendarRow(wrapper, 'Work')
    const editButton = workRow.get('.calendar-list-edit-icon')
    expect(editButton.element.tagName).toBe('BUTTON')
    expect(editButton.attributes('aria-label')).toBe('Edit Work')
    await editButton.trigger('click')

    await wrapper.get('input[aria-label="Rename Work"]').setValue('Day Job')
    await wrapper.get('.calendar-edit-form').trigger('submit')
    await flushPromises()

    const rows = wrapper.findAll('.nav-text').map((el) => el.text())
    expect(rows).toContain('Day Job')
    expect(rows).not.toContain('Work')
  })

  it('requires a second click to delete a calendar with no events', async () => {
    const wrapper = await mountCalendar({ attachTo: document.body })

    const birthdaysRow = findCalendarRow(wrapper, 'Birthdays')
    await birthdaysRow.get('.calendar-list-edit-icon').trigger('click')

    const deleteBtn = wrapper.get('.calendar-delete-btn')
    await deleteBtn.trigger('click')
    expect(wrapper.get('.calendar-delete-btn').classes()).toContain('confirming')
    // Still mid-edit after the first (arming) click — the row hasn't been removed.
    expect(wrapper.find('input[aria-label="Rename Birthdays"]').exists()).toBe(true)

    await wrapper.get('.calendar-delete-btn').trigger('click')
    await flushPromises()

    expect(wrapper.findAll('.nav-text').map((el) => el.text())).not.toContain('Birthdays')
  })

  it('refuses to delete a calendar that still has events', async () => {
    const wrapper = await mountCalendar({ attachTo: document.body })
    const store = useInboxStore()
    vi.spyOn(store, 'notify')

    const workRow = findCalendarRow(wrapper, 'Work')
    await workRow.get('.calendar-list-edit-icon').trigger('click')
    await wrapper.get('.calendar-delete-btn').trigger('click')
    await wrapper.get('.calendar-delete-btn').trigger('click')
    await flushPromises()

    expect(store.notify).toHaveBeenCalledWith(expect.stringContaining('event'), 'error')
    // The failed delete leaves the row in edit mode rather than removing it.
    expect(wrapper.find('input[aria-label="Rename Work"]').exists()).toBe(true)
  })

  it('dismisses insight cards through their actions', async () => {
    const wrapper = await mountCalendar()

    await wrapper.get('.primary-small-button').trigger('click')
    expect(wrapper.text()).not.toContain('Scheduling conflict')

    await wrapper.get('.secondary-small-button').trigger('click')
    expect(wrapper.text()).not.toContain('Suggested slot')
    expect(wrapper.text()).toContain('Auto-scheduled')
  })
})
