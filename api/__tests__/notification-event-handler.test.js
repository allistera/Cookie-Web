import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createHandler } from '../notification-event.js'

// Each tagged-template query resolves to the next queued result, in call
// order, so a test can script the exact sequence of round trips a branch makes.
let sqlQueue = []
let statements = []
function getSql() {
  const fn = (strings) => {
    statements.push(strings.join('?'))
    return Promise.resolve(sqlQueue.shift() ?? [])
  }
  fn.begin = async (callback) => callback(fn)
  return fn
}

const verifyAccessToken = vi.fn(async () => ({ email: 'owner@example.com' }))

const handler = createHandler({
  verifyAccessToken,
  getSql,
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

const EVENT_ID = '11111111-1111-1111-1111-111111111111'
const CLAIM_TOKEN = '22222222-2222-2222-2222-222222222222'
const MESSAGE_ID = '33333333-3333-3333-3333-333333333333'

function req(body) {
  return { method: 'POST', url: '/api/notification-event', headers: {}, body }
}

beforeEach(() => {
  sqlQueue = []
  statements = []
})

describe('POST /api/notification-event claim', () => {
  it('returns the leased event with only the sender and subject', async () => {
    sqlQueue = [[
      {
        event_id: EVENT_ID,
        claim_token: CLAIM_TOKEN,
        claimed_until: '2026-07-30T00:00:30Z',
        message_id: MESSAGE_ID,
        from_name: 'Ana',
        from_address: 'ana@example.com',
        subject: 'Lunch?',
      },
    ]]
    const res = makeRes()

    await handler(req({ action: 'claim', eventId: EVENT_ID }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({
      eventId: EVENT_ID,
      claimToken: CLAIM_TOKEN,
      message: { id: MESSAGE_ID, sender: 'Ana', subject: 'Lunch?' },
    })
    expect(res.headers['Cache-Control']).toBe('no-store')
  })

  it('falls back to the sender address when the message has no display name', async () => {
    sqlQueue = [[
      {
        event_id: EVENT_ID,
        claim_token: CLAIM_TOKEN,
        message_id: MESSAGE_ID,
        from_name: null,
        from_address: 'ana@example.com',
        subject: 'Lunch?',
      },
    ]]
    const res = makeRes()

    await handler(req({ action: 'claim', eventId: EVENT_ID }), res)

    expect(res.body.message.sender).toBe('ana@example.com')
  })

  // An event already leased by another tab must not produce a second
  // notification; the caller is told to back off rather than given the payload.
  it('423s while another claim still holds the lease', async () => {
    const future = new Date(Date.now() + 30_000).toISOString()
    sqlQueue = [
      [], // claim matched nothing
      [{ claimed_until: future }], // ...because the lease is live
    ]
    const res = makeRes()

    await handler(req({ action: 'claim', eventId: EVENT_ID }), res)

    expect(res.statusCode).toBe(423)
    expect(res.headers['Retry-After']).toBe('30')
  })

  it('204s when the event is gone or no longer eligible', async () => {
    sqlQueue = [
      [], // claim matched nothing
      [], // no such event for this caller
    ]
    const res = makeRes()

    await handler(req({ action: 'claim', eventId: EVENT_ID }), res)

    expect(res.statusCode).toBe(204)
    expect(res.body).toBeNull()
  })

  it('204s when a previously expired lease left no live claim', async () => {
    const past = new Date(Date.now() - 30_000).toISOString()
    sqlQueue = [[], [{ claimed_until: past }]]
    const res = makeRes()

    await handler(req({ action: 'claim', eventId: EVENT_ID }), res)

    expect(res.statusCode).toBe(204)
  })
})

describe('POST /api/notification-event ack', () => {
  it('acknowledges a claim and returns no content', async () => {
    sqlQueue = [[{ event_id: EVENT_ID }]]
    const res = makeRes()

    await handler(req({ action: 'ack', eventId: EVENT_ID, claimToken: CLAIM_TOKEN }), res)

    expect(res.statusCode).toBe(204)
    expect(res.body).toBeNull()
    expect(statements[0]).toContain('DELETE FROM browser_notification_events')
    expect(statements[0]).toContain('lower(owner.email) = ?')
  })

  it('rejects an ack with no claim token', async () => {
    const res = makeRes()

    await handler(req({ action: 'ack', eventId: EVENT_ID }), res)

    expect(res.statusCode).toBe(400)
    expect(statements).toHaveLength(0)
  })

  it('rejects a malformed claim token', async () => {
    const res = makeRes()

    await handler(req({ action: 'ack', eventId: EVENT_ID, claimToken: 'nope' }), res)

    expect(res.statusCode).toBe(400)
    expect(statements).toHaveLength(0)
  })
})

describe('validation, auth, and method handling', () => {
  it.each([
    ['an unknown action', { action: 'peek', eventId: EVENT_ID }],
    ['a malformed event id', { action: 'claim', eventId: 'not-a-uuid' }],
    ['a missing event id', { action: 'claim' }],
  ])('rejects %s before touching the database', async (_name, body) => {
    const res = makeRes()

    await handler(req(body), res)

    expect(res.statusCode).toBe(400)
    expect(statements).toHaveLength(0)
  })

  it('401s without a valid token', async () => {
    verifyAccessToken.mockRejectedValueOnce(new Error('no token'))
    const res = makeRes()

    await handler(req({ action: 'claim', eventId: EVENT_ID }), res)

    expect(res.statusCode).toBe(401)
  })

  it('405s on a non-POST method', async () => {
    const res = makeRes()

    await handler({ method: 'GET', url: '/api/notification-event', headers: {} }, res)

    expect(res.statusCode).toBe(405)
    expect(res.headers.Allow).toBe('POST')
  })
})
