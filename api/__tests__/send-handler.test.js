import process from 'node:process'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createHandler } from '../send.js'

const mocks = {
  getSql: vi.fn(),
  resendSend: vi.fn(),
}

const USER_ID = '11111111-1111-1111-1111-111111111111'

const handler = createHandler({
  verifyAccessToken: vi.fn(async () => ({ email: 'owner@example.com', userId: USER_ID })),
  getSql: mocks.getSql,
  embedText: vi.fn(),
  createResend: () => ({ emails: { send: mocks.resendSend } }),
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

function request(overrides = {}) {
  return {
    method: 'POST',
    headers: {},
    body: {
      to: 'recipient@example.com',
      subject: 'Hello',
      text: 'Plain text',
      ...overrides,
    },
  }
}

describe('POST /api/send security boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.RESEND_API_KEY = 'test-key'
    delete process.env.OPENAI_API_KEY
    delete process.env.PUBLIC_APP_URL
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL
    delete process.env.VERCEL_URL
  })

  it('stops a quota-exhausted request before constructing a provider send', async () => {
    const sql = vi.fn(async () => [{ authorized: true, quota_claimed: false }])
    mocks.getSql.mockReturnValue(sql)
    const res = makeRes()

    await handler(request(), res)

    expect(res.statusCode).toBe(429)
    expect(mocks.resendSend).not.toHaveBeenCalled()
  })

  it('stops oversized content before touching the database or provider', async () => {
    const res = makeRes()

    await handler(request({ text: 'x'.repeat(100_001) }), res)

    expect(res.statusCode).toBe(400)
    expect(mocks.getSql).not.toHaveBeenCalled()
    expect(mocks.resendSend).not.toHaveBeenCalled()
  })

  it('preserves a normal provisioned send after the quota claim succeeds', async () => {
    let call = 0
    const sql = vi.fn(async () => {
      call += 1
      if (call === 1) return [{ authorized: true, quota_claimed: true }]
      if (call === 2) {
        return [{
          user_id: '11111111-1111-1111-1111-111111111111',
          thread_id: null,
        }]
      }
      return []
    })
    sql.begin = async (callback) => callback(sql)
    mocks.getSql.mockReturnValue(sql)
    mocks.resendSend.mockResolvedValue({ data: { id: 'resend-1' }, error: null })
    const res = makeRes()

    await handler(request(), res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ id: 'resend-1' })
    expect(mocks.resendSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ['recipient@example.com'],
        subject: 'Hello',
        text: 'Plain text',
      }),
    )
  })
})
