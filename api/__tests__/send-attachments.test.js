import process from 'node:process'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createHandler, sanitizeAttachmentFilename } from '../send.js'

const USER_ID = '11111111-1111-1111-1111-111111111111'
const OTHER_USER_ID = '99999999-9999-4999-8999-999999999999'
const ATTACHMENT_ID = '22222222-2222-4222-8222-222222222222'
const BLOB_URL = 'https://store.private.blob.vercel-storage.com/outbound-attachments/file.pdf'

const mocks = {
  getSql: vi.fn(),
  allowRequest: vi.fn(async () => true),
  headBlob: vi.fn(),
  deleteBlob: vi.fn(async () => undefined),
  handleBlobUpload: vi.fn(),
}

const handler = createHandler({
  verifyAccessToken: vi.fn(async () => ({ email: 'owner@example.com', userId: USER_ID })),
  getSql: mocks.getSql,
  createResend: () => ({ emails: { send: vi.fn() } }),
  allowRequest: mocks.allowRequest,
  headBlob: mocks.headBlob,
  deleteBlob: mocks.deleteBlob,
  handleBlobUpload: mocks.handleBlobUpload,
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

function tokenRequest(body = {}) {
  return { method: 'POST', url: '/api/send?resource=upload-token', headers: {}, body }
}

function registerRequest(body) {
  return { method: 'POST', url: '/api/send?resource=attachment', headers: {}, body }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.allowRequest.mockResolvedValue(true)
  process.env.BLOB_READ_WRITE_TOKEN = 'blob-token'
})

describe('POST /api/send?resource=upload-token', () => {
  it('refuses to mint a token for a pathname outside the caller prefix', async () => {
    // handleUpload surfaces whatever onBeforeGenerateToken throws.
    mocks.handleBlobUpload.mockImplementation(async ({ onBeforeGenerateToken }) =>
      onBeforeGenerateToken(`outbound-attachments/${OTHER_USER_ID}/steal.pdf`, null, false),
    )
    mocks.getSql.mockReturnValue(vi.fn())
    const res = makeRes()

    await handler(tokenRequest(), res)

    expect(res.statusCode).toBe(400)
    expect(mocks.allowRequest).not.toHaveBeenCalled()
  })

  it('caps the minted token at the outbound attachment size limit', async () => {
    let options
    mocks.handleBlobUpload.mockImplementation(async ({ onBeforeGenerateToken }) => {
      options = await onBeforeGenerateToken(`outbound-attachments/${USER_ID}/plan.pdf`, null, false)
      return { ok: true }
    })
    mocks.getSql.mockReturnValue(vi.fn())
    const res = makeRes()

    await handler(tokenRequest(), res)

    expect(res.statusCode).toBe(200)
    expect(options).toMatchObject({
      addRandomSuffix: true,
      maximumSizeInBytes: 20 * 1024 * 1024,
    })
  })

  it('answers 429 once the per-minute upload allowance is spent', async () => {
    mocks.allowRequest.mockResolvedValue(false)
    mocks.handleBlobUpload.mockImplementation(async ({ onBeforeGenerateToken }) =>
      onBeforeGenerateToken(`outbound-attachments/${USER_ID}/plan.pdf`, null, false),
    )
    mocks.getSql.mockReturnValue(vi.fn())
    const res = makeRes()

    await handler(tokenRequest(), res)

    expect(res.statusCode).toBe(429)
  })

  it('reports storage as unconfigured when no blob token is present', async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN
    const res = makeRes()

    await handler(tokenRequest(), res)

    expect(res.statusCode).toBe(503)
    expect(mocks.handleBlobUpload).not.toHaveBeenCalled()
  })
})

describe('POST /api/send?resource=attachment', () => {
  it('records the size and type head() reports, not the ones the client claims', async () => {
    mocks.headBlob.mockResolvedValue({
      pathname: `outbound-attachments/${USER_ID}/plan.pdf`,
      size: 2048,
      contentType: 'application/pdf',
    })
    const sql = vi.fn(async () => [
      {
        id: ATTACHMENT_ID,
        filename: 'plan.pdf',
        content_type: 'application/pdf',
        size_bytes: 2048,
      },
    ])
    mocks.getSql.mockReturnValue(sql)
    const res = makeRes()

    await handler(
      registerRequest({ url: BLOB_URL, filename: 'plan.pdf', size: 1, contentType: 'text/plain' }),
      res,
    )

    expect(res.statusCode).toBe(201)
    expect(res.body.attachment).toMatchObject({ id: ATTACHMENT_ID, size_bytes: 2048 })
    const values = sql.mock.calls[0].slice(1)
    expect(values).toContain(2048)
    expect(values).toContain('application/pdf')
  })

  it('never returns the blob url to the browser', async () => {
    mocks.headBlob.mockResolvedValue({
      pathname: `outbound-attachments/${USER_ID}/plan.pdf`,
      size: 10,
      contentType: 'application/pdf',
    })
    mocks.getSql.mockReturnValue(
      vi.fn(async () => [
        {
          id: ATTACHMENT_ID,
          filename: 'plan.pdf',
          content_type: 'application/pdf',
          size_bytes: 10,
        },
      ]),
    )
    const res = makeRes()

    await handler(registerRequest({ url: BLOB_URL, filename: 'plan.pdf' }), res)

    expect(JSON.stringify(res.body)).not.toContain('vercel-storage.com')
  })

  it('refuses a blob uploaded under another account prefix', async () => {
    mocks.headBlob.mockResolvedValue({
      pathname: `outbound-attachments/${OTHER_USER_ID}/plan.pdf`,
      size: 10,
      contentType: 'application/pdf',
    })
    const sql = vi.fn()
    mocks.getSql.mockReturnValue(sql)
    const res = makeRes()

    await handler(registerRequest({ url: BLOB_URL, filename: 'plan.pdf' }), res)

    expect(res.statusCode).toBe(403)
    expect(sql).not.toHaveBeenCalled()
  })

  it('rejects a url that is not a blob store url before calling head', async () => {
    const res = makeRes()

    await handler(registerRequest({ url: 'https://evil.example.com/x.pdf' }), res)

    expect(res.statusCode).toBe(400)
    expect(mocks.headBlob).not.toHaveBeenCalled()
  })

  it('rejects a stored blob past the outbound size ceiling', async () => {
    mocks.headBlob.mockResolvedValue({
      pathname: `outbound-attachments/${USER_ID}/huge.bin`,
      size: 20 * 1024 * 1024 + 1,
      contentType: 'application/octet-stream',
    })
    const sql = vi.fn()
    mocks.getSql.mockReturnValue(sql)
    const res = makeRes()

    await handler(registerRequest({ url: BLOB_URL, filename: 'huge.bin' }), res)

    expect(res.statusCode).toBe(400)
    expect(sql).not.toHaveBeenCalled()
  })

  it('answers 429 before head() once the per-minute registration allowance is spent', async () => {
    mocks.allowRequest.mockResolvedValue(false)
    const sql = vi.fn()
    mocks.getSql.mockReturnValue(sql)
    const res = makeRes()

    await handler(registerRequest({ url: BLOB_URL, filename: 'plan.pdf' }), res)

    expect(res.statusCode).toBe(429)
    expect(mocks.allowRequest).toHaveBeenCalledWith(sql, USER_ID, 'attachment-register', {
      limit: 30,
      windowMs: 60_000,
    })
    expect(mocks.headBlob).not.toHaveBeenCalled()
    expect(sql).not.toHaveBeenCalled()
  })

  it('returns the existing row with 200 when the same blob is registered again', async () => {
    mocks.headBlob.mockResolvedValue({
      pathname: `outbound-attachments/${USER_ID}/plan.pdf`,
      size: 10,
      contentType: 'application/pdf',
    })
    const sql = vi.fn(async () => [
      {
        id: ATTACHMENT_ID,
        filename: 'plan.pdf',
        content_type: 'application/pdf',
        size_bytes: 10,
        created: false,
      },
    ])
    mocks.getSql.mockReturnValue(sql)
    const res = makeRes()

    await handler(registerRequest({ url: BLOB_URL, filename: 'plan.pdf' }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.attachment).toEqual({
      id: ATTACHMENT_ID,
      filename: 'plan.pdf',
      content_type: 'application/pdf',
      size_bytes: 10,
    })
    expect(sql.mock.calls[0][0].join('')).toContain('ON CONFLICT (user_id, blob_url)')
  })

  it('registers the blob under its url without query or fragment', async () => {
    mocks.headBlob.mockResolvedValue({
      pathname: `outbound-attachments/${USER_ID}/plan.pdf`,
      size: 10,
      contentType: 'application/pdf',
    })
    const sql = vi.fn(async () => [{ id: ATTACHMENT_ID, filename: 'plan.pdf', created: true }])
    mocks.getSql.mockReturnValue(sql)
    const res = makeRes()

    await handler(
      registerRequest({ url: `${BLOB_URL}?download=1#page=2`, filename: 'plan.pdf' }),
      res,
    )

    expect(res.statusCode).toBe(201)
    expect(mocks.headBlob).toHaveBeenCalledWith(BLOB_URL)
    expect(sql.mock.calls[0]).toContain(BLOB_URL)
  })

  it('falls back to a plain insert while the 0083 unique index is missing', async () => {
    mocks.headBlob.mockResolvedValue({
      pathname: `outbound-attachments/${USER_ID}/plan.pdf`,
      size: 10,
      contentType: 'application/pdf',
    })
    const missingIndex = Object.assign(
      new Error(
        'there is no unique or exclusion constraint matching the ON CONFLICT specification',
      ),
      { code: '42P10' },
    )
    const sql = vi
      .fn()
      .mockRejectedValueOnce(missingIndex)
      .mockResolvedValueOnce([{ id: ATTACHMENT_ID, filename: 'plan.pdf', size_bytes: 10 }])
    mocks.getSql.mockReturnValue(sql)
    const res = makeRes()

    await handler(registerRequest({ url: BLOB_URL, filename: 'plan.pdf' }), res)

    expect(res.statusCode).toBe(201)
    expect(res.body.attachment).toMatchObject({ id: ATTACHMENT_ID })
    expect(sql).toHaveBeenCalledTimes(2)
    expect(sql.mock.calls[1][0].join('')).not.toContain('ON CONFLICT')
  })
})

describe('DELETE /api/send?resource=attachment', () => {
  function deleteRequest(id) {
    return { method: 'DELETE', url: `/api/send?resource=attachment&id=${id}`, headers: {} }
  }

  it('deletes the blob when no sent copy still references it', async () => {
    mocks.getSql.mockReturnValue(
      vi.fn(async () => [{ blob_url: BLOB_URL, blobUnreferenced: true }]),
    )
    const res = makeRes()

    await handler(deleteRequest(ATTACHMENT_ID), res)

    expect(res.statusCode).toBe(204)
    expect(mocks.deleteBlob).toHaveBeenCalledWith(BLOB_URL)
  })

  it('deletes the blob only after checking no other upload row of the user shares it', async () => {
    const sql = vi.fn(async () => [{ blob_url: BLOB_URL, blobUnreferenced: true }])
    mocks.getSql.mockReturnValue(sql)
    const res = makeRes()

    await handler(deleteRequest(ATTACHMENT_ID), res)

    expect(sql.mock.calls[0][0].join('')).toMatch(
      /FROM outbound_attachments other\s+WHERE other\.user_id = oa\.user_id\s+AND other\.blob_url = oa\.blob_url\s+AND other\.id <> oa\.id/,
    )
    expect(res.statusCode).toBe(204)
    expect(mocks.deleteBlob).toHaveBeenCalledWith(BLOB_URL)
  })

  it('keeps the bytes when a sent message shares the same blob', async () => {
    mocks.getSql.mockReturnValue(
      vi.fn(async () => [{ blob_url: BLOB_URL, blobUnreferenced: false }]),
    )
    const res = makeRes()

    await handler(deleteRequest(ATTACHMENT_ID), res)

    expect(res.statusCode).toBe(204)
    expect(mocks.deleteBlob).not.toHaveBeenCalled()
  })

  it('404s an id belonging to someone else', async () => {
    mocks.getSql.mockReturnValue(vi.fn(async () => []))
    const res = makeRes()

    await handler(deleteRequest(ATTACHMENT_ID), res)

    expect(res.statusCode).toBe(404)
    expect(mocks.deleteBlob).not.toHaveBeenCalled()
  })
})

describe('sanitizeAttachmentFilename', () => {
  it('keeps only the basename so a path cannot travel with the file', () => {
    expect(sanitizeAttachmentFilename('../../etc/passwd')).toBe('passwd')
    expect(sanitizeAttachmentFilename('C:\\Users\\me\\report.pdf')).toBe('report.pdf')
  })

  it('strips control characters that could forge provider headers', () => {
    expect(sanitizeAttachmentFilename('plan\r\nBcc: attacker@example.com.pdf')).toBe(
      'planBcc: attacker@example.com.pdf',
    )
  })

  it('falls back to a generic name when nothing usable is left', () => {
    expect(sanitizeAttachmentFilename('')).toBe('attachment')
    expect(sanitizeAttachmentFilename('..')).toBe('attachment')
  })
})
