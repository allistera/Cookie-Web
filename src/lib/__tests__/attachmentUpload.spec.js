import { describe, expect, it, vi } from 'vitest'

import {
  attachmentPathname,
  attachmentSizeError,
  MAX_ATTACHMENT_BYTES,
  uploadAttachment,
} from '../attachmentUpload'

function fakeFile(name, size, type = 'application/pdf') {
  return { name, size, type }
}

describe('attachmentPathname', () => {
  it('places the upload under the caller prefix the API expects', () => {
    expect(attachmentPathname('user-1', 'plan.pdf')).toBe('outbound-attachments/user-1/plan.pdf')
  })

  it('keeps only the basename so a picked path cannot escape the prefix', () => {
    expect(attachmentPathname('user-1', '../../secret.pdf')).toBe(
      'outbound-attachments/user-1/secret.pdf',
    )
  })

  it('reduces awkward names to a safe object key', () => {
    expect(attachmentPathname('user-1', 'my report (final).pdf')).toBe(
      'outbound-attachments/user-1/my_report__final_.pdf',
    )
    expect(attachmentPathname('user-1', '')).toBe('outbound-attachments/user-1/attachment')
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
})

describe('uploadAttachment', () => {
  function harness({ ok = true } = {}) {
    const uploader = vi.fn(async () => ({ url: 'https://store.blob.vercel-storage.com/x.pdf' }))
    const fetchImpl = vi.fn(async () => ({
      ok,
      status: ok ? 201 : 500,
      json: async () => ({ attachment: { id: 'attachment-1', filename: 'plan.pdf' } }),
    }))
    return { uploader, fetchImpl }
  }

  const authHeaders = async (extra = {}) => ({ Authorization: 'Bearer t', ...extra })

  it('uploads privately, then registers the blob and returns the stored row', async () => {
    const { uploader, fetchImpl } = harness()

    const attachment = await uploadAttachment(fakeFile('plan.pdf', 2048), {
      userId: 'user-1',
      authHeaders,
      uploader,
      fetchImpl,
    })

    expect(uploader).toHaveBeenCalledWith(
      'outbound-attachments/user-1/plan.pdf',
      expect.anything(),
      expect.objectContaining({
        access: 'private',
        handleUploadUrl: '/api/send?resource=upload-token',
      }),
    )
    const [, options] = fetchImpl.mock.calls[0]
    expect(JSON.parse(options.body)).toEqual({
      url: 'https://store.blob.vercel-storage.com/x.pdf',
      filename: 'plan.pdf',
    })
    expect(attachment).toEqual({ id: 'attachment-1', filename: 'plan.pdf' })
  })

  it('refuses an oversized file before spending an upload token', async () => {
    const { uploader, fetchImpl } = harness()

    await expect(
      uploadAttachment(fakeFile('big.pdf', MAX_ATTACHMENT_BYTES + 1), {
        userId: 'user-1',
        authHeaders,
        uploader,
        fetchImpl,
      }),
    ).rejects.toThrow(/20MB/)
    expect(uploader).not.toHaveBeenCalled()
  })

  it('fails clearly when the mailbox has not resolved a user id yet', async () => {
    const { uploader, fetchImpl } = harness()

    await expect(
      uploadAttachment(fakeFile('plan.pdf', 10), { authHeaders, uploader, fetchImpl }),
    ).rejects.toThrow(/still loading/i)
    expect(uploader).not.toHaveBeenCalled()
  })

  it('surfaces a failed registration rather than reporting a phantom attachment', async () => {
    const { uploader, fetchImpl } = harness({ ok: false })

    await expect(
      uploadAttachment(fakeFile('plan.pdf', 10), {
        userId: 'user-1',
        authHeaders,
        uploader,
        fetchImpl,
      }),
    ).rejects.toThrow(/responded 500/)
  })
})
