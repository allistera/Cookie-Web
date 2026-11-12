import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CalendarView from '../CalendarView.vue'
import { useInboxStore } from '../../stores/inbox'
import { useProjectsStore } from '../../stores/projects'
import { useTaskItemsStore } from '../../stores/taskItems'
import { resetCalendarsStateForTests } from '../../composables/useCalendars'
import {
  rememberEmailCalendarEvent,
  rememberedEmailCalendarEvent,
} from '../../lib/emailCalendarEvents'

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
  // Dated within the next 30 days ("today" is 2026-07-24) so the real
  // conflict detector in CalendarView.vue actually finds this overlap.
  {
    id: 'design',
    title: 'Design review',
    date: '2026-07-25',
    start: '11:00',
    duration: 60,
    calendar: 'work',
  },
  {
    id: 'client-call',
    title: 'Client call — Meridian',
    date: '2026-07-25',
    start: '11:30',
    duration: 60,
    tone: 'conflict',
    calendar: 'work',
  },
  {
    id: 'standup',
    title: 'Standup',
    date: '2026-07-24',
    start: '09:00',
    duration: 30,
    calendar: 'work',
  },
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
import { CALENDAR_API_URL, TASKS_API_URL } from '../../lib/apiWorkers'
import { browserTimeZone } from '../../composables/useCalendars'
import { createMemoryHistory, createRouter } from 'vue-router'

// A connected Google account's calendars and events, as the Worker lists them
// (googleCalendar.js): `google:`-prefixed ids, a read-only shared calendar,
// a repeating instance and a multi-day all-day event collapsed to one day.
const GOOGLE_CALENDARS = [
  {
    id: 'google:me@example.com',
    name: 'me@example.com',
    color: '#9fe1e7',
    source: 'google',
    googleCalendarId: 'me@example.com',
    readOnly: false,
  },
  {
    id: 'google:team@group.calendar.google.com',
    name: 'Team',
    color: '#f6bf26',
    source: 'google',
    googleCalendarId: 'team@group.calendar.google.com',
    readOnly: true,
  },
]
const GOOGLE_EVENTS = [
  {
    id: 'google:me@example.com:dentist',
    seriesId: 'google:me@example.com:dentist',
    title: 'Dentist',
    date: '2026-07-24',
    start: '15:00',
    duration: 60,
    calendar: 'google:me@example.com',
    source: 'google',
    recurring: true,
    readOnly: false,
    htmlLink: 'https://calendar.google.com/calendar/event?eid=dentist',
  },
  {
    id: 'google:team@group.calendar.google.com:offsite',
    seriesId: 'google:team@group.calendar.google.com:offsite',
    title: 'Team offsite',
    date: '2026-07-24',
    start: '00:00',
    duration: 1440,
    allDay: true,
    calendar: 'google:team@group.calendar.google.com',
    source: 'google',
    recurring: false,
    readOnly: true,
    htmlLink: 'https://calendar.google.com/calendar/event?eid=offsite',
  },
]

// Dated tasks appear on the calendar next to events. One all-day (no time)
// and one timed, both on the reference date, one in a project and one in
// the Inbox.
const SEED_TASKS = [
  {
    id: 'task-1',
    projectId: 'project-1',
    parentId: null,
    content: 'Renew car insurance',
    dueDate: '2026-07-24',
    dueTime: null,
    timeZone: null,
    priority: 2,
  },
  {
    id: 'task-2',
    projectId: null,
    parentId: null,
    content: 'Call the bank',
    durationMinutes: 90,
    dueDate: '2026-07-24',
    dueTime: '15:00',
    timeZone: 'Europe/London',
    priority: null,
  },
]

// Put off to Someday: no day to show on, so not in SEED_TASKS. Tests that
// look at the Someday row pass these to mockCalendarApi. One carries an
// estimate, which a drop on the calendar runs for; the other has none.
const SOMEDAY_TASKS = [
  {
    id: 'task-someday-1',
    projectId: 'project-1',
    parentId: null,
    content: 'Learn to juggle',
    durationMinutes: 90,
    dueDate: '9999-12-31',
    dueTime: null,
    priority: null,
  },
  {
    id: 'task-someday-2',
    projectId: null,
    parentId: null,
    content: 'Sort the garage',
    dueDate: '9999-12-31',
    dueTime: null,
    priority: null,
  },
]

const TASKS_ENDPOINT = `${TASKS_API_URL}/task-items`
const EVENTS_ENDPOINT = `${CALENDAR_API_URL}/calendar-events`
const CALENDARS_ENDPOINT = `${CALENDAR_API_URL}/calendars`
const isEventsEndpoint = (url) => url === EVENTS_ENDPOINT || url.startsWith(`${EVENTS_ENDPOINT}?`)

// Stands in for the calendar-events and calendar-management APIs with in-memory
// lists, mirroring the local Vite fixture middleware's behavior closely
// enough for these tests.
function mockCalendarApi({
  google = false,
  googleError = null,
  defaultCalendarId = null,
  tasks = SEED_TASKS,
} = {}) {
  let events = [...SEED_EVENTS, ...(google ? GOOGLE_EVENTS : [])].map((event) => ({ ...event }))
  let calendars = [...SEED_CALENDARS, ...(google ? GOOGLE_CALENDARS : [])].map((calendar) => ({
    ...calendar,
  }))
  let nextId = 1
  let taskRows = tasks.map((task) => ({ completedAt: null, ...task }))
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
              ? events.filter(
                  (event) => event.recurrenceRule || (event.date >= from && event.date <= to),
                )
              : events
          const payload = { events: windowed }
          if (googleError) payload.googleError = googleError
          return { ok: true, json: async () => clone(payload) }
        }
        if (method === 'POST' && body.action === 'interpret') {
          const weekly = body.text.includes('every')
          return {
            ok: true,
            json: async () =>
              clone({
                draft: {
                  title: 'Dinner with Sam',
                  description: null,
                  location: null,
                  date: '2026-07-25',
                  start: '19:00',
                  duration: 120,
                  repeat: weekly ? 'weekly' : 'none',
                  repeatUntil: null,
                  repeatDays: weekly ? [5] : null,
                },
              }),
          }
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

      if (url.startsWith(`${TASKS_ENDPOINT}?`) && method === 'GET') {
        const params = new URLSearchParams(url.split('?')[1] ?? '')
        const from = params.get('from')
        const to = params.get('to')
        if ((Date.parse(to) - Date.parse(from)) / 86400000 > 100) return { ok: false, status: 400 }
        // Open tasks, and done ones only when asked for, as the real
        // calendar view answers.
        const includeCompleted = params.get('completed') === '1'
        const items = taskRows.filter(
          (task) =>
            (includeCompleted || task.completedAt === null) &&
            task.dueDate >= from &&
            task.dueDate <= to,
        )
        return { ok: true, json: async () => clone({ items }) }
      }

      if (url === TASKS_ENDPOINT && method === 'PATCH') {
        const task = taskRows.find((row) => row.id === body.id)
        if (!task) return { ok: false, status: 404 }
        const { completed, ...changes } = body
        Object.assign(task, changes)
        if (Object.hasOwn(body, 'completed')) {
          task.completedAt = completed ? '2026-07-24T10:30:00.000Z' : null
        }
        return { ok: true, json: async () => clone({ item: task }) }
      }

      if (url === TASKS_ENDPOINT && method === 'POST') {
        const task = {
          id: `generated-task-${nextId++}`,
          projectId: null,
          parentId: null,
          completedAt: null,
          ...body,
        }
        taskRows = [...taskRows, task]
        return { ok: true, json: async () => clone({ item: task }) }
      }

      if (url === CALENDARS_ENDPOINT) {
        if (method === 'GET') {
          return { ok: true, json: async () => clone({ calendars, defaultCalendarId }) }
        }
        if (method === 'POST' && body.action === 'sync') {
          const calendar = calendars.find((item) => item.id === body.id)
          if (!calendar?.subscriptionUrl)
            return { ok: false, status: 404, json: async () => ({ error: 'not found' }) }
          calendar.subscriptionSyncedAt = '2026-07-24T12:00:00.000Z'
          calendar.subscriptionError = null
          events = [
            ...events.filter((event) => event.calendar !== calendar.id),
            {
              id: `synced-${nextId++}`,
              title: 'Synced meetup',
              date: '2026-07-24',
              start: '16:00',
              duration: 30,
              calendar: calendar.id,
            },
          ]
          return {
            ok: true,
            json: async () => ({
              ok: true,
              subscriptionSyncedAt: calendar.subscriptionSyncedAt,
              subscriptionError: null,
            }),
          }
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
              {
                id: `synced-${nextId++}`,
                title: 'Imported standup',
                date: '2026-07-24',
                start: '10:00',
                duration: 30,
                calendar: calendar.id,
              },
            ]
          }
          calendars = [...calendars, calendar]
          return { ok: true, json: async () => clone({ calendar }) }
        }
        if (method === 'PATCH') {
          const index = calendars.findIndex((item) => item.id === body.id)
          if (index === -1)
            return { ok: false, status: 404, json: async () => ({ error: 'not found' }) }
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
    width: 1100,
    height: 1056,
    right: 1100,
    bottom: 1056,
    x: 0,
    y: 0,
    toJSON() {},
  })
}

// Mounts and waits for the initial GET /api/calendar-events to resolve, so
// the seed events are already rendered before the test interacts with them.
// Opening a task has the Tasks stores read it and the project names; those
// requests are the stores' own business, so they are stood in for here.
function stubTaskStores() {
  vi.spyOn(useProjectsStore(), 'loadProjects').mockResolvedValue(true)
  return vi.spyOn(useTaskItemsStore(), 'loadDetail').mockResolvedValue()
}

async function mountCalendar(options) {
  const wrapper = mount(CalendarView, options)
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  // CalendarView derives "today" from new Date() (re-read every minute).
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
  // Mail-to-Calendar links are remembered in localStorage.
  localStorage.clear()
})

describe('CalendarView', () => {
  it('opens a linked event after loading and follows a different occurrence without remounting', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/calendar', component: { template: '<div />' } },
        { path: '/settings/:section?', name: 'settings', component: { template: '<div />' } },
      ],
    })
    await router.push('/calendar?date=2026-07-25&event=design')
    const wrapper = await mountCalendar({ global: { plugins: [router] } })
    expect(wrapper.get('.day-calendar > h2').text()).toContain('25')
    expect(wrapper.get('.new-event-title-input').element.value).toBe('Design review')
    expect(wrapper.get('input[type="date"]').element.value).toBe('2026-07-25')
    await router.push('/calendar?date=2026-07-24&event=recurring-review-2026-07-24')
    await flushPromises()
    expect(wrapper.get('.new-event-title-input').element.value).toBe('Recurring review')
    expect(wrapper.get('.day-calendar > h2').text()).toContain('24')
    wrapper.unmount()
  })
  it('ignores a missing event or an invalid linked date', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/calendar', component: { template: '<div />' } },
        { path: '/settings/:section?', name: 'settings', component: { template: '<div />' } },
      ],
    })
    await router.push('/calendar?date=2026-02-31&event=design')
    const wrapper = await mountCalendar({ global: { plugins: [router] } })
    expect(wrapper.find('.new-event-dialog').exists()).toBe(false)
    await router.push('/calendar?date=2026-07-24&event=missing')
    await flushPromises()
    expect(wrapper.find('.new-event-dialog').exists()).toBe(false)
    wrapper.unmount()
  })
  it('shows the calendar sidebar and filters events by calendar', async () => {
    const wrapper = await mountCalendar()
    const calendarButtons = wrapper.findAll('.calendar-list-item')

    expect(calendarButtons).toHaveLength(6)
    expect(calendarButtons.map((button) => button.get('.nav-text').text())).toEqual([
      'Work',
      'Personal',
      'Focus time',
      'Birthdays',
      'Holidays',
      'Tasks',
    ])
    expect(wrapper.findAll('.calendar-sidebar-label').map((label) => label.text())).toEqual([
      'Calendars',
      'Tasks',
    ])
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

  it('shows dated tasks on their day and lets the Tasks toggle hide them', async () => {
    const wrapper = await mountCalendar()

    const allDayTask = wrapper.get('.all-day-event.task-event')
    expect(allDayTask.text()).toContain('Renew car insurance')
    const timedTask = wrapper.get('.day-event.task-event')
    expect(timedTask.text()).toContain('Call the bank')
    expect(timedTask.attributes('style')).toContain('left:')
    // Ninety of the day view's 660 visible minutes (8 AM to 7 PM).
    expect(Number.parseFloat(timedTask.element.style.width)).toBeCloseTo((90 / 660) * 100, 3)

    const tasksToggle = wrapper
      .findAll('.calendar-list-item')
      .find((button) => button.text() === 'Tasks')
    await tasksToggle.trigger('click')
    expect(tasksToggle.attributes('aria-pressed')).toBe('false')
    expect(wrapper.find('.task-event').exists()).toBe(false)
    expect(wrapper.text()).toContain('Standup')

    await tasksToggle.trigger('click')
    expect(wrapper.find('.task-event').exists()).toBe(true)
  })

  it('keeps a completed task on its day, ticked and struck through', async () => {
    mockCalendarApi({
      tasks: [
        ...SEED_TASKS,
        {
          ...SEED_TASKS[0],
          id: 'task-done',
          content: 'Pay the bill',
          completedAt: '2026-07-24T08:00:00.000Z',
        },
      ],
    })
    const wrapper = await mountCalendar()

    const chips = wrapper.findAll('.all-day-event.task-event')
    const open = chips.find((chip) => chip.text().includes('Renew car insurance'))
    const done = chips.find((chip) => chip.text().includes('Pay the bill'))
    expect(open.classes()).not.toContain('task-done')
    expect(open.get('.task-event-icon').text()).toBe('check_box_outline_blank')
    expect(done.classes()).toContain('task-done')
    expect(done.get('.task-event-icon').text()).toBe('check_box')
  })

  it('leaves a task struck through on its day when the panel completes it', async () => {
    const wrapper = await mountCalendar()
    expect(wrapper.get('.all-day-event.task-event').classes()).not.toContain('task-done')

    vi.spyOn(useTaskItemsStore(), 'authHeaders').mockResolvedValue({})
    await useTaskItemsStore().request('PATCH', { body: { id: 'task-1', completed: true } })
    await flushPromises()

    const chip = wrapper.get('.all-day-event.task-event')
    expect(chip.text()).toContain('Renew car insurance')
    expect(chip.classes()).toContain('task-done')
  })

  it('ticks a task off from its Day view checkbox without opening the panel', async () => {
    stubTaskStores()
    const wrapper = await mountCalendar({ global: { stubs: { TaskDetailPanel: true } } })

    // Both an all-day task and a timed one carry the checkbox.
    for (const [chipClass, title] of [
      ['.all-day-event', 'Renew car insurance'],
      ['.day-event', 'Call the bank'],
    ]) {
      const tick = wrapper.get(`${chipClass}.task-event [aria-label="Complete ${title}"]`)
      expect(tick.attributes('aria-checked')).toBe('false')
      await tick.trigger('click')
      await flushPromises()

      const chip = wrapper.get(`${chipClass}.task-event`)
      expect(chip.classes()).toContain('task-done')
      expect(chip.get('[role="checkbox"]').attributes('aria-checked')).toBe('true')
    }
    expect(wrapper.findComponent({ name: 'TaskDetailPanel' }).exists()).toBe(false)

    // The text still opens the panel, and a second click unticks the task.
    await wrapper.get('.all-day-event.task-event').trigger('click')
    expect(wrapper.findComponent({ name: 'TaskDetailPanel' }).props('taskId')).toBe('task-1')
    await wrapper.get('.all-day-event.task-event [role="checkbox"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('.all-day-event.task-event').classes()).not.toContain('task-done')
  })

  it('unticks a Day view task again when completing it fails', async () => {
    const wrapper = await mountCalendar()
    const respond = fetch.getMockImplementation()
    fetch.mockImplementation(async (url, options = {}) =>
      options.method === 'PATCH' ? { ok: false, status: 500 } : respond(url, options),
    )

    await wrapper.get('.all-day-event.task-event [role="checkbox"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('.all-day-event.task-event').classes()).not.toContain('task-done')
    expect(useInboxStore().notify).toHaveBeenCalledWith('Failed to update the task.', 'error')
  })

  it('lays the day out left to right, with each event a column labelled with its times', async () => {
    const wrapper = await mountCalendar()

    expect(wrapper.findAll('.day-hour-label').map((label) => label.text())).toEqual([
      '8 AM',
      '9 AM',
      '10 AM',
      '11 AM',
      '12 PM',
      '1 PM',
      '2 PM',
      '3 PM',
      '4 PM',
      '5 PM',
      '6 PM',
      '7 PM',
    ])

    // 9:00 to 9:30 AM: one hour into the 11 visible hours, half an hour wide,
    // and the lane's full height as nothing overlaps it.
    const standup = wrapper
      .findAll('.day-event')
      .find((event) => event.get('strong').text() === 'Standup')
    expect(Number.parseFloat(standup.element.style.left)).toBeCloseTo((1 / 11) * 100, 3)
    expect(Number.parseFloat(standup.element.style.width)).toBeCloseTo((0.5 / 11) * 100, 3)
    expect(standup.element.style.top).toBe('0%')
    expect(standup.element.style.height).toBe('100%')
    expect(standup.get('.day-event-time').text()).toBe('9:00 AM – 9:30 AM')
  })

  it('stacks overlapping day events in rows instead of covering one with another', async () => {
    const wrapper = await mountCalendar()
    const byTitle = (title) =>
      wrapper.findAll('.day-event').find((event) => event.get('strong').text() === title).element
        .style

    // The 3:00 to 4:30 PM task overlaps the 4:00 PM review.
    const task = byTitle('Call the bank')
    const review = byTitle('Recurring review')
    expect([task.top, task.height]).toEqual(['0%', '50%'])
    expect([review.top, review.height]).toEqual(['50%', '50%'])
  })

  it('shows the next-day portion of an overnight estimate in timed lanes', async () => {
    mockCalendarApi({ tasks: [{ ...SEED_TASKS[1], dueTime: '10:00', durationMinutes: 1440 }] })
    const wrapper = await mountCalendar()
    await wrapper.get('[aria-label="Next period"]').trigger('click')
    await flushPromises()
    const task = wrapper.get('.day-event.task-event')
    expect(task.text()).toContain('Call the bank')
    // Midnight to 10 AM, of which the visible hours show 8 AM to 10 AM.
    expect(task.element.style.left).toBe('0%')
    expect(Number.parseFloat(task.element.style.width)).toBeCloseTo((120 / 660) * 100, 3)
    expect(wrapper.find('.all-day-event.task-event').exists()).toBe(false)
  })

  it('covers the events window with task requests within the API limit', async () => {
    await mountCalendar()
    const urls = fetch.mock.calls.map(([url]) => String(url))
    const eventsUrl = urls.find((url) => url.startsWith(`${EVENTS_ENDPOINT}?`))
    const eventParams = new URLSearchParams(eventsUrl.split('?')[1])
    // The Someday row asks for its own single date, apart from these windows.
    const windows = urls
      .filter((url) => url.startsWith(`${TASKS_ENDPOINT}?`) && !url.includes('9999-12-31'))
      .map((url) => new URLSearchParams(url.split('?')[1]))
    expect(windows.length).toBeGreaterThan(1)
    expect(windows[0].get('from')).toBe(eventParams.get('from'))
    expect(windows.at(-1).get('to')).toBe(eventParams.get('to'))
    windows.forEach((params) => {
      expect(params.get('view')).toBe('calendar')
      // Done tasks stay on their day, so the windows ask for them.
      expect(params.get('completed')).toBe('1')
      expect(Date.parse(params.get('to')) - Date.parse(params.get('from'))).toBeLessThanOrEqual(
        100 * 86400000,
      )
    })
    // The Someday row keeps to open tasks: a done one leaves it on reload.
    const someday = urls.find((url) => url.includes('9999-12-31'))
    expect(new URLSearchParams(someday.split('?')[1]).get('completed')).toBeNull()
    windows.slice(1).forEach((params, index) => {
      expect(Date.parse(params.get('from')) - Date.parse(windows[index].get('to'))).toBe(86400000)
    })
  })

  it('keeps timed tasks out of conflict detection', async () => {
    const wrapper = await mountCalendar()
    // Call the bank (15:00) overlaps nothing; the seed conflict is the
    // 11:00 design review vs the 11:30 client call, both events.
    const banner = wrapper.find('.calendar-insight-card')
    expect(banner.exists()).toBe(true)
    expect(banner.text()).not.toContain('Call the bank')
    expect(banner.text()).toContain('Design review')
  })

  it('opens a task in its panel on the calendar when clicked, not the event dialog', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: { template: '<div />' } },
        { path: '/calendar', component: { template: '<div />' } },
        { path: '/tasks', name: 'tasks', component: { template: '<div />' } },
        { path: '/settings/:section?', name: 'settings', component: { template: '<div />' } },
      ],
    })
    await router.push('/calendar')
    const loadDetail = stubTaskStores()
    const wrapper = await mountCalendar({
      global: { plugins: [router], stubs: { TaskDetailPanel: true } },
    })

    await wrapper.get('.all-day-event.task-event').trigger('click')
    await flushPromises()

    const panel = wrapper.findComponent({ name: 'TaskDetailPanel' })
    expect(panel.props('taskId')).toBe('task-1')
    // The calendar never loaded the Tasks list, so the task is read for it.
    expect(loadDetail).toHaveBeenCalledWith('task-1')
    expect(router.currentRoute.value.fullPath).toBe('/calendar')
    expect(wrapper.find('.new-event-dialog').exists()).toBe(false)

    // Stepping to another task from the panel swaps it; closing leaves the
    // calendar as it was.
    await panel.vm.$emit('open', 'task-2')
    expect(wrapper.findComponent({ name: 'TaskDetailPanel' }).props('taskId')).toBe('task-2')
    await wrapper.findComponent({ name: 'TaskDetailPanel' }).vm.$emit('close')
    expect(wrapper.findComponent({ name: 'TaskDetailPanel' }).exists()).toBe(false)
    expect(router.currentRoute.value.fullPath).toBe('/calendar')
  })

  it('reads tasks back onto the calendar after the Tasks store saves a change', async () => {
    const wrapper = await mountCalendar()
    const reads = () =>
      fetch.mock.calls.filter(([url]) => String(url).startsWith(`${TASKS_ENDPOINT}?view=calendar`))
        .length
    const before = reads()

    vi.spyOn(useTaskItemsStore(), 'authHeaders').mockResolvedValue({})
    await useTaskItemsStore().request('PATCH', { body: { id: 'task-1', content: 'Renamed' } })
    await flushPromises()

    expect(reads()).toBeGreaterThan(before)
    expect(wrapper.get('.all-day-event.task-event').text()).toContain('Renamed')
  })

  it("names how long the breaks between the day's events are", async () => {
    const wrapper = await mountCalendar()

    // Standup ends at 9:30 AM and Coffee starts at 2:30 PM. Coffee, the task
    // and the review after it run into each other, and the time before the
    // first event and after the last is not between anything.
    const gaps = wrapper.findAll('.day-gap')
    expect(gaps.map((gap) => gap.text())).toEqual(['5hrs'])
    expect(Number.parseFloat(gaps[0].element.style.left)).toBeCloseTo((1.5 / 11) * 100, 3)
    expect(Number.parseFloat(gaps[0].element.style.width)).toBeCloseTo((5 / 11) * 100, 3)
  })

  it('leaves a break of under an hour unlabelled', async () => {
    mockCalendarApi({
      tasks: [
        { ...SEED_TASKS[1], id: 'task-early', dueTime: '10:00', durationMinutes: 30 },
        { ...SEED_TASKS[1], id: 'task-late', dueTime: '12:15', durationMinutes: 135 },
      ],
    })
    const wrapper = await mountCalendar()

    // 9:30 to 10:00 is too short to name; 10:30 to 12:15 is not. The later
    // task runs straight into Coffee, which ends an hour before the review.
    expect(wrapper.findAll('.day-gap').map((gap) => gap.text())).toEqual(['1hr 45m', '1hr'])
  })

  it('lines Someday tasks along the foot of every view, under the Tasks toggle', async () => {
    mockCalendarApi({ tasks: [...SEED_TASKS, ...SOMEDAY_TASKS] })
    const wrapper = await mountCalendar()
    const titles = () => wrapper.findAll('.someday-title').map((title) => title.text())

    expect(wrapper.get('.someday-strip').text()).toContain('Someday:')
    expect(titles()).toEqual(['Learn to juggle', 'Sort the garage'])
    // They sit in the row only, never on a day.
    expect(wrapper.findAll('.task-event').map((task) => task.text())).not.toContain(
      'Learn to juggle',
    )

    for (const tab of [2, 3]) {
      await wrapper.get(`.calendar-view-tabs button:nth-child(${tab})`).trigger('click')
      expect(titles()).toEqual(['Learn to juggle', 'Sort the garage'])
    }

    const tasksToggle = wrapper
      .findAll('.calendar-list-item')
      .find((button) => button.text() === 'Tasks')
    await tasksToggle.trigger('click')
    expect(wrapper.find('.someday-strip').exists()).toBe(false)
    await tasksToggle.trigger('click')
    expect(titles()).toEqual(['Learn to juggle', 'Sort the garage'])
  })

  it('completes a Someday task from its tick, and reopens it when unticked', async () => {
    mockCalendarApi({ tasks: [...SEED_TASKS, ...SOMEDAY_TASKS] })
    const wrapper = await mountCalendar()
    const writes = () =>
      fetch.mock.calls
        .filter(([url, options]) => url === TASKS_ENDPOINT && options?.method === 'PATCH')
        .map(([, options]) => JSON.parse(options.body))

    const tick = wrapper.get('[aria-label="Complete Learn to juggle"]')
    expect(tick.attributes('aria-checked')).toBe('false')
    await tick.trigger('click')
    await flushPromises()

    expect(writes()).toEqual([{ id: 'task-someday-1', completed: true }])
    // It stays in the row, ticked, so the tick can be taken back.
    expect(tick.attributes('aria-checked')).toBe('true')
    expect(wrapper.findAll('.someday-task')[0].classes()).toContain('done')

    await tick.trigger('click')
    await flushPromises()
    expect(writes().at(-1)).toEqual({ id: 'task-someday-1', completed: false })
    expect(tick.attributes('aria-checked')).toBe('false')
  })

  it('unticks a Someday task again when completing it fails', async () => {
    mockCalendarApi({ tasks: [...SEED_TASKS, ...SOMEDAY_TASKS] })
    const wrapper = await mountCalendar()
    const respond = fetch.getMockImplementation()
    fetch.mockImplementation(async (url, options = {}) =>
      options.method === 'PATCH' ? { ok: false, status: 500 } : respond(url, options),
    )

    const tick = wrapper.get('[aria-label="Complete Learn to juggle"]')
    await tick.trigger('click')
    await flushPromises()

    expect(tick.attributes('aria-checked')).toBe('false')
    expect(useInboxStore().notify).toHaveBeenCalledWith('Failed to update the task.', 'error')
  })

  it('adds a task to Someday from the row', async () => {
    const wrapper = await mountCalendar()
    expect(wrapper.find('.someday-task').exists()).toBe(false)

    await wrapper.get('[aria-label="Add a Someday task"]').trigger('click')
    const input = wrapper.get('[aria-label="New Someday task"]')
    await input.setValue('  Plant a tree  ')
    await wrapper.get('.someday-form').trigger('submit')
    await flushPromises()

    const [, options] = fetch.mock.calls.find(
      ([url, init]) => url === TASKS_ENDPOINT && init?.method === 'POST',
    )
    expect(JSON.parse(options.body)).toEqual({ content: 'Plant a tree', dueDate: '9999-12-31' })
    expect(wrapper.findAll('.someday-title').map((title) => title.text())).toEqual(['Plant a tree'])
    // The field stays for the next one; left empty, it gives way to the button.
    expect(input.element.value).toBe('')
    await input.trigger('blur')
    expect(wrapper.find('[aria-label="New Someday task"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="Add a Someday task"]').exists()).toBe(true)
  })

  it('opens a Someday task in its panel on the calendar when its title is clicked', async () => {
    mockCalendarApi({ tasks: [...SEED_TASKS, ...SOMEDAY_TASKS] })
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: { template: '<div />' } },
        { path: '/calendar', component: { template: '<div />' } },
        { path: '/tasks', name: 'tasks', component: { template: '<div />' } },
        { path: '/settings/:section?', name: 'settings', component: { template: '<div />' } },
      ],
    })
    await router.push('/calendar')
    stubTaskStores()
    const wrapper = await mountCalendar({
      global: { plugins: [router], stubs: { TaskDetailPanel: true } },
    })

    await wrapper.findAll('.someday-title')[1].trigger('click')
    await flushPromises()

    expect(wrapper.findComponent({ name: 'TaskDetailPanel' }).props('taskId')).toBe(
      'task-someday-2',
    )
    expect(router.currentRoute.value.fullPath).toBe('/calendar')
  })

  // Drags carry a dataTransfer the way browsers build one; jsdom's events do
  // not, so these hand one in.
  const dataTransfer = () => ({ effectAllowed: '', dropEffect: '', setData: vi.fn() })
  const taskWrites = () =>
    fetch.mock.calls
      .filter(([url, options]) => url === TASKS_ENDPOINT && options?.method === 'PATCH')
      .map(([, options]) => JSON.parse(options.body))

  it('gives a Someday task the day and time it is dropped on, running for its estimate', async () => {
    mockCalendarApi({ tasks: [...SEED_TASKS, ...SOMEDAY_TASKS] })
    const wrapper = await mountCalendar({ attachTo: document.body })
    const lane = wrapper.get('.day-event-lane')
    mockRect(lane.element)
    const transfer = dataTransfer()

    const title = wrapper
      .findAll('.someday-title')
      .find((button) => button.text() === 'Learn to juggle')
    expect(title.attributes('draggable')).toBe('true')
    await title.trigger('dragstart', { dataTransfer: transfer })
    expect(transfer.effectAllowed).toBe('move')

    // The lane's 1100px hold the 11 visible hours from 8 AM: clientX 200 is
    // 10 AM. The preview is as long as the task's 90-minute estimate.
    await lane.trigger('dragover', { clientX: 200, clientY: 10, dataTransfer: transfer })
    expect(transfer.dropEffect).toBe('move')
    const preview = wrapper.get('.day-event.drag-preview').element.style
    expect(Number.parseFloat(preview.left)).toBeCloseTo((2 / 11) * 100, 3)
    expect(Number.parseFloat(preview.width)).toBeCloseTo((1.5 / 11) * 100, 3)

    // Passing over an event chip inside the lane keeps the preview.
    await lane.trigger('dragleave', { clientX: 210, clientY: 10 })
    expect(wrapper.find('.day-event.drag-preview').exists()).toBe(true)
    await lane.trigger('dragleave', { clientX: -5, clientY: 10 })
    expect(wrapper.find('.day-event.drag-preview').exists()).toBe(false)

    await lane.trigger('dragover', { clientX: 200, clientY: 10, dataTransfer: transfer })
    await lane.trigger('drop', { clientX: 200, clientY: 10, dataTransfer: transfer })
    await flushPromises()

    expect(taskWrites()).toEqual([
      {
        id: 'task-someday-1',
        dueDate: '2026-07-24',
        dueTime: '10:00',
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    ])
    expect(wrapper.findAll('.someday-title').map((button) => button.text())).toEqual([
      'Sort the garage',
    ])
    const placed = wrapper
      .findAll('.day-event.task-event')
      .find((event) => event.get('strong').text() === 'Learn to juggle')
    expect(placed.get('.day-event-time').text()).toBe('10:00 AM – 11:30 AM')
    expect(wrapper.find('.day-event.drag-preview').exists()).toBe(false)
    wrapper.unmount()
  })

  it("schedules a dropped Someday task on the week column's day, half an hour long by default", async () => {
    mockCalendarApi({ tasks: [...SEED_TASKS, ...SOMEDAY_TASKS] })
    const wrapper = await mountCalendar({ attachTo: document.body })
    await wrapper.get('.calendar-view-tabs button:nth-child(2)').trigger('click')
    const grid = wrapper.get('.week-grid')
    mockRect(grid.element)
    const transfer = dataTransfer()

    const title = wrapper
      .findAll('.someday-title')
      .find((button) => button.text() === 'Sort the garage')
    await title.trigger('dragstart', { dataTransfer: transfer })
    // The grid's 1100px hold seven columns, so clientX 400 is in the third
    // (Wednesday 22 July); 72px per hour from 8 AM puts clientY 144 at 10 AM.
    await grid.trigger('dragover', { clientX: 400, clientY: 144, dataTransfer: transfer })
    const preview = wrapper.get('.week-event.drag-preview').element.style
    expect(preview.top).toBe('144px')
    expect(preview.height).toBe('36px')
    // jsdom folds the column's share of the width into a percentage.
    expect(preview.left).toMatch(/^calc\(28\.57\d*% \+ 8px\)$/)

    await grid.trigger('drop', { clientX: 400, clientY: 144, dataTransfer: transfer })
    await flushPromises()

    expect(taskWrites()[0]).toMatchObject({
      id: 'task-someday-2',
      dueDate: '2026-07-22',
      dueTime: '10:00',
    })
    const placed = wrapper
      .findAll('.week-event.task-event')
      .find((event) => event.get('strong').text() === 'Sort the garage')
    expect(placed.element.style.top).toBe('144px')
    // Half an hour is 36px; week chips never draw shorter than 38px.
    expect(placed.element.style.height).toBe('38px')
    expect(wrapper.findAll('.someday-title').map((button) => button.text())).toEqual([
      'Learn to juggle',
    ])
    wrapper.unmount()
  })

  it('puts a dropped Someday task back in its place in the row when the save fails', async () => {
    mockCalendarApi({ tasks: [...SEED_TASKS, ...SOMEDAY_TASKS] })
    const wrapper = await mountCalendar({ attachTo: document.body })
    const respond = fetch.getMockImplementation()
    fetch.mockImplementation(async (url, options = {}) =>
      options.method === 'PATCH' ? { ok: false, status: 500 } : respond(url, options),
    )
    const lane = wrapper.get('.day-event-lane')
    mockRect(lane.element)
    const transfer = dataTransfer()

    await wrapper.findAll('.someday-title')[0].trigger('dragstart', { dataTransfer: transfer })
    await lane.trigger('dragover', { clientX: 200, clientY: 10, dataTransfer: transfer })
    await lane.trigger('drop', { clientX: 200, clientY: 10, dataTransfer: transfer })
    await flushPromises()

    expect(wrapper.findAll('.someday-title').map((button) => button.text())).toEqual([
      'Learn to juggle',
      'Sort the garage',
    ])
    expect(wrapper.findAll('.task-event').map((task) => task.text())).not.toContain(
      'Learn to juggle',
    )
    expect(useInboxStore().notify).toHaveBeenCalledWith('Failed to schedule the task.', 'error')
    wrapper.unmount()
  })

  it('ignores drops on the calendar that did not start from the Someday row', async () => {
    mockCalendarApi({ tasks: [...SEED_TASKS, ...SOMEDAY_TASKS] })
    const wrapper = await mountCalendar({ attachTo: document.body })
    const lane = wrapper.get('.day-event-lane')
    mockRect(lane.element)
    const transfer = dataTransfer()

    await lane.trigger('dragover', { clientX: 200, clientY: 10, dataTransfer: transfer })
    expect(wrapper.find('.day-event.drag-preview').exists()).toBe(false)
    await lane.trigger('drop', { clientX: 200, clientY: 10, dataTransfer: transfer })
    await flushPromises()
    expect(taskWrites()).toEqual([])
    wrapper.unmount()
  })

  it('colors an event chip to match its owning calendar', async () => {
    const wrapper = await mountCalendar()

    // Standup is on the Work calendar (#4f7c6b) with the default tone, so it
    // should pick up the calendar's color rather than a fixed neutral.
    const standup = wrapper.find('.day-event')
    expect(standup.text()).toContain('Standup')
    expect(standup.element.style.getPropertyValue('--event-color')).toBe('#4f7c6b')

    await wrapper.get('.calendar-view-tabs button:nth-child(3)').trigger('click')
    const designReview = wrapper
      .findAll('.month-event')
      .find((event) => event.text().includes('Design review'))
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
          String(url).startsWith(`${EVENTS_ENDPOINT}?from=`) &&
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

  it('retries the event load on navigation after the first load fails', async () => {
    const fetchMock = globalThis.fetch
    const realFetch = fetchMock.getMockImplementation()
    let failNext = true
    fetchMock.mockImplementation(async (url, options) => {
      if (isEventsEndpoint(String(url)) && !options?.method && failNext) {
        failNext = false
        return { ok: false, status: 500, json: async () => ({}) }
      }
      return realFetch(url, options)
    })
    const wrapper = await mountCalendar()
    expect(wrapper.text()).not.toContain('Standup')

    // Even a hop inside the would-be window refetches, since nothing loaded.
    await wrapper.get('[aria-label="Next period"]').trigger('click')
    await wrapper.get('[aria-label="Previous period"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Standup')
  })

  it('fetches the new window when navigation jumps away during the first load', async () => {
    const fetchMock = globalThis.fetch
    const realFetch = fetchMock.getMockImplementation()
    const eventUrls = []
    let releaseFirst
    const firstHeld = new Promise((resolve) => (releaseFirst = resolve))
    fetchMock.mockImplementation(async (url, options) => {
      if (isEventsEndpoint(String(url)) && !options?.method) {
        eventUrls.push(String(url))
        if (eventUrls.length === 1) await firstHeld
      }
      return realFetch(url, options)
    })
    const wrapper = mount(CalendarView)
    await wrapper.get('.calendar-view-tabs button:nth-child(3)').trigger('click')
    for (let i = 0; i < 6; i += 1) {
      await wrapper.get('[aria-label="Next period"]').trigger('click')
    }
    releaseFirst()
    await flushPromises()
    const lastTo = new URLSearchParams(eventUrls.at(-1).split('?')[1]).get('to')
    // January 2027 plus the 45+60 day pad, well past the first window.
    expect(lastTo > '2027-03-01').toBe(true)
  })

  it('positions the current-time line from the real clock in Day and Week views', async () => {
    // Fake only Date so flushPromises (which relies on real setTimeout) still works.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 6, 24, 10, 30))
    try {
      const wrapper = await mountCalendar()

      // 10:30 AM is 2.5 hours into the day view's 11 visible hours, which run
      // left to right.
      const dayLine = wrapper.get('.day-current-time')
      expect(Number.parseFloat(dayLine.element.style.left)).toBeCloseTo((2.5 / 11) * 100, 3)
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

  it('moves "today" forward when the clock passes midnight', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date(2026, 6, 24, 23, 59))
    try {
      const wrapper = await mountCalendar()
      await wrapper.get('.calendar-view-tabs button:nth-child(3)').trigger('click')
      expect(wrapper.get('.month-date.today').text()).toBe('24')

      vi.setSystemTime(new Date(2026, 6, 25, 0, 0))
      vi.advanceTimersByTime(60_000)
      await flushPromises()
      expect(wrapper.get('.month-date.today').text()).toBe('25')

      await wrapper.get('.calendar-view-tabs button:nth-child(1)').trigger('click')
      await wrapper.get('.today-button').trigger('click')
      expect(wrapper.get('h1').text()).toBe('Saturday, July 25, 2026')
    } finally {
      vi.useRealTimers()
    }
  })

  it('starts a new event in the calendar chosen in Settings, else Personal', async () => {
    mockCalendarApi({ defaultCalendarId: 'focus' })
    resetCalendarsStateForTests()
    let wrapper = await mountCalendar()
    await wrapper.get('.calendar-sidebar-create').trigger('click')
    await wrapper.get('.new-event-advanced').trigger('click')
    expect(wrapper.get('select[aria-label="Event calendar"]').element.value).toBe('focus')
    wrapper.unmount()

    // Nothing chosen (or a choice the Worker no longer reports): Personal.
    mockCalendarApi()
    resetCalendarsStateForTests()
    wrapper = await mountCalendar()
    await wrapper.get('.calendar-sidebar-create').trigger('click')
    await wrapper.get('.new-event-advanced').trigger('click')
    expect(wrapper.get('select[aria-label="Event calendar"]').element.value).toBe('personal')
    wrapper.unmount()
  })

  it('opens the New event dialog with the AI text box focused and offers Advanced entry', async () => {
    const wrapper = await mountCalendar({ attachTo: document.body })

    await wrapper.get('.calendar-sidebar-create').trigger('click')

    const aiInput = wrapper.get('.new-event-ai-input')
    expect(aiInput.attributes('placeholder')).toBe('Dinner with Sam tomorrow at 7pm for two hours')
    expect(aiInput.element).toBe(document.activeElement)
    expect(wrapper.find('.new-event-title-input').exists()).toBe(false)
    expect(wrapper.find('input[placeholder="Add location"]').exists()).toBe(false)

    expect(wrapper.get('.new-event-create').text()).toBe('Create Event')
    const create = wrapper.get('.new-event-create')
    expect(create.attributes('disabled')).toBeDefined()

    await wrapper.get('.new-event-advanced').trigger('click')
    const title = wrapper.get('.new-event-title-input')
    expect(title.element).toBe(document.activeElement)
    expect(wrapper.find('input[placeholder="Add location"]').exists()).toBe(true)

    await title.setValue('Lunch with Mia')
    expect(wrapper.get('.new-event-create').attributes('disabled')).toBeUndefined()
    await wrapper.get('.new-event-create').trigger('click')
    await flushPromises()

    expect(wrapper.find('.new-event-dialog').exists()).toBe(false)
    expect(wrapper.text()).toContain('Lunch with Mia')
    wrapper.unmount()
  })

  it('creates an event from natural language through the AI interpreter', async () => {
    const wrapper = await mountCalendar({ attachTo: document.body })

    await wrapper.get('.calendar-sidebar-create').trigger('click')
    await wrapper
      .get('.new-event-ai-input')
      .setValue('Dinner with Sam tomorrow at 7pm for two hours')
    await wrapper.get('.new-event-create').trigger('click')
    await flushPromises()

    const postBodies = vi
      .mocked(fetch)
      .mock.calls.filter(([url, options]) => url === EVENTS_ENDPOINT && options?.method === 'POST')
      .map(([, options]) => JSON.parse(options.body))
    expect(postBodies).toContainEqual({
      action: 'interpret',
      text: 'Dinner with Sam tomorrow at 7pm for two hours',
      timeZone: expect.any(String),
    })
    expect(postBodies).toContainEqual(
      expect.objectContaining({
        title: 'Dinner with Sam',
        date: '2026-07-25',
        start: '19:00',
        duration: 120,
        calendar: 'personal',
      }),
    )
    expect(wrapper.find('.new-event-dialog').exists()).toBe(false)
    await wrapper.findAll('.calendar-navigation button')[1].trigger('click')
    expect(wrapper.text()).toContain('Dinner with Sam')
    wrapper.unmount()
  })

  it('sends an AI-drafted event to a Google default without a repeat rule', async () => {
    mockCalendarApi({ google: true, defaultCalendarId: 'google:me@example.com' })
    resetCalendarsStateForTests()
    const wrapper = await mountCalendar({ attachTo: document.body })

    await wrapper.get('.calendar-sidebar-create').trigger('click')
    await wrapper.get('.new-event-ai-input').setValue('Dinner with Sam every Saturday at 7pm')
    await wrapper.get('.new-event-create').trigger('click')
    await flushPromises()

    const created = vi
      .mocked(fetch)
      .mock.calls.filter(([url, options]) => url === EVENTS_ENDPOINT && options?.method === 'POST')
      .map(([, options]) => JSON.parse(options.body))
      .find((body) => body.action !== 'interpret')
    expect(created).toEqual(
      expect.objectContaining({
        calendar: 'google:me@example.com',
        repeat: 'none',
        repeatUntil: null,
        repeatDays: null,
        timeZone: expect.any(String),
      }),
    )
    expect(wrapper.find('.new-event-dialog').exists()).toBe(false)
    wrapper.unmount()
  })

  it('ignores a second Create click fired before the first request resolves', async () => {
    const wrapper = await mountCalendar({ attachTo: document.body })

    await wrapper.get('.calendar-sidebar-create').trigger('click')
    await wrapper.get('.new-event-advanced').trigger('click')
    await wrapper.get('.new-event-title-input').setValue('Lunch with Mia')

    const create = wrapper.get('.new-event-create')
    // Both dispatches run synchronously before either handler's first await
    // yields, so the second call must observe the in-flight guard.
    create.trigger('click')
    create.trigger('click')
    await flushPromises()

    const postCalls = fetch.mock.calls.filter(
      ([url, options]) => url === EVENTS_ENDPOINT && options?.method === 'POST',
    )
    expect(postCalls).toHaveLength(1)
    wrapper.unmount()
  })

  async function startOperationWithPendingLink(action, succeeds) {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/calendar', component: { template: '<div />' } },
        { path: '/settings/:section?', name: 'settings', component: { template: '<div />' } },
      ],
    })
    await router.push('/calendar?date=2026-07-24&event=standup')
    const wrapper = await mountCalendar({ global: { plugins: [router] } })
    await wrapper.get('.new-event-title-input').setValue('My unsaved standup edits')

    const api = fetch.getMockImplementation()
    let finishRequest
    const pending = new Promise((resolve) => {
      finishRequest = resolve
    })
    const method = action === 'save' ? 'PATCH' : 'DELETE'
    fetch.mockImplementation(async (url, options = {}) => {
      if (url === EVENTS_ENDPOINT && options.method === method) {
        await pending
        if (!succeeds) return { ok: false, status: 500 }
      }
      return api(url, options)
    })
    await wrapper
      .get(action === 'save' ? '.new-event-create' : '.new-event-delete')
      .trigger('click')
    await flushPromises()
    await router.push('/calendar?date=2026-07-25&event=design')
    await flushPromises()
    expect(wrapper.get('.new-event-title-input').element.value).toBe('My unsaved standup edits')

    return { wrapper, router, finishRequest }
  }

  it.each(['save', 'delete'])(
    'opens the pending link after a successful %s closes its dialog',
    async (action) => {
      const { wrapper, finishRequest } = await startOperationWithPendingLink(action, true)
      finishRequest()
      await flushPromises()
      expect(wrapper.get('.new-event-title-input').element.value).toBe('Design review')
      wrapper.unmount()
    },
  )

  it.each(['save', 'delete'])(
    'preserves failed %s edits until dismissal, then opens the latest link',
    async (action) => {
      const { wrapper, router, finishRequest } = await startOperationWithPendingLink(action, false)
      finishRequest()
      await flushPromises()
      expect(wrapper.get('.new-event-title-input').element.value).toBe('My unsaved standup edits')
      expect(useInboxStore().notify).toHaveBeenCalledWith(`Failed to ${action} event.`, 'error')
      // Further navigation must keep the failed form and remember only the latest link.
      await router.push('/calendar?date=2026-07-24&event=coffee')
      await flushPromises()
      expect(wrapper.get('.new-event-title-input').element.value).toBe('My unsaved standup edits')
      await wrapper.get('.new-event-cancel').trigger('click')
      await flushPromises()
      expect(wrapper.get('.new-event-title-input').element.value).toBe('Coffee with Sam')
      wrapper.unmount()
    },
  )

  it.each(['save', 'delete'])(
    'preserves failed %s edits when navigation commits in the same watcher batch',
    async (action) => {
      const router = createRouter({
        history: createMemoryHistory(),
        routes: [
          { path: '/calendar', component: { template: '<div />' } },
          { path: '/settings/:section?', name: 'settings', component: { template: '<div />' } },
        ],
      })
      await router.push('/calendar?date=2026-07-24&event=standup')
      const wrapper = await mountCalendar({ global: { plugins: [router] } })
      await wrapper.get('.new-event-title-input').setValue('Keep these edits')
      const api = fetch.getMockImplementation()
      const method = action === 'save' ? 'PATCH' : 'DELETE'
      fetch.mockImplementation((url, options = {}) =>
        url === EVENTS_ENDPOINT && options.method === method
          ? Promise.resolve({ ok: false, status: 500 })
          : api(url, options),
      )
      const store = useInboxStore()
      store.notify.mockImplementationOnce(() => {
        // Commit navigation in the failure continuation, before its finally
        // clears eventSaving. Both changes reach Vue's default watchers in
        // one batch; router.push would introduce extra promise turns here.
        router.currentRoute.value = router.resolve('/calendar?date=2026-07-25&event=design')
      })
      await wrapper
        .get(action === 'save' ? '.new-event-create' : '.new-event-delete')
        .trigger('click')
      await flushPromises()
      expect(store.notify).toHaveBeenCalledWith(`Failed to ${action} event.`, 'error')
      expect(router.currentRoute.value.query.event).toBe('design')
      expect(wrapper.get('.new-event-title-input').element.value).toBe('Keep these edits')
      await wrapper.get('.new-event-cancel').trigger('click')
      await flushPromises()
      expect(wrapper.get('.new-event-title-input').element.value).toBe('Design review')
      wrapper.unmount()
    },
  )

  it('keeps the edit dialog open while a save is in flight so it cannot become a create', async () => {
    const wrapper = await mountCalendar({ attachTo: document.body })
    const store = useInboxStore()

    const standup = wrapper.findAll('.day-event').find((event) => event.text().includes('Standup'))
    await standup.trigger('click')
    await wrapper.get('.new-event-title-input').setValue('Daily Standup')

    let releaseHeaders
    store.authHeaders.mockImplementationOnce(
      () => new Promise((resolve) => (releaseHeaders = () => resolve({}))),
    )
    await wrapper.get('.new-event-create').trigger('click')

    // Every dismissal path is ignored while the save is pending.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.get('.new-event-overlay').trigger('mousedown')
    await wrapper.get('.new-event-cancel').trigger('click')
    expect(wrapper.find('.new-event-dialog').exists()).toBe(true)

    releaseHeaders()
    await flushPromises()

    const writes = vi
      .mocked(fetch)
      .mock.calls.filter(
        ([url, options]) => url === EVENTS_ENDPOINT && ['POST', 'PATCH'].includes(options?.method),
      )
    expect(writes).toHaveLength(1)
    expect(writes[0][1].method).toBe('PATCH')
    expect(JSON.parse(writes[0][1].body).id).toBe('standup')
    expect(wrapper.find('.new-event-dialog').exists()).toBe(false)
    wrapper.unmount()
  })

  it('holds a palette New event request until an in-flight save has closed its dialog', async () => {
    const wrapper = await mountCalendar({ attachTo: document.body })
    const store = useInboxStore()

    const standup = wrapper.findAll('.day-event').find((event) => event.text().includes('Standup'))
    await standup.trigger('click')
    await wrapper.get('.new-event-title-input').setValue('Daily Standup')

    let releaseHeaders
    store.authHeaders.mockImplementationOnce(
      () => new Promise((resolve) => (releaseHeaders = () => resolve({}))),
    )
    await wrapper.get('.new-event-create').trigger('click')

    // The command palette's "Create Event" fires mid-save.
    store.calendarNewEventPending = true
    store.calendarNewEventRequestId++
    await flushPromises()
    expect(wrapper.get('.new-event-title-input').element.value).toBe('Daily Standup')
    expect(store.calendarNewEventPending).toBe(true)

    releaseHeaders()
    await flushPromises()

    const writes = vi
      .mocked(fetch)
      .mock.calls.filter(
        ([url, options]) => url === EVENTS_ENDPOINT && ['POST', 'PATCH'].includes(options?.method),
      )
    expect(writes).toHaveLength(1)
    expect(writes[0][1].method).toBe('PATCH')
    expect(store.calendarNewEventPending).toBe(false)
    // A fresh New event draft is open, not the edited event and not closed.
    expect(wrapper.find('.new-event-dialog').exists()).toBe(true)
    expect(wrapper.find('.new-event-ai-input').exists()).toBe(true)
    expect(wrapper.find('.new-event-delete').exists()).toBe(false)
    wrapper.unmount()
  })

  it('remembers which email a saved Mail suggestion came from', async () => {
    const store = useInboxStore()
    store.requestCalendarNewEvent({
      title: 'Guided tour',
      description: 'From Campus Tours: Meet at the Visitor Center.',
      location: '',
      date: '2026-07-28',
      start: '10:00',
      end: '11:00',
      sourceMessageId: 'msg-tour',
    })
    const wrapper = await mountCalendar({ attachTo: document.body })

    expect(wrapper.get('.new-event-title-input').element.value).toBe('Guided tour')
    // Edits in the dialog do not break the link: it is keyed by the saved id.
    await wrapper.get('.new-event-title-input').setValue('Campus visit')
    await wrapper.get('.new-event-create').trigger('click')
    await flushPromises()

    const post = vi
      .mocked(fetch)
      .mock.calls.find(([url, options]) => url === EVENTS_ENDPOINT && options?.method === 'POST')
    expect(JSON.parse(post[1].body)).not.toHaveProperty('sourceMessageId')
    expect(rememberedEmailCalendarEvent('msg-tour')).toEqual({
      id: 'generated-1',
      date: '2026-07-28',
    })
    expect(wrapper.find('.new-event-dialog').exists()).toBe(false)

    // A plain New event afterwards is not attributed to that email.
    await wrapper.get('.calendar-sidebar-create').trigger('click')
    await wrapper.get('.new-event-advanced').trigger('click')
    await wrapper.get('.new-event-title-input').setValue('Unrelated')
    await wrapper.get('.new-event-create').trigger('click')
    await flushPromises()
    expect(rememberedEmailCalendarEvent('msg-tour')).toEqual({
      id: 'generated-1',
      date: '2026-07-28',
    })
    wrapper.unmount()
  })

  it('moves an email link along with the event it points at', async () => {
    rememberEmailCalendarEvent('msg-standup', { id: 'standup', date: '2026-07-24' })
    rememberEmailCalendarEvent('msg-design', { id: 'design', date: '2026-07-25' })
    const wrapper = await mountCalendar({ attachTo: document.body })

    const standup = wrapper.findAll('.day-event').find((event) => event.text().includes('Standup'))
    await standup.trigger('click')
    await wrapper.get('input[type="date"]').setValue('2026-07-27')
    await wrapper.get('.new-event-create').trigger('click')
    await flushPromises()

    expect(wrapper.find('.new-event-dialog').exists()).toBe(false)
    expect(rememberedEmailCalendarEvent('msg-standup')).toEqual({
      id: 'standup',
      date: '2026-07-27',
    })
    expect(rememberedEmailCalendarEvent('msg-design')).toEqual({ id: 'design', date: '2026-07-25' })
    wrapper.unmount()
  })

  it('keeps a pending New event request when the view unmounts before its first load', async () => {
    const store = useInboxStore()
    store.calendarNewEventPending = true

    const wrapper = mount(CalendarView)
    wrapper.unmount()
    await flushPromises()

    expect(store.calendarNewEventPending).toBe(true)
  })

  it('traps Tab inside the event dialog and restores focus to its opener on close', async () => {
    const wrapper = await mountCalendar({ attachTo: document.body })

    const opener = wrapper.get('.calendar-sidebar-create')
    opener.element.focus()
    await opener.trigger('click')
    await flushPromises()

    const dialog = wrapper.get('.new-event-dialog')
    const focusable = dialog
      .findAll('input, select, textarea, button')
      .filter((element) => !element.element.disabled)
    focusable.at(-1).element.focus()
    await dialog.trigger('keydown', { key: 'Tab' })
    expect(document.activeElement).toBe(focusable[0].element)

    await dialog.trigger('keydown', { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(focusable.at(-1).element)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(wrapper.find('.new-event-dialog').exists()).toBe(false)
    expect(document.activeElement).toBe(opener.element)
    wrapper.unmount()
  })

  it('creates an event by dragging on the day timeline, prefilling date, start, and end', async () => {
    const wrapper = await mountCalendar({ attachTo: document.body })
    const lane = wrapper.get('.day-event-lane')
    mockRect(lane.element)

    // The lane's 1100px hold the 11 visible hours from 8 AM, left to right:
    // clientX 100 -> 9:00, clientX 200 -> 10:00.
    await lane.trigger('mousedown', { clientX: 100, button: 0 })
    await lane.trigger('mousemove', { clientX: 200, button: 0 })
    const preview = wrapper.get('.day-event.drag-preview').element.style
    expect(Number.parseFloat(preview.left)).toBeCloseTo((1 / 11) * 100, 3)
    expect(Number.parseFloat(preview.width)).toBeCloseTo((1 / 11) * 100, 3)
    await lane.trigger('mouseup', { clientX: 200, button: 0 })

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

    await lane.trigger('mousedown', { clientX: 300, button: 0 })
    await lane.trigger('mouseup', { clientX: 300, button: 0 })

    const timeInputs = wrapper.findAll('input[type="time"]')
    expect(timeInputs[0].element.value).toBe('11:00')
    expect(timeInputs[1].element.value).toBe('11:30')
    wrapper.unmount()
  })

  const dayChip = (wrapper, title) =>
    wrapper
      .findAll('.day-event:not(.drag-preview)')
      .find((chip) => chip.get('strong').text() === title)
  const eventWrites = () =>
    fetch.mock.calls
      .filter(([url, options]) => url === EVENTS_ENDPOINT && options?.method === 'PATCH')
      .map(([, options]) => JSON.parse(options.body))
  // Mouse moves and the release are heard on the window, wherever they land.
  async function dragChip(chip, from, to) {
    await chip.trigger('mousedown', { clientX: from, button: 0 })
    await chip.trigger('mousemove', { clientX: to, button: 0 })
  }

  it('moves an event to the time it is dragged to on the day timeline', async () => {
    const wrapper = await mountCalendar({ attachTo: document.body })
    mockRect(wrapper.get('.day-event-lane').element)

    // The lane's 1100px hold the 11 visible hours from 8 AM: 200px to the
    // right is two hours later, so the 9:00 Standup lands on 11:00.
    await dragChip(dayChip(wrapper, 'Standup'), 120, 320)
    expect(dayChip(wrapper, 'Standup').classes()).toContain('moving')
    const preview = wrapper.get('.day-event.move-preview')
    expect(preview.get('.day-event-time').text()).toBe('11:00 AM – 11:30 AM')
    expect(Number.parseFloat(preview.element.style.left)).toBeCloseTo((3 / 11) * 100, 3)
    expect(Number.parseFloat(preview.element.style.width)).toBeCloseTo((0.5 / 11) * 100, 3)

    await dayChip(wrapper, 'Standup').trigger('mouseup', { clientX: 320, button: 0 })
    // The click that ends the drag does not open the event.
    await dayChip(wrapper, 'Standup').trigger('click')
    await flushPromises()

    expect(wrapper.find('.new-event-dialog').exists()).toBe(false)
    expect(wrapper.find('.day-event.move-preview').exists()).toBe(false)
    expect(eventWrites()).toEqual([
      {
        id: 'standup',
        title: 'Standup',
        date: '2026-07-24',
        start: '11:00',
        duration: 30,
        location: null,
        description: null,
        calendar: 'work',
        repeat: 'none',
        repeatUntil: null,
        repeatDays: null,
        tone: null,
        timeZone: browserTimeZone(),
      },
    ])
    const moved = dayChip(wrapper, 'Standup')
    expect(moved.classes()).not.toContain('moving')
    expect(moved.get('.day-event-time').text()).toBe('11:00 AM – 11:30 AM')

    // Once the drag is over, a click opens the event as before.
    await new Promise((resolve) => setTimeout(resolve))
    await moved.trigger('click')
    expect(wrapper.find('.new-event-dialog').exists()).toBe(true)
    wrapper.unmount()
  })

  it('keeps a dragged event inside the visible hours', async () => {
    const wrapper = await mountCalendar({ attachTo: document.body })
    mockRect(wrapper.get('.day-event-lane').element)

    await dragChip(dayChip(wrapper, 'Standup'), 120, 5000)
    expect(wrapper.get('.day-event.move-preview .day-event-time').text()).toBe('6:30 PM – 7:00 PM')
    await dayChip(wrapper, 'Standup').trigger('mousemove', { clientX: -5000, button: 0 })
    expect(wrapper.get('.day-event.move-preview .day-event-time').text()).toBe('8:00 AM – 8:30 AM')
    await dayChip(wrapper, 'Standup').trigger('mouseup', { clientX: -5000, button: 0 })
    await flushPromises()

    expect(eventWrites().map(({ start }) => start)).toEqual(['08:00'])
    wrapper.unmount()
  })

  it('opens an event that is pressed without being dragged, and saves nothing', async () => {
    const wrapper = await mountCalendar({ attachTo: document.body })
    mockRect(wrapper.get('.day-event-lane').element)

    const standup = dayChip(wrapper, 'Standup')
    await dragChip(standup, 120, 122)
    expect(wrapper.find('.day-event.move-preview').exists()).toBe(false)
    await standup.trigger('mouseup', { clientX: 122, button: 0 })
    await standup.trigger('click')
    await flushPromises()

    expect(wrapper.find('.new-event-dialog').exists()).toBe(true)
    expect(eventWrites()).toEqual([])
    wrapper.unmount()
  })

  it('puts a dragged event back at its time when the save fails', async () => {
    const wrapper = await mountCalendar({ attachTo: document.body })
    mockRect(wrapper.get('.day-event-lane').element)
    const respond = fetch.getMockImplementation()
    fetch.mockImplementation(async (url, options = {}) =>
      options.method === 'PATCH' ? { ok: false, status: 500 } : respond(url, options),
    )

    await dragChip(dayChip(wrapper, 'Standup'), 120, 320)
    await dayChip(wrapper, 'Standup').trigger('mouseup', { clientX: 320, button: 0 })
    await flushPromises()

    expect(dayChip(wrapper, 'Standup').get('.day-event-time').text()).toBe('9:00 AM – 9:30 AM')
    expect(useInboxStore().notify).toHaveBeenCalledWith('Failed to move the event.', 'error')
    wrapper.unmount()
  })

  it('moves a timed task along the day timeline by changing its due time', async () => {
    const wrapper = await mountCalendar({ attachTo: document.body })
    mockRect(wrapper.get('.day-event-lane').element)

    // An hour and a half earlier: 150px to the left of where it was pressed.
    await dragChip(dayChip(wrapper, 'Call the bank'), 800, 650)
    await dayChip(wrapper, 'Call the bank').trigger('mouseup', { clientX: 650, button: 0 })
    await flushPromises()

    const writes = fetch.mock.calls
      .filter(([url, options]) => url === TASKS_ENDPOINT && options?.method === 'PATCH')
      .map(([, options]) => JSON.parse(options.body))
    expect(writes).toEqual([{ id: 'task-2', dueTime: '13:30', timeZone: browserTimeZone() }])
    expect(eventWrites()).toEqual([])
    expect(dayChip(wrapper, 'Call the bank').get('.day-event-time').text()).toBe(
      '1:30 PM – 3:00 PM',
    )
    wrapper.unmount()
  })

  it('leaves a repeating event where it is when dragged, since that would move the series', async () => {
    const wrapper = await mountCalendar({ attachTo: document.body })
    mockRect(wrapper.get('.day-event-lane').element)

    await dragChip(dayChip(wrapper, 'Recurring review'), 900, 700)
    expect(wrapper.find('.day-event.move-preview').exists()).toBe(false)
    await dayChip(wrapper, 'Recurring review').trigger('mouseup', { clientX: 700, button: 0 })
    await flushPromises()

    expect(eventWrites()).toEqual([])
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
      .mock.calls.find(([url, options]) => url === EVENTS_ENDPOINT && options?.method === 'PATCH')
    expect(JSON.parse(updateCall[1].body).calendar).toBe('personal')
    wrapper.unmount()
  })

  it('reloads occurrences when a series repeat is cleared', async () => {
    const wrapper = await mountCalendar({ attachTo: document.body })
    const occurrence = wrapper
      .findAll('.day-event')
      .find((event) => event.text().includes('Recurring review'))
    await occurrence.trigger('click')
    await wrapper.get('select[aria-label="Event repeats"]').setValue('none')
    const before = fetch.mock.calls.filter(
      ([url, options]) =>
        isEventsEndpoint(String(url)) && (!options?.method || options.method === 'GET'),
    ).length
    await wrapper.get('.new-event-create').trigger('click')
    await flushPromises()
    expect(
      fetch.mock.calls.filter(
        ([url, options]) =>
          isEventsEndpoint(String(url)) && (!options?.method || options.method === 'GET'),
      ).length,
    ).toBeGreaterThan(before)
    wrapper.unmount()
  })

  it('shows a persistent notice when the calendar response is truncated', async () => {
    const real = fetch.getMockImplementation()
    fetch.mockImplementation(async (url, options) => {
      const response = await real(url, options)
      if (isEventsEndpoint(String(url)) && !options?.method)
        return { ...response, json: async () => ({ ...(await response.json()), truncated: true }) }
      return response
    })
    const wrapper = await mountCalendar()
    expect(wrapper.get('[role="status"]').text()).toContain('Some events could not be shown')
    wrapper.unmount()
  })

  it('ignores errors from a superseded calendar window', async () => {
    const real = fetch.getMockImplementation()
    let rejectFirst
    let calls = 0
    fetch.mockImplementation(async (url, options) => {
      if (isEventsEndpoint(String(url)) && !options?.method && ++calls === 1)
        return new Promise((_resolve, reject) => {
          rejectFirst = reject
        })
      return real(url, options)
    })
    const notify = vi.spyOn(useInboxStore(), 'notify').mockImplementation(() => {})
    const wrapper = mount(CalendarView)
    await flushPromises()
    await wrapper.get('.calendar-view-tabs button:nth-child(3)').trigger('click')
    for (let i = 0; i < 6; i++) await wrapper.get('[aria-label="Next period"]').trigger('click')
    await flushPromises()
    rejectFirst(new Error('old window failed'))
    await flushPromises()
    expect(notify).not.toHaveBeenCalledWith('Failed to load calendar events.', 'error')
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
      .mock.calls.find(([url, options]) => url === EVENTS_ENDPOINT && options?.method === 'PATCH')
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
    await wrapper.get('.new-event-advanced').trigger('click')

    expect(wrapper.find('.new-event-delete').exists()).toBe(false)
    expect(wrapper.get('.new-event-create').text()).toBe('Create Event')
    wrapper.unmount()
  })

  it('persists created, edited, and deleted events through the backend across a remount', async () => {
    const wrapper = await mountCalendar({ attachTo: document.body })
    await wrapper.get('.calendar-sidebar-create').trigger('click')
    await wrapper.get('.new-event-advanced').trigger('click')
    await wrapper.get('.new-event-title-input').setValue('Board game night')
    await wrapper.get('.new-event-create').trigger('click')
    await flushPromises()
    wrapper.unmount()

    // A fresh mount re-fetches from the backend (the same mocked API session),
    // simulating a page reload after the create above.
    const reloaded = await mountCalendar({ attachTo: document.body })
    expect(reloaded.text()).toContain('Board game night')
    expect(reloaded.text()).toContain('Standup')

    const standup = reloaded
      .findAll('.day-event')
      .find((event) => event.get('strong').text() === 'Standup')
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
      'Tasks',
    ])
    expect(sections[1].text()).toContain('Team Feed')

    const synced = wrapper
      .findAll('.day-event')
      .find((event) => event.text().includes('Imported standup'))
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
              clone({
                events: SEED_EVENTS.map(({ autoScheduled: _autoScheduled, ...event }) => event),
              }),
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
      {
        id: 'far-a',
        title: 'Far A',
        date: '2026-09-10',
        start: '11:00',
        duration: 60,
        calendar: 'work',
      },
      {
        id: 'far-b',
        title: 'Far B',
        date: '2026-09-10',
        start: '11:30',
        duration: 60,
        calendar: 'work',
      },
    ])
    const wrapper = await mountCalendar()

    expect(wrapper.text()).not.toContain('Scheduling conflict')
  })

  it('ignores an all-day event overlapping a timed one', async () => {
    stubEventsOnly([
      {
        id: 'holiday-2',
        title: 'Company Holiday',
        date: '2026-07-25',
        start: '00:00',
        duration: 1440,
        allDay: true,
        calendar: 'holidays',
      },
      {
        id: 'meeting',
        title: 'Team meeting',
        date: '2026-07-25',
        start: '10:00',
        duration: 30,
        calendar: 'work',
      },
    ])
    const wrapper = await mountCalendar()

    expect(wrapper.text()).not.toContain('Scheduling conflict')
  })
})

describe('CalendarView with Google Calendar', () => {
  const googleMount = async (options = {}) => {
    mockCalendarApi({ google: true, ...options })
    resetCalendarsStateForTests()
    return mountCalendar({ attachTo: document.body })
  }

  it('lists the chosen Google calendars in their own section and shows their events', async () => {
    const wrapper = await googleMount()

    const sections = wrapper.findAll('.calendar-sidebar-section')
    expect(sections.map((section) => section.get('.calendar-sidebar-label').text())).toEqual([
      'Calendars',
      'Google Calendar',
      'Tasks',
    ])
    expect(sections[1].text()).toContain('me@example.com')
    expect(sections[1].text()).toContain('Team')
    expect(sections[0].text()).not.toContain('Team')

    const titles = () => wrapper.findAll('.day-event strong').map((el) => el.text())
    expect(titles()).toContain('Dentist')
    expect(wrapper.text()).toContain('Team offsite')
    const dentist = wrapper.findAll('.day-event').find((event) => event.text().includes('Dentist'))
    expect(dentist.attributes('style')).toContain('#9fe1e7')

    await sections[1].get('button').trigger('click')
    expect(titles()).not.toContain('Dentist')
    wrapper.unmount()
  })

  it('requests events in the browser time zone', async () => {
    const wrapper = await googleMount()
    const eventGet = vi
      .mocked(fetch)
      .mock.calls.find(
        ([url, options]) => String(url).startsWith(`${EVENTS_ENDPOINT}?`) && !options?.method,
      )
    expect(new URLSearchParams(String(eventGet[0]).split('?')[1]).get('timeZone')).toBe(
      browserTimeZone(),
    )
    wrapper.unmount()
  })

  it('edits a Google event without repeat controls, within Google calendars, and reloads afterwards', async () => {
    const wrapper = await googleMount()

    const dentist = wrapper.findAll('.day-event').find((event) => event.text().includes('Dentist'))
    await dentist.trigger('click')

    expect(wrapper.text()).toContain('One occurrence of a repeating Google Calendar event.')
    const link = wrapper.get('.new-event-google-note a')
    expect(link.attributes('href')).toBe('https://calendar.google.com/calendar/event?eid=dentist')
    expect(link.attributes('target')).toBe('_blank')
    expect(wrapper.find('select[aria-label="Event repeats"]').exists()).toBe(false)
    const options = wrapper
      .findAll('select[aria-label="Event calendar"] option')
      .map((option) => option.attributes('value'))
    expect(options).toEqual(['google:me@example.com'])
    expect(wrapper.get('.new-event-delete').text()).toBe('Delete')

    const getsBefore = vi
      .mocked(fetch)
      .mock.calls.filter(
        ([url, o]) => String(url).startsWith(`${EVENTS_ENDPOINT}?`) && !o?.method,
      ).length
    await wrapper.get('.new-event-title-input').setValue('Dentist check-up')
    await wrapper.get('.new-event-create').trigger('click')
    await flushPromises()

    const patch = vi
      .mocked(fetch)
      .mock.calls.find(([url, o]) => url === EVENTS_ENDPOINT && o?.method === 'PATCH')
    const body = JSON.parse(patch[1].body)
    expect(body).toMatchObject({
      id: 'google:me@example.com:dentist',
      title: 'Dentist check-up',
      calendar: 'google:me@example.com',
      repeat: 'none',
      repeatUntil: null,
      repeatDays: null,
      timeZone: browserTimeZone(),
    })
    expect(wrapper.find('.new-event-dialog').exists()).toBe(false)
    expect(
      vi
        .mocked(fetch)
        .mock.calls.filter(
          ([url, o]) => String(url).startsWith(`${EVENTS_ENDPOINT}?`) && !o?.method,
        ).length,
    ).toBe(getsBefore + 1)
    expect(wrapper.findAll('.day-event strong').map((el) => el.text())).toContain(
      'Dentist check-up',
    )
    wrapper.unmount()
  })

  it('opens an event on a read-only Google calendar without Save or Delete', async () => {
    const wrapper = await googleMount()

    const offsite = wrapper
      .findAll('.all-day-event')
      .find((el) => el.text().includes('Team offsite'))
    await offsite.trigger('click')

    expect(wrapper.get('.new-event-title-input').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('This Google calendar is read-only in Cookie.')
    expect(wrapper.text()).toContain('Google Calendar event.')
    expect(wrapper.find('.new-event-delete').exists()).toBe(false)
    expect(wrapper.find('.new-event-create').exists()).toBe(false)
    wrapper.unmount()
  })

  it('files a new event on a Google calendar without a repeat rule', async () => {
    const wrapper = await googleMount()

    await wrapper.get('.calendar-sidebar-create').trigger('click')
    await wrapper.get('.new-event-advanced').trigger('click')
    const select = wrapper.get('select[aria-label="Event calendar"]')
    expect(select.findAll('option').map((option) => option.attributes('value'))).toEqual([
      'work',
      'personal',
      'focus',
      'birthdays',
      'holidays',
      'google:me@example.com',
    ])
    expect(wrapper.find('select[aria-label="Event repeats"]').exists()).toBe(true)
    await wrapper.get('select[aria-label="Event repeats"]').setValue('weekly')
    await select.setValue('google:me@example.com')
    expect(wrapper.find('select[aria-label="Event repeats"]').exists()).toBe(false)
    expect(wrapper.text()).toContain(
      'Repeats for Google Calendar events are set in Google Calendar.',
    )

    await wrapper.get('.new-event-title-input').setValue('Coffee')
    await wrapper.get('.new-event-create').trigger('click')
    await flushPromises()

    const post = vi
      .mocked(fetch)
      .mock.calls.find(([url, o]) => url === EVENTS_ENDPOINT && o?.method === 'POST')
    expect(JSON.parse(post[1].body)).toMatchObject({
      title: 'Coffee',
      calendar: 'google:me@example.com',
      repeat: 'none',
      repeatDays: null,
      timeZone: browserTimeZone(),
    })
    expect(wrapper.find('.new-event-dialog').exists()).toBe(false)
    wrapper.unmount()
  })

  it('refetches Google events when the tab comes back after a minute away', async () => {
    const wrapper = await googleMount()
    const eventGets = () =>
      vi
        .mocked(fetch)
        .mock.calls.filter(
          ([url, o]) => String(url).startsWith(`${EVENTS_ENDPOINT}?`) && !o?.method,
        ).length
    const before = eventGets()
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')

    // Too soon: the window just loaded.
    document.dispatchEvent(new Event('visibilitychange'))
    await flushPromises()
    expect(eventGets()).toBe(before)

    vi.setSystemTime(new Date(2026, 6, 24, 10, 32))
    document.dispatchEvent(new Event('visibilitychange'))
    await flushPromises()
    expect(eventGets()).toBe(before + 1)

    visibility.mockRestore()
    wrapper.unmount()
  })

  it('refreshes Google events every few minutes while the tab is visible, sooner after a Google error', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date(2026, 6, 24, 10, 30))
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    try {
      const wrapper = await googleMount()
      const eventGets = () =>
        vi
          .mocked(fetch)
          .mock.calls.filter(
            ([url, o]) => String(url).startsWith(`${EVENTS_ENDPOINT}?`) && !o?.method,
          ).length
      const before = eventGets()

      // Advancing the interval also advances the fake clock by the minute.
      vi.setSystemTime(new Date(2026, 6, 24, 10, 33))
      vi.advanceTimersByTime(60_000)
      await flushPromises()
      expect(eventGets()).toBe(before)

      vi.setSystemTime(new Date(2026, 6, 24, 10, 35))
      vi.advanceTimersByTime(60_000)
      await flushPromises()
      expect(eventGets()).toBe(before + 1)
      wrapper.unmount()

      const failing = await googleMount({
        googleError: 'Google Calendar events could not be loaded.',
      })
      const failingBefore = eventGets()
      vi.setSystemTime(new Date(2026, 6, 24, 10, 37))
      vi.advanceTimersByTime(60_000)
      await flushPromises()
      expect(eventGets()).toBe(failingBefore + 1)
      failing.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('leaves a window of stored events alone when the tab comes back', async () => {
    const wrapper = await mountCalendar({ attachTo: document.body })
    const before = vi.mocked(fetch).mock.calls.length
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    vi.setSystemTime(new Date(2026, 6, 24, 10, 35))
    document.dispatchEvent(new Event('visibilitychange'))
    await flushPromises()
    expect(vi.mocked(fetch).mock.calls.length).toBe(before)
    wrapper.unmount()
  })

  it('mentions a Google loading problem once while the stored events still show', async () => {
    const store = useInboxStore()
    const wrapper = await googleMount({
      googleError: 'Google Calendar events could not be loaded.',
    })

    expect(wrapper.findAll('.day-event strong').map((el) => el.text())).toContain('Standup')
    expect(store.notify).toHaveBeenCalledWith(
      'Google Calendar events could not be loaded.',
      'error',
    )
    const before = vi.mocked(store.notify).mock.calls.length

    // Leaving the loaded window refetches; the same message is not repeated.
    await wrapper.get('.calendar-view-tabs button:nth-child(3)').trigger('click')
    for (let i = 0; i < 6; i += 1) {
      await wrapper.get('[aria-label="Next period"]').trigger('click')
    }
    await flushPromises()
    expect(vi.mocked(store.notify).mock.calls.length).toBe(before)
    wrapper.unmount()
  })
})
