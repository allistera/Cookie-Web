import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createHandler } from '../calendar-events.js'

let sqlQueue = []

const handler = createHandler({
  verifyAccessToken: vi.fn(async () => ({ email: 'owner@example.com' })),
  captureApiError: vi.fn(async () => undefined),
  calendarsHandler: vi.fn(async (req, res) => {
    res.statusCode = 200
    res.end('{}')
  }),
  getSql: () => () => Promise.resolve(sqlQueue.shift() ?? []),
})

function makeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name] = value
    },
    end(payload) {
      this.body = payload ? JSON.parse(payload) : null
    },
  }
}

const CALENDAR_ID = '11111111-1111-1111-1111-111111111111'
const EVENT_ID = '22222222-2222-2222-2222-222222222222'
const SUBSCRIPTION_URL = 'https://example.com/feed.ics'

function post(body) {
  return { method: 'POST', url: '/api/calendar-events', headers: {}, body }
}
function patch(body) {
  return { method: 'PATCH', url: '/api/calendar-events', headers: {}, body }
}
function del(body) {
  return { method: 'DELETE', url: '/api/calendar-events', headers: {}, body }
}

const FIELDS = { title: 'Test event', date: '2026-08-01', start: '10:00', duration: 30, calendar: CALENDAR_ID }

describe('subscribed calendars are read-only', () => {
  beforeEach(() => {
    sqlQueue = []
  })

  it('rejects creating an event in a subscribed calendar with 403', async () => {
    sqlQueue = [[{ id: CALENDAR_ID, subscriptionUrl: SUBSCRIPTION_URL }]]
    const res = makeRes()
    await handler(post(FIELDS), res)

    expect(res.statusCode).toBe(403)
    expect(res.body.error).toContain('read-only')
  })

  it('allows creating an event in a normal calendar', async () => {
    sqlQueue = [[{ id: CALENDAR_ID, subscriptionUrl: null }], [{ id: EVENT_ID, ...FIELDS }]]
    const res = makeRes()
    await handler(post(FIELDS), res)

    expect(res.statusCode).toBe(201)
  })

  it('rejects updating an event whose target calendar is subscribed', async () => {
    sqlQueue = [[{ id: CALENDAR_ID, subscriptionUrl: SUBSCRIPTION_URL }]]
    const res = makeRes()
    await handler(patch({ id: EVENT_ID, ...FIELDS }), res)

    expect(res.statusCode).toBe(403)
  })

  it('rejects updating an event currently in a subscribed calendar, even moving it elsewhere', async () => {
    sqlQueue = [[{ id: CALENDAR_ID, subscriptionUrl: null }], [{ isSubscribed: true }]]
    const res = makeRes()
    await handler(patch({ id: EVENT_ID, ...FIELDS }), res)

    expect(res.statusCode).toBe(403)
  })

  it('rejects deleting an event that lives in a subscribed calendar', async () => {
    sqlQueue = [[{ isSubscribed: true }]]
    const res = makeRes()
    await handler(del({ id: EVENT_ID }), res)

    expect(res.statusCode).toBe(403)
    expect(res.body.error).toContain('read-only')
  })

  it('allows deleting an event in a normal calendar', async () => {
    sqlQueue = [[{ isSubscribed: false }], [{ id: EVENT_ID }]]
    const res = makeRes()
    await handler(del({ id: EVENT_ID }), res)

    expect(res.statusCode).toBe(200)
  })
})
