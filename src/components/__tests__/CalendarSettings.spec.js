import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CalendarSettings from '../CalendarSettings.vue'
import { useInboxStore } from '../../stores/inbox'

const ENDPOINT = '/api/calendar-events?resource=calendars'
const clone = (value) => JSON.parse(JSON.stringify(value))

function mockCalendarApi() {
  let calendars = [
    { id: 'work', name: 'Work', color: '#4f7c6b' },
    { id: 'birthdays', name: 'Birthdays', color: '#d8953b' },
  ]
  let nextId = 1

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, options = {}) => {
      const method = options.method || 'GET'
      const body = options.body ? JSON.parse(options.body) : {}
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
  const wrapper = mount(CalendarSettings)
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
