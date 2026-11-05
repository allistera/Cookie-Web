import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import NtfySettings from '../NtfySettings.vue'
import { setAuth0Client } from '../../auth0-client'
import { NOTIFICATIONS_API_URL } from '../../lib/apiWorkers'
import { useInboxStore } from '../../stores/inbox'

const notSetUp = {
  enabled: false,
  defaultServerUrl: 'https://ntfy.example.com',
  tokensSupported: true,
}

const saved = {
  ...notSetUp,
  enabled: true,
  serverUrl: 'https://ntfy.sh',
  topic: 'my-cookie-mail',
  subscribeUrl: 'https://ntfy.sh/my-cookie-mail',
  tokenHint: '1234',
}

function jsonResponse(body, status = 200) {
  return { ok: status < 400, status, json: async () => body }
}

// Every call the component makes goes to /ntfy[/test]; the stub answers by
// method and path so a test reads as the sequence it drives.
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

// The store loads its settings actions through a dynamic import, which
// flushPromises alone does not always outlast, so wait for the load to land.
async function mountSettings() {
  const wrapper = mount(NtfySettings)
  await flushPromises()
  await vi.waitFor(() => expect(wrapper.text()).not.toContain('Loading…'))
  return wrapper
}

function button(wrapper, text) {
  return wrapper.findAll('button').find((candidate) => candidate.text() === text)
}

describe('NtfySettings', () => {
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    setAuth0Client(null)
    store = useInboxStore()
    store.userId = 'user-1'
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('prefills the default server for a user who has not set ntfy up', async () => {
    stubFetch({ 'GET /ntfy': () => jsonResponse(notSetUp) })
    const wrapper = await mountSettings()

    expect(fetch).toHaveBeenCalledWith(
      `${NOTIFICATIONS_API_URL}/ntfy`,
      expect.objectContaining({ cache: 'no-store' }),
    )
    expect(wrapper.get('[aria-label="ntfy server URL"]').element.value).toBe(
      'https://ntfy.example.com',
    )
    expect(wrapper.get('[aria-label="ntfy topic"]').element.value).toBe('')
    expect(wrapper.get('.ntfy-switch').element.checked).toBe(false)
    expect(wrapper.find('[data-testid="ntfy-subscription"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Enter the server and topic you subscribe to in ntfy')
    // Nothing to save yet, so the primary action waits for a topic.
    expect(button(wrapper, 'Save and turn on').attributes('disabled')).toBeDefined()
  })

  it('saves the server, topic and access token, then shows the subscribe URL', async () => {
    const calls = stubFetch({
      'GET /ntfy': () => jsonResponse(notSetUp),
      'PUT /ntfy': () => jsonResponse(saved),
    })
    const wrapper = await mountSettings()

    await wrapper.get('[aria-label="ntfy server URL"]').setValue(' https://ntfy.sh ')
    await wrapper.get('[aria-label="ntfy topic"]').setValue('my-cookie-mail')
    await wrapper.get('[aria-label="ntfy access token"]').setValue('tk_abcd1234')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(calls.at(-1)).toEqual({
      method: 'PUT',
      path: '/ntfy',
      body: { serverUrl: 'https://ntfy.sh', topic: 'my-cookie-mail', accessToken: 'tk_abcd1234' },
    })
    expect(wrapper.get('.ntfy-switch').element.checked).toBe(true)
    expect(wrapper.get('[data-testid="ntfy-subscription"]').text()).toContain(
      'https://ntfy.sh/my-cookie-mail',
    )
    expect(wrapper.get('[data-testid="ntfy-token-state"]').text()).toContain('Token ending in 1234')
    // The token field is cleared once saved; the token itself never comes back.
    expect(wrapper.get('[aria-label="ntfy access token"]').element.value).toBe('')
    expect(wrapper.text()).not.toContain('tk_abcd1234')
    expect(store.toasts).toEqual(
      expect.arrayContaining([expect.objectContaining({ message: 'ntfy notifications saved.' })]),
    )
  })

  it('keeps the stored token when the field is left blank and removes it on request', async () => {
    const calls = stubFetch({
      'GET /ntfy': () => jsonResponse(saved),
      'PUT /ntfy': ({ body }) =>
        jsonResponse({
          ...saved,
          topic: body.topic,
          subscribeUrl: `${body.serverUrl}/${body.topic}`,
          tokenHint: body.accessToken === null ? '' : saved.tokenHint,
        }),
    })
    const wrapper = await mountSettings()

    await wrapper.get('[aria-label="ntfy topic"]').setValue('renamed-topic')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(calls.at(-1).body).toEqual({ serverUrl: 'https://ntfy.sh', topic: 'renamed-topic' })

    await button(wrapper, 'Remove token').trigger('click')
    expect(wrapper.get('[data-testid="ntfy-token-state"]').text()).toContain('will be removed')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(calls.at(-1).body).toEqual({
      serverUrl: 'https://ntfy.sh',
      topic: 'renamed-topic',
      accessToken: null,
    })
    expect(wrapper.find('[data-testid="ntfy-token-state"]').exists()).toBe(false)
  })

  it('refuses to save an http server or a topic ntfy would reject', async () => {
    stubFetch({ 'GET /ntfy': () => jsonResponse(notSetUp) })
    const wrapper = await mountSettings()

    await wrapper.get('[aria-label="ntfy server URL"]').setValue('http://ntfy.sh')
    await wrapper.get('[aria-label="ntfy topic"]').setValue('fine-topic')
    expect(button(wrapper, 'Save and turn on').attributes('disabled')).toBeDefined()

    await wrapper.get('[aria-label="ntfy server URL"]').setValue('https://ntfy.sh')
    expect(button(wrapper, 'Save and turn on').attributes('disabled')).toBeUndefined()

    await wrapper.get('[aria-label="ntfy topic"]').setValue('has space')
    expect(button(wrapper, 'Save and turn on').attributes('disabled')).toBeDefined()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('generates a hard-to-guess topic on request', async () => {
    stubFetch({ 'GET /ntfy': () => jsonResponse(notSetUp) })
    const wrapper = await mountSettings()

    await button(wrapper, 'Generate').trigger('click')

    expect(wrapper.get('[aria-label="ntfy topic"]').element.value).toMatch(/^cookie-[0-9a-f]{24}$/)
    expect(button(wrapper, 'Save and turn on').attributes('disabled')).toBeUndefined()
  })

  it('explains a topic another account already uses', async () => {
    stubFetch({
      'GET /ntfy': () => jsonResponse(notSetUp),
      'PUT /ntfy': () =>
        jsonResponse({ error: 'topic_taken', message: 'Another Cookie account…' }, 409),
    })
    const wrapper = await mountSettings()

    await wrapper.get('[aria-label="ntfy topic"]').setValue('shared')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toBe(
      'Another Cookie account already uses that topic on this server.',
    )
    expect(wrapper.get('.ntfy-switch').element.checked).toBe(false)
  })

  it('shows the server reason for a rejected server URL', async () => {
    stubFetch({
      'GET /ntfy': () => jsonResponse(notSetUp),
      'PUT /ntfy': () =>
        jsonResponse(
          { error: 'invalid_server_url', message: 'Enter the https:// address of an ntfy server.' },
          400,
        ),
    })
    const wrapper = await mountSettings()

    await wrapper.get('[aria-label="ntfy topic"]').setValue('topic')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toBe(
      'Enter the https:// address of an ntfy server.',
    )
  })

  it('hides the token field when the deployment cannot store tokens', async () => {
    stubFetch({ 'GET /ntfy': () => jsonResponse({ ...notSetUp, tokensSupported: false }) })
    const wrapper = await mountSettings()

    expect(wrapper.find('[aria-label="ntfy access token"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Access tokens are not set up on this Cookie deployment')
  })

  it('pauses from the switch but keeps the settings on screen', async () => {
    stubFetch({
      'GET /ntfy': () => jsonResponse(saved),
      'DELETE /ntfy': () => ({ ok: true, status: 204 }),
    })
    const wrapper = await mountSettings()
    const toggle = wrapper.get('.ntfy-switch')
    expect(toggle.element.checked).toBe(true)

    toggle.element.checked = false
    await toggle.trigger('change')
    await flushPromises()

    expect(fetch).toHaveBeenCalledWith(
      `${NOTIFICATIONS_API_URL}/ntfy`,
      expect.objectContaining({ method: 'DELETE' }),
    )
    expect(wrapper.get('.ntfy-switch').element.checked).toBe(false)
    expect(wrapper.text()).toContain('Paused. Your settings are kept')
    expect(wrapper.get('[data-testid="ntfy-subscription"]').text()).toContain(
      'https://ntfy.sh/my-cookie-mail',
    )
    expect(wrapper.get('[aria-label="ntfy topic"]').element.value).toBe('my-cookie-mail')
    expect(button(wrapper, 'Send test notification').attributes('disabled')).toBeDefined()
  })

  it('turning the switch on saves the form as it stands', async () => {
    const calls = stubFetch({
      'GET /ntfy': () => jsonResponse({ ...saved, enabled: false }),
      'PUT /ntfy': () => jsonResponse(saved),
    })
    const wrapper = await mountSettings()
    const toggle = wrapper.get('.ntfy-switch')

    toggle.element.checked = true
    await toggle.trigger('change')
    await flushPromises()

    expect(calls.at(-1)).toEqual({
      method: 'PUT',
      path: '/ntfy',
      body: { serverUrl: 'https://ntfy.sh', topic: 'my-cookie-mail' },
    })
    expect(wrapper.get('.ntfy-switch').element.checked).toBe(true)
  })

  it('snaps the switch back when there is nothing valid to save', async () => {
    stubFetch({ 'GET /ntfy': () => jsonResponse(notSetUp) })
    const wrapper = await mountSettings()
    const toggle = wrapper.get('.ntfy-switch')

    toggle.element.checked = true
    await toggle.trigger('change')
    await flushPromises()

    expect(toggle.element.checked).toBe(false)
    expect(wrapper.get('[role="alert"]').text()).toBe(
      'Enter an https:// ntfy server and a topic first.',
    )
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('sends a test notification and confirms delivery was accepted', async () => {
    stubFetch({
      'GET /ntfy': () => jsonResponse(saved),
      'POST /ntfy/test': () => jsonResponse({ sent: true }),
    })
    const wrapper = await mountSettings()

    await button(wrapper, 'Send test notification').trigger('click')
    await flushPromises()

    expect(fetch).toHaveBeenCalledWith(
      `${NOTIFICATIONS_API_URL}/ntfy/test`,
      expect.objectContaining({ method: 'POST' }),
    )
    expect(store.toasts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: 'Test notification sent.', kind: 'info' }),
      ]),
    )
  })

  it.each([
    [
      'ntfy_rate_limited',
      503,
      'ntfy is temporarily rate-limiting notifications. Try again shortly.',
    ],
    ['ntfy_unavailable', 503, 'Your ntfy server is temporarily unavailable. Try again shortly.'],
    [
      'ntfy_rejected',
      502,
      'Your ntfy server rejected the notification. Check the topic and access token.',
    ],
  ])('explains a %s test failure', async (code, status, message) => {
    stubFetch({
      'GET /ntfy': () => jsonResponse(saved),
      'POST /ntfy/test': () => jsonResponse({ error: code }, status),
    })
    const wrapper = await mountSettings()

    await button(wrapper, 'Send test notification').trigger('click')
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toBe(message)
  })

  it('reports when the settings cannot be loaded', async () => {
    stubFetch({ 'GET /ntfy': () => jsonResponse({ error: 'down' }, 503) })
    const wrapper = await mountSettings()

    expect(wrapper.get('[role="alert"]').text()).toBe('Could not load ntfy settings.')
    expect(wrapper.get('[aria-label="ntfy server URL"]').element.value).toBe('https://ntfy.sh')
  })
})
