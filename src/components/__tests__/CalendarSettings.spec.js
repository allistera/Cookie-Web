import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CalendarSettings from '../CalendarSettings.vue'
import { useInboxStore } from '../../stores/inbox'
import { resetCalendarsStateForTests } from '../../composables/useCalendars'
import { NAVIGATE_TO } from '../../lib/externalNavigation'

import { CALENDAR_API_URL } from '../../lib/apiWorkers'

// jsdom cannot navigate; the Google consent trip is observed through the
// injected navigation seam.
const navigateTo = vi.fn()

const ENDPOINT = `${CALENDAR_API_URL}/calendars`
const GOOGLE_ENDPOINT = `${CALENDAR_API_URL}/google-calendar`
const clone = (value) => JSON.parse(JSON.stringify(value))

const GOOGLE_CALENDARS = [
  {
    id: 'me@example.com',
    name: 'me@example.com',
    color: '#9fe1e7',
    primary: true,
    readOnly: false,
  },
  {
    id: 'team@group.calendar.google.com',
    name: 'Team',
    color: '#f6bf26',
    primary: false,
    readOnly: true,
  },
]

// `google` shapes GET /google-calendar: `false` for an unconfigured deployment,
// otherwise the connection state the fixture starts in.
function mockCalendarApi({ google = { connected: false } } = {}) {
  let calendars = [
    { id: 'work', name: 'Work', color: '#4f7c6b' },
    { id: 'birthdays', name: 'Birthdays', color: '#d8953b' },
  ]
  let nextId = 1
  const connection = google
    ? { connected: false, email: null, needsReauth: false, selected: [], ...google }
    : null
  const googleStatus = () => ({
    configured: true,
    connected: connection.connected,
    email: connection.email,
    needsReauth: connection.needsReauth,
    calendars: GOOGLE_CALENDARS.map((calendar) => ({
      ...calendar,
      selected: connection.selected.includes(calendar.id),
    })),
  })

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, options = {}) => {
      const method = options.method || 'GET'
      const body = options.body ? JSON.parse(options.body) : {}
      if (url === GOOGLE_ENDPOINT) {
        if (!connection)
          return { ok: true, json: async () => ({ configured: false, connected: false }) }
        if (method === 'GET') {
          return {
            ok: true,
            json: async () =>
              connection.connected ? googleStatus() : { configured: true, connected: false },
          }
        }
        if (method === 'POST' && body.action === 'authorize') {
          return {
            ok: true,
            json: async () => ({ url: 'https://accounts.google.com/o/oauth2/v2/auth?state=s1' }),
          }
        }
        if (method === 'PATCH') {
          connection.selected = body.calendarIds
          return { ok: true, json: async () => ({ calendars: googleStatus().calendars }) }
        }
        if (method === 'DELETE') {
          connection.connected = false
          connection.selected = []
          return { ok: true, json: async () => ({ ok: true }) }
        }
        throw new Error(`Unexpected fetch: ${method} ${url}`)
      }
      if (url !== ENDPOINT) throw new Error(`Unexpected fetch: ${method} ${url}`)

      if (method === 'GET') return { ok: true, json: async () => clone({ calendars }) }
      if (method === 'POST' && body.action === 'sync') {
        const calendar = calendars.find((item) => item.id === body.id)
        calendar.subscriptionSyncedAt = '2026-08-13T11:00:00.000Z'
        calendar.subscriptionError = null
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
        const calendar = { id: `generated-${nextId++}`, ...body }
        if (calendar.subscriptionUrl) {
          calendar.subscriptionSyncedAt = '2026-08-13T10:00:00.000Z'
          calendar.subscriptionError = null
        }
        calendars = [...calendars, calendar]
        return { ok: true, json: async () => clone({ calendar }) }
      }
      if (method === 'PATCH') {
        const index = calendars.findIndex((calendar) => calendar.id === body.id)
        calendars[index] = { ...calendars[index], name: body.name }
        return { ok: true, json: async () => clone({ calendar: calendars[index] }) }
      }
      if (method === 'DELETE') {
        if (body.id === 'work') {
          return {
            ok: false,
            status: 409,
            json: async () => ({ error: 'This calendar has 2 events. Delete or move them first.' }),
          }
        }
        calendars = calendars.filter((calendar) => calendar.id !== body.id)
        return { ok: true, json: async () => ({ ok: true }) }
      }

      throw new Error(`Unexpected fetch: ${method} ${url}`)
    }),
  )
}

async function mountManager() {
  const wrapper = mount(CalendarSettings, { global: { provide: { [NAVIGATE_TO]: navigateTo } } })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  setActivePinia(createPinia())
  const store = useInboxStore()
  vi.spyOn(store, 'authHeaders').mockResolvedValue({})
  vi.spyOn(store, 'notify').mockImplementation(() => {})
  mockCalendarApi()
  resetCalendarsStateForTests()
})

describe('CalendarSettings', () => {
  it('lists calendars and creates calendars and subscriptions', async () => {
    const wrapper = await mountManager()

    expect(wrapper.get('#your-calendars-heading').text()).toBe('Your calendars')
    expect(wrapper.text()).toContain('Work')
    expect(wrapper.text()).toContain('No calendar subscriptions yet.')

    await wrapper.get('button:nth-of-type(1)').trigger('click')
    await wrapper.get('input[aria-label="New calendar name"]').setValue('Trips')
    await wrapper.get('.calendar-settings-create').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('Trips')

    const addSubscription = wrapper
      .findAll('button')
      .find((button) => button.text().includes('Add subscription'))
    await addSubscription.trigger('click')
    await wrapper.get('input[aria-label="New calendar name"]').setValue('Team Feed')
    await wrapper
      .get('input[aria-label="Calendar subscription URL"]')
      .setValue('https://example.com/team.ics')
    await wrapper.get('.calendar-settings-create').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('Team Feed')
    expect(wrapper.text()).toContain('https://example.com/team.ics')
    const createCall = vi
      .mocked(fetch)
      .mock.calls.find(
        ([, options]) =>
          options?.method === 'POST' &&
          JSON.parse(options.body).subscriptionUrl === 'https://example.com/team.ics',
      )
    expect(createCall).toBeTruthy()

    await wrapper.get('button[aria-label="Sync Team Feed"]').trigger('click')
    await flushPromises()
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(
          ([, options]) => options?.method === 'POST' && JSON.parse(options.body).action === 'sync',
        ),
    ).toBe(true)
  })

  it('renames calendars and requires confirmation before deleting', async () => {
    const wrapper = await mountManager()

    await wrapper.get('button[aria-label="Edit Birthdays"]').trigger('click')
    await wrapper.get('input[aria-label="Rename Birthdays"]').setValue('Important dates')
    await wrapper.get('.calendar-settings-edit').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('Important dates')

    await wrapper.get('button[aria-label="Edit Important dates"]').trigger('click')
    await wrapper.get('button[aria-label="Delete Important dates"]').trigger('click')
    expect(wrapper.find('input[aria-label="Rename Important dates"]').exists()).toBe(true)
    await wrapper.get('button[aria-label="Confirm delete Important dates"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).not.toContain('Important dates')
  })

  it('keeps a calendar with events and shows the backend error', async () => {
    const wrapper = await mountManager()
    const store = useInboxStore()

    await wrapper.get('button[aria-label="Edit Work"]').trigger('click')
    await wrapper.get('button[aria-label="Delete Work"]').trigger('click')
    await wrapper.get('button[aria-label="Confirm delete Work"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('has 2 events')
    expect(wrapper.find('input[aria-label="Rename Work"]').exists()).toBe(true)
    expect(store.notify).toHaveBeenCalledWith(expect.stringContaining('has 2 events'), 'error')
  })
})

describe('CalendarSettings Google Calendar', () => {
  const googleCalls = (method) =>
    vi
      .mocked(fetch)
      .mock.calls.filter(
        ([url, options]) => url === GOOGLE_ENDPOINT && (options?.method || 'GET') === method,
      )

  it('offers to connect and sends the browser to the consent URL the Worker issues', async () => {
    const wrapper = await mountManager()

    expect(wrapper.get('#google-calendar-heading').text()).toBe('Google Calendar')
    expect(wrapper.text()).toContain('No Google account connected.')
    const connect = wrapper
      .findAll('button')
      .find((button) => button.text() === 'Connect Google Calendar')
    await connect.trigger('click')
    await flushPromises()

    const [, options] = googleCalls('POST')[0]
    expect(JSON.parse(options.body)).toEqual({
      action: 'authorize',
      returnTo: `${window.location.origin}/settings/calendar`,
    })
    expect(navigateTo).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth?state=s1')
    // Still "busy": the page is leaving.
    expect(connect.attributes('disabled')).toBeDefined()
  })

  it('explains when the deployment has no Google integration', async () => {
    mockCalendarApi({ google: false })
    const wrapper = await mountManager()
    expect(wrapper.text()).toContain('Google Calendar is not set up on this Cookie deployment.')
    expect(
      wrapper.findAll('button').some((button) => button.text() === 'Connect Google Calendar'),
    ).toBe(false)
  })

  it("lists the connected account's calendars and saves which ones to show", async () => {
    mockCalendarApi({
      google: { connected: true, email: 'me@example.com', selected: ['me@example.com'] },
    })
    const wrapper = await mountManager()

    expect(wrapper.text()).toContain('me@example.com')
    const personal = wrapper.get('input[aria-label="Show me@example.com in Cookie"]')
    const team = wrapper.get('input[aria-label="Show Team in Cookie"]')
    expect(personal.element.checked).toBe(true)
    expect(team.element.checked).toBe(false)
    expect(wrapper.text()).toContain('Primary · Editable')
    expect(wrapper.text()).toContain('Read-only')

    const calendarGetsBefore = vi
      .mocked(fetch)
      .mock.calls.filter(([url]) => url === ENDPOINT).length
    await team.setValue(true)
    await flushPromises()

    expect(JSON.parse(googleCalls('PATCH')[0][1].body)).toEqual({
      calendarIds: ['me@example.com', 'team@group.calendar.google.com'],
    })
    expect(wrapper.get('input[aria-label="Show Team in Cookie"]').element.checked).toBe(true)
    // The shared calendar list is refreshed so the Calendar sidebar follows.
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === ENDPOINT).length).toBe(
      calendarGetsBefore + 1,
    )

    await wrapper.get('input[aria-label="Show me@example.com in Cookie"]').setValue(false)
    await flushPromises()
    expect(JSON.parse(googleCalls('PATCH')[1][1].body)).toEqual({
      calendarIds: ['team@group.calendar.google.com'],
    })
  })

  it('says so when the selection saved but the shared calendar list could not be refreshed', async () => {
    mockCalendarApi({ google: { connected: true, email: 'me@example.com', selected: [] } })
    const wrapper = await mountManager()
    const original = globalThis.fetch
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, options = {}) =>
        url === ENDPOINT && !options.method
          ? { ok: false, status: 503, json: async () => ({ error: 'down' }) }
          : original(url, options),
      ),
    )

    await wrapper.get('input[aria-label="Show Team in Cookie"]').setValue(true)
    await flushPromises()

    expect(wrapper.get('input[aria-label="Show Team in Cookie"]').element.checked).toBe(true)
    expect(wrapper.get('[role="alert"]').text()).toContain(
      'Saved, but the calendar list could not be refreshed',
    )
  })

  it('reverts a tick the Worker refused and shows the problem', async () => {
    mockCalendarApi({ google: { connected: true, email: 'me@example.com', selected: [] } })
    const wrapper = await mountManager()
    const original = globalThis.fetch
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, options = {}) =>
        url === GOOGLE_ENDPOINT && options.method === 'PATCH'
          ? {
              ok: false,
              status: 502,
              json: async () => ({ error: 'Google Calendar request failed' }),
            }
          : original(url, options),
      ),
    )

    await wrapper.get('input[aria-label="Show Team in Cookie"]').setValue(true)
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('could not be saved')
    expect(wrapper.get('input[aria-label="Show Team in Cookie"]').element.checked).toBe(false)
  })

  it('offers to reconnect an expired grant and locks the selection meanwhile', async () => {
    mockCalendarApi({
      google: {
        connected: true,
        email: 'me@example.com',
        needsReauth: true,
        selected: ['me@example.com'],
      },
    })
    const wrapper = await mountManager()

    expect(wrapper.text()).toContain('Access has expired')
    expect(
      wrapper.get('input[aria-label="Show Team in Cookie"]').attributes('disabled'),
    ).toBeDefined()
    const reconnect = wrapper.findAll('button').find((button) => button.text() === 'Reconnect')
    await reconnect.trigger('click')
    await flushPromises()
    expect(navigateTo).toHaveBeenCalled()
  })

  it('disconnects only after confirmation', async () => {
    mockCalendarApi({ google: { connected: true, email: 'me@example.com', selected: [] } })
    const wrapper = await mountManager()

    const disconnect = wrapper.findAll('button').find((button) => button.text() === 'Disconnect')
    await disconnect.trigger('click')
    expect(googleCalls('DELETE')).toHaveLength(0)
    const keep = wrapper.findAll('button').find((button) => button.text() === 'Keep')
    await keep.trigger('click')
    expect(wrapper.findAll('button').some((button) => button.text() === 'Confirm disconnect')).toBe(
      false,
    )

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Disconnect')
      .trigger('click')
    const confirm = wrapper
      .findAll('button')
      .find((button) => button.text() === 'Confirm disconnect')
    await confirm.trigger('click')
    await flushPromises()

    expect(googleCalls('DELETE')).toHaveLength(1)
    expect(wrapper.text()).toContain('No Google account connected.')
  })

  it('reports the outcome Google sent back and clears it from the URL', async () => {
    const store = useInboxStore()
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/settings/:section?', name: 'settings', component: CalendarSettings }],
    })
    await router.push('/settings/calendar?google=error&reason=denied&tab=x')
    await router.isReady()
    const wrapper = mount(CalendarSettings, {
      global: { plugins: [router], provide: { [NAVIGATE_TO]: navigateTo } },
    })
    await flushPromises()

    expect(store.notify).toHaveBeenCalledWith('Google sign-in was cancelled.', 'error')
    expect(router.currentRoute.value.query).toEqual({ tab: 'x' })
    wrapper.unmount()

    await router.push('/settings/calendar?google=connected')
    const connected = mount(CalendarSettings, {
      global: { plugins: [router], provide: { [NAVIGATE_TO]: navigateTo } },
    })
    await flushPromises()
    expect(store.notify).toHaveBeenCalledWith(
      expect.stringContaining('Google Calendar connected'),
      'info',
    )
    expect(router.currentRoute.value.query).toEqual({})
    connected.unmount()
  })
})
