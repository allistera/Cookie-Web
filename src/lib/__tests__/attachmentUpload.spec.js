import { describe, expect, it, vi } from 'vitest'

import { SEND_API_URL } from '../apiWorkers'
import {
  ATTACHMENTS_URL,
  attachmentSizeError,
  MAX_ATTACHMENT_BYTES,
  uploadAttachment,
} from '../attachmentUpload'

function fakeFile(name, size, type = 'application/pdf') {
  return { name, size, type }
}

function realFile(name, type = 'application/pdf') {
  return new File(['%PDF-1.4 fixture'], name, { type })
}

const authHeaders = vi.fn(async (extra = {}) => ({ Authorization: 'Bearer t', ...extra }))

function responding(status, payload) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  }))
}

describe('ATTACHMENTS_URL', () => {
  it('is the send Worker route the iOS composer also uploads to', () => {
    expect(ATTACHMENTS_URL).toBe(`${SEND_API_URL}/send/attachments`)
  })
})

describe('attachmentSizeError', () => {
  it('accepts an ordinary file', () => {
    expect(attachmentSizeError(fakeFile('plan.pdf', 1024))).toBeNull()
  })

  it('rejects an empty file and one past the ceiling', () => {
    expect(attachmentSizeError(fakeFile('empty.pdf', 0))).toMatch(/empty/i)
    expect(attachmentSizeError(fakeFile('big.pdf', MAX_ATTACHMENT_BYTES + 1))).toMatch(/20MB/)
  })

  it('rejects a pick whose size cannot be read', () => {
    expect(attachmentSizeError({ name: 'odd.pdf' })).toMatch(/could not be read/i)
    expect(attachmentSizeError(fakeFile('odd.pdf', 'NaN'))).toMatch(/could not be read/i)
  })
})

describe('uploadAttachment', () => {
  const stored = { id: 'attachment-1', filename: 'plan.pdf' }

  it('posts the file as multipart form data with only the bearer header', async () => {
    const fetchImpl = responding(201, { attachment: stored })

    const attachment = await uploadAttachment(realFile('plan.pdf'), { authHeaders, fetchImpl })

    expect(attachment).toEqual(stored)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, options] = fetchImpl.mock.calls[0]
    expect(url).toBe(`${SEND_API_URL}/send/attachments`)
    expect(options.method).toBe('POST')
    // The browser has to add the multipart boundary itself.
    expect(options.headers).toEqual({ Authorization: 'Bearer t' })
    expect(options.body).toBeInstanceOf(FormData)
    const sent = options.body.get('file')
    expect(sent).toBeInstanceOf(File)
    expect(sent.name).toBe('plan.pdf')
    expect(sent.type).toBe('application/pdf')
    expect([...options.body.keys()]).toEqual(['file'])
  })

  it('refuses an oversized file before spending an upload', async () => {
    const fetchImpl = responding(201, { attachment: stored })

    await expect(
      uploadAttachment(fakeFile('big.pdf', MAX_ATTACHMENT_BYTES + 1), { authHeaders, fetchImpl }),
    ).rejects.toThrow(/20MB/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('surfaces the Worker error message when it sends one', async () => {
    const fetchImpl = responding(429, { error: 'Too many attachment uploads, slow down' })

    await expect(
      uploadAttachment(realFile('plan.pdf'), { authHeaders, fetchImpl }),
    ).rejects.toThrow('Too many attachment uploads, slow down')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('falls back to the status when a failure has no JSON body', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => {
        throw new SyntaxError('not json')
      },
    }))

    await expect(
      uploadAttachment(realFile('plan.pdf'), { authHeaders, fetchImpl }),
    ).rejects.toThrow('POST /send/attachments responded 502')
    // One attempt only: the upload is also the registration, so a retry
    // after an ambiguous failure could store the file twice.
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('passes a network failure through', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })

    await expect(
      uploadAttachment(realFile('plan.pdf'), { authHeaders, fetchImpl }),
    ).rejects.toThrow('Failed to fetch')
  })
})
