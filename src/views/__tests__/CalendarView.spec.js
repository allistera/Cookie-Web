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
]

// A real fetch response always round-trips through JSON, so the object a
// caller receives is never reference-equal to anything the "server" holds.
// Skipping that clone here would let Vue's reactive-proxy `set` trap see
// "the same object" and silently skip the update (a mock-only artifact,
// not a real bug — see the git history for how this was diagnosed).
const clone = (value) => JSON.parse(JSON.stringify(value))

// Stands in for /api/calendar-events with an in-memory list, mirroring the
// local Vite fixture middleware's behavior closely enough for these tests.
function mockCalendarApi() {
  let events = SEED_EVENTS.map((event) => ({ ...event }))
  let nextId = 1
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, options = {}) => {
      if (url !== '/api/calendar-events') throw new Error(`Unexpected fetch URL: ${url}`)
      const method = options.method || 'GET'
      const body = options.body ? JSON.parse(options.body) : {}
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
      throw new Error(`Unexpected fetch method: ${method}`)
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
    expect(calendarButtons.map((button) => button.text())).toEqual([
      'Work',
      'Personal',
      'Focus time',
      'Birthdays',
      'Holidays',
    ])
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
    expect(wrapper.get('.new-event-create').text()).toBe('Save Event')

    await wrapper.get('.new-event-title-input').setValue('Daily Standup')
    await wrapper.get('.new-event-create').trigger('click')
    await flushPromises()

    expect(wrapper.find('.new-event-dialog').exists()).toBe(false)
    const dayEventTitles = wrapper.findAll('.day-event strong').map((el) => el.text())
    expect(dayEventTitles).toContain('Daily Standup')
    expect(dayEventTitles).not.toContain('Standup')
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

  it('dismisses insight cards through their actions', async () => {
    const wrapper = await mountCalendar()

    await wrapper.get('.primary-small-button').trigger('click')
    expect(wrapper.text()).not.toContain('Scheduling conflict')

    await wrapper.get('.secondary-small-button').trigger('click')
    expect(wrapper.text()).not.toContain('Suggested slot')
    expect(wrapper.text()).toContain('Auto-scheduled')
  })
})
