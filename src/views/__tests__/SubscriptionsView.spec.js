import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setAuth0Client } from '../../auth0-client'
import { MESSAGES_API_URL } from '../../lib/apiWorkers'
import { useInboxStore } from '../../stores/inbox'
import SubscriptionsView from '../SubscriptionsView.vue'

const LIST_URL = `${MESSAGES_API_URL}/messages/subscriptions`
const ACTION_URL = `${MESSAGES_API_URL}/messages`

function subscription(overrides = {}) {
  return {
    address: 'news@dailybites.example',
    name: 'Daily Bites',
    messageId: 'message-1',
    messageCount: 12,
    lastReceivedAt: '2026-11-20T08:00:00.000Z',
    unsubscribedAt: null,
    ...overrides,
  }
}

const ok = (payload) => ({ ok: true, status: 200, json: async () => payload })

// `list` answers GET /messages/subscriptions and `act` answers the
// unsubscribe POST; either may be a function of the request.
function stubFetch({ list, act }) {
  const fetchMock = vi.fn(async (url, options = {}) => {
    if (url === LIST_URL) return list()
    if (url === ACTION_URL && options.method === 'POST') return act(JSON.parse(options.body))
    throw new Error(`Unexpected fetch: ${options.method || 'GET'} ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function mountView() {
  const wrapper = mount(SubscriptionsView)
  await flushPromises()
  return wrapper
}

let notify
beforeEach(() => {
  setActivePinia(createPinia())
  setAuth0Client(null)
  notify = vi.spyOn(useInboxStore(), 'notify').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('SubscriptionsView', () => {
  it('lists each sender with its address, mail count and last mail', async () => {
    stubFetch({
      list: () =>
        ok({
          subscriptions: [
            subscription(),
            subscription({ address: 'updates@cityrunners.example', name: null, messageCount: 1 }),
          ],
        }),
    })
    const wrapper = await mountView()
    const rows = wrapper.findAll('.subscriptions-row')

    expect(rows).toHaveLength(2)
    expect(rows[0].get('.subscriptions-name').text()).toBe('Daily Bites')
    expect(rows[0].get('.subscriptions-meta').text()).toBe(
      'news@dailybites.example · 12 emails · last 20 Nov 2026',
    )
    // A sender with no display name is listed by address, said once.
    expect(rows[1].get('.subscriptions-name').text()).toBe('updates@cityrunners.example')
    expect(rows[1].get('.subscriptions-meta').text()).toBe('1 email · last 20 Nov 2026')
    expect(rows[0].get('button').text()).toBe('Unsubscribe')
    wrapper.unmount()
  })

  it('says when there is nothing left to unsubscribe from', async () => {
    stubFetch({ list: () => ok({ subscriptions: [] }) })
    const wrapper = await mountView()
    expect(wrapper.get('.subscriptions-empty').text()).toBe(
      'No subscriptions left to unsubscribe from.',
    )
    wrapper.unmount()
  })

  it('shows a failed load as an error that can be retried, never as an empty list', async () => {
    let attempts = 0
    stubFetch({
      list: () => {
        attempts += 1
        return attempts === 1
          ? { ok: false, status: 500, json: async () => ({ error: 'Request failed' }) }
          : ok({ subscriptions: [subscription()] })
      },
    })
    const wrapper = await mountView()
    expect(wrapper.get('.subscriptions-error').text()).toContain('Could not load')
    expect(wrapper.find('.subscriptions-empty').exists()).toBe(false)

    await wrapper.get('.subscriptions-error button').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.subscriptions-row')).toHaveLength(1)
    wrapper.unmount()
  })

  it('unsubscribes from a sender and takes it off the list', async () => {
    let finish
    const fetchMock = stubFetch({
      list: () =>
        ok({
          subscriptions: [
            subscription(),
            subscription({ address: 'other@example.com', name: 'Other', messageId: 'message-2' }),
          ],
        }),
      act: () => new Promise((resolve) => (finish = resolve)),
    })
    const wrapper = await mountView()
    const button = wrapper.get('.subscriptions-row button')
    expect(button.attributes('aria-label')).toBe('Unsubscribe from Daily Bites')

    await button.trigger('click')
    // In flight: the button says so and cannot be pressed twice.
    expect(button.text()).toBe('Unsubscribing…')
    expect(button.element.disabled).toBe(true)
    await button.trigger('click')

    finish(ok({ status: 'unsubscribed', method: 'one-click' }))
    await flushPromises()

    const posts = fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST')
    expect(posts).toHaveLength(1)
    expect(JSON.parse(posts[0][1].body)).toEqual({
      id: 'message-1',
      action: 'unsubscribe',
      allow_ai: true,
    })
    // Only the other sender is left; the empty message is for an empty list.
    const rows = wrapper.findAll('.subscriptions-row')
    expect(rows.map((row) => row.get('.subscriptions-name').text())).toEqual(['Other'])
    expect(wrapper.find('.subscriptions-empty').exists()).toBe(false)
    expect(notify).toHaveBeenCalledWith('Unsubscribed from Daily Bites.')
    wrapper.unmount()
  })

  it('runs unsubscribes for different senders at the same time', async () => {
    const fetchMock = stubFetch({
      list: () =>
        ok({
          subscriptions: [
            subscription(),
            subscription({ address: 'other@example.com', name: 'Other', messageId: 'message-2' }),
          ],
        }),
      act: () => new Promise(() => {}),
    })
    const wrapper = await mountView()
    const buttons = wrapper.findAll('.subscriptions-row button')
    await buttons[0].trigger('click')
    await buttons[1].trigger('click')

    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(2)
    expect(buttons.map((button) => button.element.disabled)).toEqual([true, true])
    wrapper.unmount()
  })

  it("links to the sender's page when the unsubscribe could not be finished", async () => {
    stubFetch({
      list: () => ok({ subscriptions: [subscription()] }),
      act: () => ok({ status: 'ai_failed', method: 'ai', url: 'https://example.com/leave' }),
    })
    const wrapper = await mountView()
    await wrapper.get('.subscriptions-row button').trigger('click')
    await flushPromises()

    const link = wrapper.get('.subscriptions-row a')
    expect(link.text()).toBe('Open unsubscribe page')
    expect(link.attributes('href')).toBe('https://example.com/leave')
    expect(link.attributes('target')).toBe('_blank')
    expect(link.attributes('rel')).toBe('noopener noreferrer')
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('Could not unsubscribe'), 'error')
    wrapper.unmount()
  })

  it('keeps the row and reports a refused request', async () => {
    stubFetch({
      list: () => ok({ subscriptions: [subscription()] }),
      act: () => ({
        ok: false,
        status: 429,
        json: async () => ({ error: 'Too many unsubscribe actions, slow down' }),
      }),
    })
    const wrapper = await mountView()
    await wrapper.get('.subscriptions-row button').trigger('click')
    await flushPromises()

    const button = wrapper.get('.subscriptions-row button')
    expect(button.text()).toBe('Unsubscribe')
    expect(button.element.disabled).toBe(false)
    expect(notify).toHaveBeenCalledWith('Too many unsubscribe actions, slow down', 'error')
    wrapper.unmount()
  })

  it('leaves out senders already unsubscribed from, unless they kept sending', async () => {
    stubFetch({
      list: () =>
        ok({
          subscriptions: [
            subscription({ unsubscribedAt: '2026-11-21T09:00:00.000Z' }),
            subscription({
              address: 'persistent@example.com',
              name: 'Persistent',
              unsubscribedAt: '2026-11-01T09:00:00.000Z',
            }),
          ],
        }),
    })
    const wrapper = await mountView()
    const rows = wrapper.findAll('.subscriptions-row')

    expect(rows.map((row) => row.get('.subscriptions-name').text())).toEqual(['Persistent'])
    expect(rows[0].get('.subscriptions-status').text()).toBe(
      'Unsubscribed 1 Nov 2026, still sending',
    )
    expect(rows[0].get('button').text()).toBe('Unsubscribe')
    wrapper.unmount()
  })

  it('shows the empty message once the last sender is unsubscribed from', async () => {
    stubFetch({
      list: () => ok({ subscriptions: [subscription()] }),
      act: () => ok({ status: 'unsubscribed', method: 'one-click' }),
    })
    const wrapper = await mountView()
    await wrapper.get('.subscriptions-row button').trigger('click')
    await flushPromises()

    expect(wrapper.findAll('.subscriptions-row')).toHaveLength(0)
    expect(wrapper.get('.subscriptions-empty').exists()).toBe(true)
    wrapper.unmount()
  })
})
