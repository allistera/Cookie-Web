import process from 'node:process'
import { Buffer } from 'node:buffer'
import { Readable } from 'node:stream'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createHandler, MAX_OUTBOUND_ATTACHMENT_BYTES } from '../send.js'

const mocks = {
  getSql: vi.fn(),
  resendSend: vi.fn(),
  readBlob: vi.fn(),
}

const USER_ID = '11111111-1111-1111-1111-111111111111'

const handler = createHandler({
  verifyAccessToken: vi.fn(async () => ({ email: 'owner@example.com', userId: USER_ID })),
  getSql: mocks.getSql,
  createResend: () => ({ emails: { send: mocks.resendSend } }),
  readBlob: mocks.readBlob,
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
    process.env.EMAIL_FROM = 'Cookie <mail@example.com>'
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
        return [
          {
            user_id: '11111111-1111-1111-1111-111111111111',
            thread_id: null,
          },
        ]
      }
      return []
    })
    sql.begin = async (callback) => callback(sql)
    mocks.getSql.mockReturnValue(sql)
    mocks.resendSend.mockResolvedValue({ data: { id: 'resend-1' }, error: null })
    const res = makeRes()

    await handler(request(), res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({
      id: 'resend-1',
      messageId: expect.any(String),
    })
    expect(mocks.resendSend).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'Cookie <mail@example.com>',
        to: ['recipient@example.com'],
        subject: 'Hello',
        text: 'Plain text',
      }),
      expect.objectContaining({ idempotencyKey: expect.stringMatching(/^immediate-send\//) }),
    )
  })

  it('loads owned private attachments into the provider payload and stores them on the sent copy', async () => {
    const attachmentId = '22222222-2222-4222-8222-222222222222'
    const attachment = {
      id: attachmentId,
      filename: 'plan.pdf',
      content_type: 'application/pdf',
      size_bytes: 3,
      blob_url: 'https://store.private.blob.vercel-storage.com/plan.pdf',
    }
    let call = 0
    const sql = vi.fn(async (parts) => {
      call += 1
      if (call === 1) return [attachment]
      if (call === 2) return [{ authorized: true, quota_claimed: true }]
      if (call === 3) return [{ user_id: USER_ID, thread_id: null }]
      if (parts.join(' ').includes('INSERT INTO messages')) return [{ id: 'sent-message' }]
      return []
    })
    sql.begin = async (callback) => callback(sql)
    mocks.getSql.mockReturnValue(sql)
    mocks.readBlob.mockResolvedValue({
      statusCode: 200,
      stream: Readable.from([Buffer.from('pdf')]),
      blob: { size: 3 },
    })
    mocks.resendSend.mockResolvedValue({ data: { id: 'resend-forward' }, error: null })
    const res = makeRes()

    await handler(request({ attachmentIds: [attachmentId] }), res)

    expect(res.statusCode).toBe(200)
    expect(mocks.readBlob).toHaveBeenCalledWith(attachment.blob_url)
    expect(mocks.resendSend).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [
          expect.objectContaining({
            filename: 'plan.pdf',
            contentType: 'application/pdf',
            content: Buffer.from('pdf').toString('base64'),
          }),
        ],
      }),
      expect.any(Object),
    )
    const attachmentInsert = sql.mock.calls.find(([parts]) =>
      parts.join(' ').includes('INSERT INTO attachments'),
    )
    expect(attachmentInsert).toBeTruthy()
    expect(attachmentInsert.slice(1)).toContain(attachment.blob_url)
  })

  it('rejects attachment ids that are not owned by the authenticated user', async () => {
    const sql = vi.fn(async () => [])
    mocks.getSql.mockReturnValue(sql)
    const res = makeRes()

    await handler(request({ attachmentIds: ['22222222-2222-4222-8222-222222222222'] }), res)

    expect(res.statusCode).toBe(404)
    expect(mocks.readBlob).not.toHaveBeenCalled()
    expect(mocks.resendSend).not.toHaveBeenCalled()
  })

  it('rejects raw attachments that would exceed the provider limit after encoding', async () => {
    const attachmentId = '22222222-2222-4222-8222-222222222222'
    const sql = vi.fn(async () => [
      {
        id: attachmentId,
        filename: 'too-large.zip',
        content_type: 'application/zip',
        size_bytes: MAX_OUTBOUND_ATTACHMENT_BYTES + 1,
        blob_url: 'https://store.private.blob.vercel-storage.com/too-large.zip',
      },
    ])
    mocks.getSql.mockReturnValue(sql)
    const res = makeRes()

    await handler(request({ attachmentIds: [attachmentId] }), res)

    expect(res.statusCode).toBe(400)
    expect(mocks.readBlob).not.toHaveBeenCalled()
    expect(mocks.resendSend).not.toHaveBeenCalled()
  })

  it('rejects malformed attachment ids before touching the database', async () => {
    const res = makeRes()

    await handler(request({ attachmentIds: ['not-a-uuid'] }), res)

    expect(res.statusCode).toBe(400)
    expect(mocks.getSql).not.toHaveBeenCalled()
    expect(mocks.resendSend).not.toHaveBeenCalled()
  })

  it('persists a follow-up reminder on the sent copy', async () => {
    const followUpAt = new Date(Date.now() + 10 * 60_000).toISOString()
    let call = 0
    const sql = vi.fn(async () => {
      call += 1
      if (call === 1) return [{ authorized: true, quota_claimed: true }]
      if (call === 2) return [{ user_id: USER_ID, thread_id: null }]
      return []
    })
    sql.begin = async (callback) => callback(sql)
    mocks.getSql.mockReturnValue(sql)
    mocks.resendSend.mockResolvedValue({ data: { id: 'resend-2' }, error: null })
    const res = makeRes()

    await handler(request({ followUpAt }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ id: 'resend-2', followUpScheduled: true })
    const insertCall = sql.mock.calls.find(([parts]) =>
      parts.join(' ').includes('INSERT INTO messages'),
    )
    expect(insertCall[0].join(' ')).toContain('follow_up_at')
    expect(insertCall.slice(1)).toContain(followUpAt)
  })

  it('rejects a follow-up reminder that is too soon before sending', async () => {
    const res = makeRes()

    await handler(request({ followUpAt: new Date(Date.now() + 10_000).toISOString() }), res)

    expect(res.statusCode).toBe(400)
    expect(mocks.getSql).not.toHaveBeenCalled()
    expect(mocks.resendSend).not.toHaveBeenCalled()
  })

  it('refuses to send when EMAIL_FROM is missing', async () => {
    delete process.env.EMAIL_FROM
    const res = makeRes()

    await handler(request(), res)

    expect(res.statusCode).toBe(503)
    expect(mocks.resendSend).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/send?resource=follow-up', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('updates only an owned sent message without a later inbound reply', async () => {
    const followUpAt = new Date(Date.now() + 10 * 60_000).toISOString()
    const sql = vi.fn(async () => [{ id: USER_ID, followUpAt }])
    mocks.getSql.mockReturnValue(sql)
    const res = makeRes()

    await handler(
      {
        method: 'PATCH',
        url: '/api/send?resource=follow-up',
        headers: {},
        body: { messageId: USER_ID, followUpAt },
      },
      res,
    )

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ message: { id: USER_ID, followUpAt } })
    const query = sql.mock.calls[0][0].join(' ')
    expect(query).toContain('m.user_id =')
    expect(query).toContain('NOT EXISTS')
    expect(query).toContain('reply.thread_id = m.thread_id')
  })

  it('returns conflict when the owned message already has a reply', async () => {
    const sql = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ exists: 1 }])
    mocks.getSql.mockReturnValue(sql)
    const res = makeRes()

    await handler(
      {
        method: 'PATCH',
        url: '/api/send?resource=follow-up',
        headers: {},
        body: {
          messageId: USER_ID,
          followUpAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        },
      },
      res,
    )

    expect(res.statusCode).toBe(409)
    expect(res.body.error).toMatch(/already has a reply/i)
  })

  it('clears a reminder from an owned sent message', async () => {
    const sql = vi.fn(async () => [{ id: USER_ID, followUpAt: null }])
    mocks.getSql.mockReturnValue(sql)
    const res = makeRes()

    await handler(
      {
        method: 'PATCH',
        url: '/api/send?resource=follow-up',
        headers: {},
        body: { messageId: USER_ID, followUpAt: null },
      },
      res,
    )

    expect(res.statusCode).toBe(200)
    expect(res.body.message.followUpAt).toBeNull()
    expect(sql.mock.calls[0][0].join(' ')).toContain('SET follow_up_at = NULL')
  })
})
