import process from 'node:process'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  captureApiError: vi.fn(),
  getSql: vi.fn(),
  resendSend: vi.fn(),
}))

vi.mock('../_lib/auth.js', () => ({
  verifyAccessToken: vi.fn(async () => ({ email: 'owner@example.com' })),
}))
vi.mock('../_lib/db.js', () => ({ getSql: mocks.getSql }))
vi.mock('../_lib/sentry.js', () => ({ captureApiError: mocks.captureApiError }))
vi.mock('../_lib/embeddings.js', () => ({
  EMBEDDING_MODEL: 'test-model',
  embedText: vi.fn(),
}))
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: mocks.resendSend }
  },
}))

import handler, { parseScheduledFor } from '../send.js'

afterEach(() => {
  vi.restoreAllMocks()
})

function makeRes() {
  return {
    statusCode: 0,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value
    },
    end(payload) {
      this.body = payload ? JSON.parse(payload) : null
    },
  }
}

function request({ method = 'POST', url = '/api/send', headers = {}, body } = {}) {
  return { method, url, headers, ...(body !== undefined ? { body } : {}) }
}

// Each entry is the return value of the Nth sql`...` invocation, in call
// order; sql.begin runs its callback against the same counter so statements
// executed inside a transaction consume responses too.
function sequentialSql(responses) {
  const fn = vi.fn()
  let call = 0
  fn.mockImplementation(async () => responses[call++] ?? [])
  fn.begin = async (callback) => callback(fn)
  return fn
}

function futureIso(msFromNow = 10 * 60_000) {
  return new Date(Date.now() + msFromNow).toISOString()
}

describe('parseScheduledFor', () => {
  it('accepts an ISO timestamp comfortably in the future', () => {
    const iso = futureIso()
    expect(parseScheduledFor(iso)).toBe(new Date(iso).toISOString())
  })

  it('rejects missing, unparsable, past, or too-soon values', () => {
    expect(parseScheduledFor(undefined)).toBeNull()
    expect(parseScheduledFor('not a date')).toBeNull()
    expect(parseScheduledFor(new Date(Date.now() - 60_000).toISOString())).toBeNull()
    expect(parseScheduledFor(new Date(Date.now() + 10_000).toISOString())).toBeNull()
  })
})

describe('POST /api/send with sendAt (schedule creation)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.RESEND_API_KEY = 'test-key'
  })

  it('queues a scheduled_sends row instead of calling the provider', async () => {
    const sql = sequentialSql([
      [{ id: 'sched-1', toAddresses: 'recipient@example.com', subject: 'Hello', scheduledFor: futureIso() }],
    ])
    mocks.getSql.mockReturnValue(sql)
    const res = makeRes()

    await handler(
      request({ body: { to: 'recipient@example.com', subject: 'Hello', text: 'Plain text', sendAt: futureIso() } }),
      res,
    )

    expect(res.statusCode).toBe(201)
    expect(res.body.scheduledSend.id).toBe('sched-1')
    expect(mocks.resendSend).not.toHaveBeenCalled()
  })

  it('rejects a sendAt less than a minute out without touching the database', async () => {
    const res = makeRes()

    await handler(
      request({
        body: { to: 'recipient@example.com', subject: 'Hello', text: 'Plain text', sendAt: futureIso(1000) },
      }),
      res,
    )

    expect(res.statusCode).toBe(400)
    expect(mocks.getSql).not.toHaveBeenCalled()
  })

  it('reports 429 when the per-user pending cap is hit', async () => {
    const sql = sequentialSql([[]])
    mocks.getSql.mockReturnValue(sql)
    const res = makeRes()

    await handler(
      request({ body: { to: 'recipient@example.com', subject: 'Hello', text: 'Plain text', sendAt: futureIso() } }),
      res,
    )

    expect(res.statusCode).toBe(429)
  })
})

describe('GET/DELETE /api/send?resource=scheduled', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.RESEND_API_KEY = 'test-key'
  })

  it("lists the authenticated user's pending and failed scheduled sends", async () => {
    const rows = [
      { id: 'sched-1', toAddresses: 'a@b.com', subject: 'Hi', scheduledFor: futureIso(), status: 'pending', lastError: null },
    ]
    const sql = sequentialSql([rows])
    mocks.getSql.mockReturnValue(sql)
    const res = makeRes()

    await handler(request({ method: 'GET', url: '/api/send?resource=scheduled' }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.scheduledSends).toEqual(rows)
  })

  it('cancels a pending scheduled send and returns its content for reopening in the composer', async () => {
    const row = { id: 'sched-1', toAddresses: 'a@b.com', subject: 'Hi', text: 'Body', html: null, replyToMessageId: null }
    const sql = sequentialSql([[row]])
    mocks.getSql.mockReturnValue(sql)
    const res = makeRes()

    await handler(
      request({
        method: 'DELETE',
        url: '/api/send?resource=scheduled',
        body: { id: '11111111-1111-1111-1111-111111111111' },
      }),
      res,
    )

    expect(res.statusCode).toBe(200)
    expect(res.body.scheduledSend).toEqual(row)
  })

  it('404s canceling an id that is no longer pending (already sending/sent/failed)', async () => {
    const sql = sequentialSql([[]])
    mocks.getSql.mockReturnValue(sql)
    const res = makeRes()

    await handler(
      request({
        method: 'DELETE',
        url: '/api/send?resource=scheduled',
        body: { id: '11111111-1111-1111-1111-111111111111' },
      }),
      res,
    )

    expect(res.statusCode).toBe(404)
  })
})

describe('POST /api/send?resource=flush', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.RESEND_API_KEY = 'test-key'
    process.env.SCHEDULED_SEND_FLUSH_TOKEN = 'flush-secret'
    delete process.env.OPENAI_API_KEY
    delete process.env.PUBLIC_APP_URL
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL
    delete process.env.VERCEL_URL
  })

  function flushRequest(headers = {}) {
    return request({ method: 'POST', url: '/api/send?resource=flush', headers })
  }

  it('rejects a missing or wrong bearer token without touching the database', async () => {
    const res = makeRes()
    await handler(flushRequest(), res)
    expect(res.statusCode).toBe(401)
    expect(mocks.getSql).not.toHaveBeenCalled()

    const res2 = makeRes()
    await handler(flushRequest({ authorization: 'Bearer wrong' }), res2)
    expect(res2.statusCode).toBe(401)
  })

  it('delivers a claimed due row end to end and marks it sent', async () => {
    const claimedRow = {
      id: 'sched-1',
      user_id: 'user-1',
      toAddresses: 'recipient@example.com',
      subject: 'Hello',
      text: 'Plain text',
      html: null,
      replyToMessageId: null,
      attempts: 0,
    }
    const sql = sequentialSql([
      [claimedRow], // claimDueScheduledSends
      [{ email: 'owner@example.com' }], // owner lookup
      [{ authorized: true, quota_claimed: true }], // claimOutboundEmailQuota
      [{ user_id: 'user-1', thread_id: null }], // storeSentMessage lookup
      [], // insert threads (sql.begin)
      [], // insert messages (sql.begin)
      [], // mark 'sent'
    ])
    mocks.getSql.mockReturnValue(sql)
    mocks.resendSend.mockResolvedValue({ data: { id: 'resend-9' }, error: null })
    const res = makeRes()

    await handler(flushRequest({ authorization: 'Bearer flush-secret' }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ claimed: 1, sent: 1, retried: 0, failed: 0 })
    expect(mocks.resendSend).toHaveBeenCalledTimes(1)
  })

  it('leaves a rate-limited row pending for the next flush instead of spending a retry', async () => {
    const claimedRow = {
      id: 'sched-1',
      user_id: 'user-1',
      toAddresses: 'a@b.com',
      subject: 'Hi',
      text: 'Body',
      html: null,
      replyToMessageId: null,
      attempts: 0,
    }
    const sql = sequentialSql([
      [claimedRow],
      [{ email: 'owner@example.com' }],
      [{ authorized: true, quota_claimed: false }],
      [], // revert to 'pending'
    ])
    mocks.getSql.mockReturnValue(sql)
    const res = makeRes()

    await handler(flushRequest({ authorization: 'Bearer flush-secret' }), res)

    expect(res.body).toEqual({ claimed: 1, sent: 0, retried: 1, failed: 0 })
    expect(mocks.resendSend).not.toHaveBeenCalled()
  })

  it('marks a row failed once it has exhausted its retry attempts', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const claimedRow = {
      id: 'sched-1',
      user_id: 'user-1',
      toAddresses: 'a@b.com',
      subject: 'Hi',
      text: 'Body',
      html: null,
      replyToMessageId: null,
      attempts: 4,
    }
    const sql = sequentialSql([
      [claimedRow],
      [{ email: 'owner@example.com' }],
      [{ authorized: true, quota_claimed: true }],
      [], // mark 'failed'
    ])
    mocks.getSql.mockReturnValue(sql)
    mocks.resendSend.mockResolvedValue({ data: null, error: { message: 'bounced' } })
    const res = makeRes()

    await handler(flushRequest({ authorization: 'Bearer flush-secret' }), res)

    expect(res.body).toEqual({ claimed: 1, sent: 0, retried: 0, failed: 1 })
    expect(consoleError).toHaveBeenCalledWith(
      'scheduled send sched-1 delivery failed (attempt 5):',
      'bounced',
    )
  })
})
