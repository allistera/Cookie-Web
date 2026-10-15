import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import TodoistSettings from '../TodoistSettings.vue'
import { setAuth0Client } from '../../auth0-client'
import { useProjectsStore } from '../../stores/projects'
import { useTaskItemsStore } from '../../stores/taskItems'
import { useTaskLabelsStore } from '../../stores/taskLabels'
import { useTodoistStore } from '../../stores/todoist'

const disconnected = {
  configured: true,
  connected: false,
  enabled: false,
  email: null,
  tokenHint: '',
  timeZone: null,
  lastSyncedAt: null,
  lastSyncStatus: null,
  lastSyncError: null,
  lastSyncSummary: null,
}

const connected = {
  ...disconnected,
  connected: true,
  enabled: true,
  email: 'person@example.com',
  tokenHint: '1234',
  timeZone: 'Europe/London',
}

const synced = {
  ...connected,
  lastSyncedAt: '2026-10-15T08:00:00.000Z',
  lastSyncStatus: 'ok',
  lastSyncSummary: { projects: 2, sections: 1, tasks: 14, completed: 1, removed: 0, skipped: 0 },
}

function jsonResponse(body, status = 200) {
  return { ok: status < 400, status, json: async () => body }
}

// Every call the component makes goes to /tasks/todoist[...]; the stub
// answers by method and path so a test reads as the sequence it drives.
function stubFetch(handlers) {
  const calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init = {}) => {
      const method = init.method ?? 'GET'
      const path = new URL(url).pathname
      calls.push({ method, path, body: init.body ? JSON.parse(init.body) : undefined })
      const handler = handlers[`${method} ${path}`]
      if (!handler) throw new Error(`Unexpected ${method} ${path}`)
      return handler(calls.at(-1))
    }),
  )
  return calls
}

describe('TodoistSettings', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    setAuth0Client(null)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('explains when the deployment has no Todoist support', async () => {
    stubFetch({
      'GET /tasks/todoist': () => jsonResponse({ todoist: { ...disconnected, configured: false } }),
    })
    const wrapper = mount(TodoistSettings)
    await flushPromises()
    expect(wrapper.text()).toContain('not set up on this Cookie deployment')
    expect(wrapper.find('[aria-label="Todoist API token"]').exists()).toBe(false)
  })

  it('offers a retry after a failed load', async () => {
    const calls = stubFetch({
      'GET /tasks/todoist': ({ method }) =>
        calls.filter((call) => call.method === method).length === 1
          ? jsonResponse({ error: 'down' }, 500)
          : jsonResponse({ todoist: disconnected }),
    })
    const wrapper = mount(TodoistSettings)
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Could not load')
    await wrapper.get('[data-testid="retry-todoist-settings"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[aria-label="Todoist API token"]').exists()).toBe(true)
  })

  it('connects with a token, then syncs straight away and shows the summary', async () => {
    const calls = stubFetch({
      'GET /tasks/todoist': () => jsonResponse({ todoist: disconnected }),
      'PUT /tasks/todoist': () => jsonResponse({ todoist: connected }),
      'POST /tasks/todoist/sync': () => jsonResponse({ todoist: synced }),
      'GET /projects': () => jsonResponse({ projects: [] }),
      'GET /task-labels': () => jsonResponse({ labels: [] }),
    })
    const wrapper = mount(TodoistSettings)
    await flushPromises()

    const submit = wrapper.get('button[type="submit"]')
    expect(submit.attributes('disabled')).toBeDefined()
    await wrapper.get('[aria-label="Todoist API token"]').setValue('  abc 123 ')
    expect(submit.attributes('disabled')).toBeDefined()
    await wrapper.get('[aria-label="Todoist API token"]').setValue(' abcdef1234 ')
    expect(submit.attributes('disabled')).toBeUndefined()
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(calls.map(({ method, path }) => `${method} ${path}`)).toEqual([
      'GET /tasks/todoist',
      'PUT /tasks/todoist',
      'POST /tasks/todoist/sync',
      'GET /projects',
      'GET /task-labels',
    ])
    expect(calls[1].body).toEqual({ token: 'abcdef1234' })
    expect(wrapper.find('form').exists()).toBe(false)
    expect(wrapper.text()).toContain('person@example.com')
    expect(wrapper.text()).toContain('Token ending in 1234')
    expect(wrapper.get('[aria-label="Sync every hour"]').element.checked).toBe(true)
    expect(wrapper.get('.todoist-status').text()).toContain(
      '2 projects, 1 section, 14 open tasks (1 completed).',
    )
    expect(useProjectsStore().isLoaded).toBe(true)
    expect(useTaskLabelsStore().isLoaded).toBe(true)
  })

  it('reports a rejected token and keeps the form', async () => {
    stubFetch({
      'GET /tasks/todoist': () => jsonResponse({ todoist: disconnected }),
      'PUT /tasks/todoist': () => jsonResponse({ error: 'Todoist rejected that token' }, 400),
    })
    const wrapper = mount(TodoistSettings)
    await flushPromises()
    await wrapper.get('[aria-label="Todoist API token"]').setValue('nope1234')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.find('form').exists()).toBe(true)
    expect(useTodoistStore().settings.connected).toBe(false)
  })

  it('flips the hourly schedule, syncs now and reloads the open task list', async () => {
    const items = useTaskItemsStore()
    items.loadedProject = 'inbox'
    const calls = stubFetch({
      'GET /tasks/todoist': () => jsonResponse({ todoist: synced }),
      'PUT /tasks/todoist': ({ body }) => jsonResponse({ todoist: { ...synced, ...body } }),
      'POST /tasks/todoist/sync': () => jsonResponse({ todoist: synced }),
      'GET /projects': () => jsonResponse({ projects: [] }),
      'GET /task-labels': () => jsonResponse({ labels: [] }),
      'GET /task-items': () => jsonResponse({ items: [], nextCursor: null }),
    })
    const wrapper = mount(TodoistSettings)
    await flushPromises()

    await wrapper.get('[aria-label="Sync every hour"]').setValue(false)
    await flushPromises()
    expect(calls[1]).toMatchObject({ method: 'PUT', body: { enabled: false } })
    expect(useTodoistStore().settings.enabled).toBe(false)

    await wrapper.get('[data-testid="todoist-sync-now"]').trigger('click')
    await flushPromises()
    expect(calls.map(({ method, path }) => `${method} ${path}`).slice(2)).toEqual([
      'POST /tasks/todoist/sync',
      'GET /projects',
      'GET /task-labels',
      'GET /task-items',
    ])
    expect(wrapper.get('.todoist-status').text()).toContain('Last synced')
  })

  it('shows the last failure and disconnects after a confirmation', async () => {
    const calls = stubFetch({
      'GET /tasks/todoist': () =>
        jsonResponse({
          todoist: {
            ...synced,
            lastSyncStatus: 'failed',
            lastSyncError: 'Todoist responded 503.',
          },
        }),
      'DELETE /tasks/todoist': () => jsonResponse({ ok: true }),
    })
    const wrapper = mount(TodoistSettings)
    await flushPromises()
    expect(wrapper.get('.todoist-status').text()).toContain('Last sync failed')
    expect(wrapper.get('.todoist-status').text()).toContain('Todoist responded 503.')

    const disconnect = () =>
      wrapper.findAll('button').find((button) => /disconnect/i.test(button.text()))
    await disconnect().trigger('click')
    expect(disconnect().text()).toBe('Confirm disconnect')
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false)
    await disconnect().trigger('click')
    await flushPromises()
    expect(calls.at(-1)).toMatchObject({ method: 'DELETE', path: '/tasks/todoist' })
    expect(wrapper.find('[aria-label="Todoist API token"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('person@example.com')
  })
})
