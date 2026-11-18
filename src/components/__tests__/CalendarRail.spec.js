import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import CalendarRail from '../CalendarRail.vue'
import { calendarEventsUrl, useCalendars } from '../../composables/useCalendars'
import { useInboxStore } from '../../stores/inbox'
import { useTaskItemsStore } from '../../stores/taskItems'
import { CALENDAR_API_URL, TASKS_API_URL } from '../../lib/apiWorkers'

const CALENDARS_ENDPOINT = `${CALENDAR_API_URL}/calendars`
const TODAY = '2026-11-03'
const EVENTS = {
  [TODAY]: [
    {
      id: 'standup',
      title: 'Standup',
      date: TODAY,
      start: '09:30',
      duration: 15,
      calendar: 'work',
    },
    {
      id: 'call',
      title: 'Call with Rachel',
      date: TODAY,
      start: '15:00',
      duration: 30,
      calendar: 'work',
      location: 'https://zoom.us/j/123 or javascript:alert(1)',
    },
    {
      id: 'review',
      title: 'Code review',
      date: TODAY,
      start: '15:00',
      duration: 45,
      calendar: 'work',
    },
    {
      id: 'bins',
      title: 'Bin collection',
      date: TODAY,
      start: '00:00',
      duration: 1440,
      allDay: true,
      calendar: 'home',
    },
  ],
  '2026-11-04': [
    {
      id: 'dentist',
      title: 'Dentist',
      date: '2026-11-04',
      start: '11:15',
      duration: 30,
      calendar: 'home',
    },
  ],
}

// The day's tasks window: from the day before, for a task that runs past
// midnight, with done tasks included.
const tasksUrl = (day, dayBefore) =>
  `${TASKS_API_URL}/task-items?view=calendar&from=${dayBefore}&to=${day}&completed=1`
const TODAY_TASKS_URL = tasksUrl(TODAY, '2026-11-02')
const TASKS = [
  { id: 'rent', content: 'Pay rent', dueDate: TODAY, projectId: 'home-project' },
  { id: 'post', content: 'Post parcel', dueDate: TODAY, completedAt: '2026-11-03T09:00:00Z' },
  { id: 'call', content: 'Ring the bank', dueDate: TODAY, dueTime: '14:00' },
]

let router
let wrapper
// What the tasks Worker answers; no tasks unless a test sets some.
let taskItems

function mockApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      if (url === CALENDARS_ENDPOINT) {
        return {
          ok: true,
          json: async () => ({
            calendars: [
              { id: 'work', name: 'Work', color: '#4cb782' },
              { id: 'home', name: 'Home', color: '#d9822b' },
            ],
          }),
        }
      }
      if (String(url).startsWith(`${TASKS_API_URL}/task-items`)) {
        return { ok: true, json: async () => ({ items: taskItems }) }
      }
      for (const [day, events] of Object.entries(EVENTS)) {
        if (url === calendarEventsUrl(day, day)) return { ok: true, json: async () => ({ events }) }
      }
      return { ok: true, json: async () => ({ events: [] }) }
    }),
  )
}

async function render(props = {}) {
  wrapper = mount(CalendarRail, { props, global: { plugins: [router] }, attachTo: document.body })
  await flushPromises()
  return wrapper
}

beforeEach(async () => {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/inbox', component: { template: '<div />' } },
      { path: '/calendar', name: 'calendar', component: { template: '<div />' } },
      { path: '/tasks', name: 'tasks', component: { template: '<div />' } },
    ],
  })
  await router.push('/inbox')
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date(2026, 10, 3, 13, 47))
  setActivePinia(createPinia())
  vi.spyOn(useInboxStore(), 'authHeaders').mockResolvedValue({})
  // useCalendars' list is module-level and loads once; seed it directly.
  useCalendars(vi.fn(), vi.fn()).calendars.value = [
    { id: 'work', name: 'Work', color: '#4cb782' },
    { id: 'home', name: 'Home', color: '#d9822b' },
  ]
  taskItems = []
  mockApi()
})

afterEach(() => {
  wrapper?.unmount()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('CalendarRail', () => {
  it("opens on today and shows the day's all-day and timed events", async () => {
    await render()

    expect(fetch).toHaveBeenCalledWith(calendarEventsUrl(TODAY, TODAY), { headers: {} })
    expect(wrapper.get('.cr-title').text()).toContain('Today')
    expect(wrapper.get('.cr-all-day-chip').text()).toBe('Bin collection')
    expect(wrapper.findAll('.cr-event').map((e) => e.find('strong').text())).toEqual([
      'Standup',
      'Code review',
      'Call with Rachel',
    ])
    expect(wrapper.find('.cr-now').exists()).toBe(true)
    expect(wrapper.get('.cr-day.selected').text()).toBe('3')
  })

  it('fades past events and puts overlapping events side by side', async () => {
    await render()
    const [standup, review, call] = wrapper.findAll('.cr-event')

    expect(standup.classes()).toContain('past')
    expect(call.classes()).not.toContain('past')
    // jsdom simplifies calc(): half the lane width each (minus the 2px gap),
    // in different lanes; the standup has the whole lane to itself.
    expect(review.element.style.width).toBe('calc(50% - 24px)')
    expect(call.element.style.width).toBe('calc(50% - 24px)')
    expect(review.element.style.left).not.toEqual(call.element.style.left)
    expect(standup.element.style.width).toBe('calc(100% - 46px)')
  })

  it('shows the next event with a countdown and a safe Join link', async () => {
    await render()
    const upNext = wrapper.get('.cr-up-next')

    expect(upNext.text()).toContain('Up next · in 1 hr 13 min')
    expect(upNext.text()).toContain('Code review')
    // The first event at 15:00 by sort order has no link; Rachel's call does.
    await wrapper.findAll('.cr-event')[2].trigger('click')
    const join = wrapper.get('.cr-details .cr-join')
    expect(join.attributes('href')).toBe('https://zoom.us/j/123')
    expect(join.attributes('rel')).toContain('noopener')
  })

  it('opens read-only details with a link to the event in Calendar', async () => {
    await render()
    await wrapper.findAll('.cr-event')[0].trigger('click')

    const details = wrapper.get('.cr-details')
    expect(details.text()).toContain('Standup')
    expect(details.text()).toContain('Work')
    await details.get('.cr-secondary').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ date: TODAY, event: 'standup' })
  })

  it('moves between days and back to today', async () => {
    await render()
    await wrapper.get('[aria-label="Next day"]').trigger('click')
    await flushPromises()

    expect(fetch).toHaveBeenCalledWith(calendarEventsUrl('2026-11-04', '2026-11-04'), {
      headers: {},
    })
    expect(wrapper.get('.cr-title').text()).not.toContain('Today')
    expect(wrapper.find('.cr-up-next').exists()).toBe(false)
    expect(wrapper.find('.cr-now').exists()).toBe(false)
    expect(wrapper.get('.cr-event').text()).toContain('Dentist')

    await wrapper.get('.cr-today').trigger('click')
    await flushPromises()
    expect(wrapper.get('.cr-title').text()).toContain('Today')
  })

  it('picks a day from the mini month', async () => {
    await render()
    const day = wrapper
      .findAll('.cr-day')
      .find((d) => d.text() === '4' && !d.classes('out-of-month'))
    await day.trigger('click')
    await flushPromises()

    expect(wrapper.get('.cr-day.selected').text()).toBe('4')
    expect(wrapper.get('.cr-event').text()).toContain('Dentist')
  })

  it('follows a pinned day such as an open daily note', async () => {
    await render({ date: new Date(2026, 10, 4) })

    expect(fetch).toHaveBeenCalledWith(calendarEventsUrl('2026-11-04', '2026-11-04'), {
      headers: {},
    })
    await wrapper.setProps({ date: new Date(2026, 10, 3) })
    await flushPromises()
    expect(wrapper.get('.cr-title').text()).toContain('Today')
  })

  it('says so when the events cannot be loaded', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    fetch.mockImplementation(async (url) =>
      url === CALENDARS_ENDPOINT
        ? { ok: true, json: async () => ({ calendars: [] }) }
        : { ok: false, status: 503, json: async () => ({}) },
    )
    await render()

    expect(wrapper.get('.cr-note').text()).toContain("Couldn't load")
    expect(wrapper.findAll('.cr-event')).toHaveLength(0)
  })

  it("shows the day's tasks among the events, done ones struck through", async () => {
    taskItems = TASKS
    await render()

    expect(fetch).toHaveBeenCalledWith(TODAY_TASKS_URL, { headers: {} })
    const chips = wrapper.findAll('.cr-all-day-chip')
    expect(chips.map((chip) => chip.get('.cr-chip-title').text())).toEqual([
      'Bin collection',
      'Pay rent',
      'Post parcel',
    ])
    expect(chips[0].classes()).not.toContain('task')
    expect(chips[1].classes()).toContain('task')
    expect(chips[1].classes()).not.toContain('done')
    expect(chips[1].get('.cr-task-icon').text()).toBe('check_box_outline_blank')
    expect(chips[2].classes()).toContain('done')
    expect(chips[2].get('.cr-task-icon').text()).toBe('check_box')
    expect(chips[2].text()).toContain('(done)')

    const timed = wrapper.findAll('.cr-event')
    expect(timed.map((item) => item.find('strong').text())).toEqual([
      'Standup',
      'check_box_outline_blankRing the bank',
      'Code review',
      'Call with Rachel',
    ])
    expect(timed[1].classes()).toContain('task')
  })

  it('keeps a task with a due time out of Up next', async () => {
    taskItems = TASKS
    await render()

    // Ring the bank is due at 14:00, before the 15:00 events.
    expect(wrapper.get('.cr-up-next').text()).toContain('Code review')
  })

  it('opens a task in Tasks from its details', async () => {
    taskItems = TASKS
    await render()
    await wrapper.findAll('.cr-all-day-chip')[1].trigger('click')

    const details = wrapper.get('.cr-details')
    expect(details.attributes('aria-label')).toBe('Task details')
    expect(details.text()).toContain('Pay rent')
    expect(details.text()).toContain('Tasks')
    expect(details.text()).toContain('To do')
    expect(details.get('.cr-secondary').text()).toBe('Open task')
    await details.get('.cr-secondary').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/tasks')
    expect(router.currentRoute.value.query).toEqual({ project: 'home-project', task: 'rent' })
  })

  it("shows the rest of a task that ran past the day before's midnight", async () => {
    taskItems = [
      {
        id: 'deploy',
        content: 'Overnight deploy',
        dueDate: '2026-11-02',
        dueTime: '23:30',
        durationMinutes: 90,
      },
    ]
    await render()

    const remainder = wrapper.findAll('.cr-event').find((item) => item.classes('task'))
    expect(remainder.text()).toContain('Overnight deploy')
    // Midnight to 01:00 on a 48px hour, less the 2px gap.
    expect(remainder.element.style.top).toBe('0px')
    expect(remainder.element.style.height).toBe('46px')
  })

  it('keeps the events when the tasks cannot be loaded', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const answer = fetch.getMockImplementation()
    fetch.mockImplementation(async (url) =>
      String(url).startsWith(TASKS_API_URL)
        ? { ok: false, status: 503, json: async () => ({}) }
        : answer(url),
    )
    await render()

    expect(wrapper.find('.cr-note').exists()).toBe(false)
    expect(wrapper.findAll('.cr-event')).toHaveLength(3)
    expect(wrapper.findAll('.cr-event.task')).toHaveLength(0)
  })

  it('reads the tasks again when one is changed elsewhere on the page', async () => {
    await render()
    expect(wrapper.findAll('.cr-all-day-chip')).toHaveLength(1)
    const eventRequests = fetch.mock.calls.filter(
      ([url]) => url === calendarEventsUrl(TODAY, TODAY),
    ).length

    taskItems = TASKS
    useTaskItemsStore().invalidateHistory()
    await flushPromises()

    expect(wrapper.findAll('.cr-all-day-chip')).toHaveLength(3)
    // Only the tasks are fetched again.
    expect(
      fetch.mock.calls.filter(([url]) => url === calendarEventsUrl(TODAY, TODAY)),
    ).toHaveLength(eventRequests)
  })

  it('asks to close from its close button', async () => {
    await render()
    await wrapper.get('[aria-label="Hide calendar sidebar"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  // Returning to the tab fires both events; one fetch of the day is enough.
  it('refreshes once when the tab becomes visible and focused together', async () => {
    await render()
    const dayRequests = () =>
      fetch.mock.calls.filter(([url]) => url === calendarEventsUrl(TODAY, TODAY)).length
    const before = dayRequests()

    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('focus'))
    await flushPromises()
    expect(dayRequests()).toBe(before + 1)

    // A later return refreshes again.
    window.dispatchEvent(new Event('focus'))
    await flushPromises()
    expect(dayRequests()).toBe(before + 2)
  })
})
