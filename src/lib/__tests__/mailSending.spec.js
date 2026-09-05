import { afterEach, expect, it, vi } from 'vitest'
import { sendMail } from '../mailSending'

afterEach(() => vi.unstubAllGlobals())
it('reuses the identity after an uncertain failure, then permits an intentional repeat', async () => {
  const fetchMock = vi
    .fn()
    .mockRejectedValueOnce(new TypeError('Network lost'))
    .mockResolvedValue({ ok: true, json: async () => ({ id: 'provider-id' }) })
  vi.stubGlobal('fetch', fetchMock)
  const store = { authHeaders: async () => ({}) }
  const message = {
    to: 'recipient@example.com',
    subject: 'Hello',
    text: 'Same content',
    attachments: [{ id: 'attachment-id', filename: 'notes.pdf' }],
  }
  await expect(sendMail.call(store, message)).rejects.toThrow('Network lost')
  await sendMail.call(store, message)
  await sendMail.call(store, message)
  const bodies = fetchMock.mock.calls.map(([, options]) => JSON.parse(options.body))
  expect(bodies[0].attachmentIds).toEqual(['attachment-id'])
  expect(bodies[0]).not.toHaveProperty('attachments')
  expect(bodies[0].requestId).toBe(bodies[1].requestId)
  expect(bodies[2].requestId).not.toBe(bodies[1].requestId)
})
