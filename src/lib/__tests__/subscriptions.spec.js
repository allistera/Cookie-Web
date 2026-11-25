import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setAuth0Client } from '../../auth0-client'
import { MESSAGES_API_URL } from '../apiWorkers'
import { fetchSubscriptions, isStillSending, unsubscribeFromSender } from '../subscriptions'

function stubFetch(payload, { ok = true, status = 200 } = {}) {
  const fetchMock = vi.fn(async () => ({ ok, status, json: async () => payload }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  setAuth0Client(null)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const SUBSCRIPTION = {
  address: 'news@dailybites.example',
  name: 'Daily Bites',
  messageId: 'message-1',
  messageCount: 3,
  lastReceivedAt: '2026-11-20T08:00:00.000Z',
  unsubscribedAt: null,
}

describe('fetchSubscriptions', () => {
  it('reads the list from the messages Worker', async () => {
    const fetchMock = stubFetch({ subscriptions: [SUBSCRIPTION] })
    expect(await fetchSubscriptions()).toEqual([SUBSCRIPTION])
    expect(fetchMock.mock.calls[0][0]).toBe(`${MESSAGES_API_URL}/messages/subscriptions`)
  })

  it('treats a malformed payload as no subscriptions', async () => {
    stubFetch({ subscriptions: 'none' })
    expect(await fetchSubscriptions()).toEqual([])
  })

  it('rejects when the request fails', async () => {
    stubFetch({ error: 'Request failed' }, { ok: false, status: 500 })
    await expect(fetchSubscriptions()).rejects.toThrow('Request failed')
  })
})

describe('unsubscribeFromSender', () => {
  it("unsubscribes through the sender's newest message, with the AI tier allowed", async () => {
    const fetchMock = stubFetch({ status: 'unsubscribed', method: 'one-click' })
    expect(await unsubscribeFromSender(SUBSCRIPTION)).toEqual({ status: 'unsubscribed' })
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe(`${MESSAGES_API_URL}/messages`)
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body)).toEqual({
      id: 'message-1',
      action: 'unsubscribe',
      allow_ai: true,
    })
  })

  it("hands back the sender's page when the server could not finish", async () => {
    stubFetch({ status: 'ai_failed', method: 'ai', url: 'https://example.com/leave' })
    expect(await unsubscribeFromSender(SUBSCRIPTION)).toEqual({
      status: 'manual',
      href: 'https://example.com/leave',
    })
    stubFetch({ status: 'manual', method: 'link', url: 'https://example.com/leave' })
    expect(await unsubscribeFromSender(SUBSCRIPTION)).toEqual({
      status: 'manual',
      href: 'https://example.com/leave',
    })
  })

  it('hands back a strict mailto link for a sender that only takes mail', async () => {
    stubFetch({ status: 'manual', method: 'mailto', mailto: 'mailto:leave@example.com' })
    expect(await unsubscribeFromSender(SUBSCRIPTION)).toEqual({
      status: 'manual',
      href: 'mailto:leave@example.com',
    })
  })

  it('never turns an unsafe sender-supplied target into a link', async () => {
    stubFetch({ status: 'manual', method: 'link', url: 'http://intranet.local/leave' })
    expect(await unsubscribeFromSender(SUBSCRIPTION)).toEqual({ status: 'failed' })
    stubFetch({ status: 'ai_failed', method: 'ai', url: 'javascript:alert(1)' })
    expect(await unsubscribeFromSender(SUBSCRIPTION)).toEqual({ status: 'failed' })
    stubFetch({
      status: 'manual',
      method: 'mailto',
      mailto: 'mailto:a@example.com,b@example.com?body=hello',
    })
    expect(await unsubscribeFromSender(SUBSCRIPTION)).toEqual({ status: 'failed' })
  })

  it("rejects with the server's message when the request is refused", async () => {
    stubFetch({ error: 'Too many unsubscribe actions, slow down' }, { ok: false, status: 429 })
    await expect(unsubscribeFromSender(SUBSCRIPTION)).rejects.toMatchObject({
      status: 429,
      userMessage: 'Too many unsubscribe actions, slow down',
    })
  })
})

describe('isStillSending', () => {
  it('is false for a sender never unsubscribed from', () => {
    expect(isStillSending(SUBSCRIPTION)).toBe(false)
  })

  it('compares the newest mail with the unsubscribe', () => {
    expect(isStillSending({ ...SUBSCRIPTION, unsubscribedAt: '2026-11-21T00:00:00.000Z' })).toBe(
      false,
    )
    expect(isStillSending({ ...SUBSCRIPTION, unsubscribedAt: '2026-11-19T00:00:00.000Z' })).toBe(
      true,
    )
  })
})
