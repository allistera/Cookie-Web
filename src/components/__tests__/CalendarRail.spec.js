import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import CalendarRail from '../CalendarRail.vue'
import { calendarEventsUrl, useCalendars } from '../../composables/useCalendars'
import { useInboxStore } from '../../stores/inbox'
import { CALENDAR_API_URL } from '../../lib/apiWorkers'

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

let router
let wrapper

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
    // jsdom normalises calc(): half the lane width each, in different lanes.
    expect(review.attributes('style')).toContain('0.5 * (100% - 44px)')
    expect(call.attributes('style')).toContain('0.5 * (100% - 44px)')
    expect(review.element.style.left).not.toEqual(call.element.style.left)
    expect(standup.attributes('style')).toContain('1 * (100% - 44px)')
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

  it('asks to close from its close button', async () => {
    await render()
    await wrapper.get('[aria-label="Hide calendar sidebar"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
