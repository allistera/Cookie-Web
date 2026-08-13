import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createHandler, privateBlobPathname } from '../messages.js'

const issueSignedToken = vi.fn(async () => ({
  clientSigningToken: 'client-signing-token',
  delegationToken: 'delegation-token',
  validUntil: Date.now() + 300_000,
}))
const presignUrl = vi.fn(async () => ({
  presignedUrl: 'https://store.private.blob.vercel-storage.com/mail-attachments/hash/0?signed=1',
}))
const getDownloadUrl = vi.fn((url) => `${url}&download=1`)

let sqlRows = []

const handler = createHandler({
  verifyAccessToken: vi.fn(async () => ({ email: 'owner@example.com' })),
  captureApiError: vi.fn(async () => undefined),
  getSql: () => () => Promise.resolve(sqlRows),
  issueSignedToken,
  presignUrl,
  getDownloadUrl,
})

const ATTACHMENT_ID = '22222222-2222-4222-8222-222222222222'

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

function get(id = ATTACHMENT_ID) {
  return {
    method: 'GET',
    url: `/api/messages?resource=attachment&id=${id}`,
    headers: {},
  }
}

describe('GET /api/messages?resource=attachment', () => {
  beforeEach(() => {
    sqlRows = []
    vi.clearAllMocks()
  })

  it('issues a short-lived private download URL for an owned attachment', async () => {
    sqlRows = [
      {
        filename: 'plan.pdf',
        content_type: 'application/pdf',
        blob_url: 'https://store.private.blob.vercel-storage.com/mail-attachments/hash/0',
      },
    ]
    const res = makeRes()

    await handler(get(), res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({
      url: 'https://store.private.blob.vercel-storage.com/mail-attachments/hash/0?signed=1&download=1',
      filename: 'plan.pdf',
      contentType: 'application/pdf',
    })
    expect(issueSignedToken).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: 'mail-attachments/hash/0', operations: ['get'] }),
    )
    expect(presignUrl).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ access: 'private', operation: 'get' }),
    )
  })

  it('returns 404 for legacy metadata-only attachments', async () => {
    sqlRows = [{ filename: 'old.pdf', content_type: 'application/pdf', blob_url: null }]
    const res = makeRes()

    await handler(get(), res)

    expect(res.statusCode).toBe(404)
    expect(res.body.error).toBe('Attachment is not available')
  })

  it('rejects malformed attachment ids', async () => {
    const res = makeRes()

    await handler(get('not-an-id'), res)

    expect(res.statusCode).toBe(400)
  })
})

describe('privateBlobPathname', () => {
  it('accepts only private Vercel Blob URLs', () => {
    expect(
      privateBlobPathname(
        'https://store.private.blob.vercel-storage.com/mail-attachments/hash/0',
      ),
    ).toBe('mail-attachments/hash/0')
    expect(() => privateBlobPathname('https://example.com/file')).toThrow(/private Blob/u)
  })
})
