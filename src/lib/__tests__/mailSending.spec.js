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

const REPLY_TO = '11111111-1111-1111-1111-111111111111'

function replyStore(body) {
  return {
    authHeaders: async () => ({}),
    fetchMessageBody: vi.fn(async () => body),
    emailById: () => null,
  }
}

it('quotes the message being replied to below the reply', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
  vi.stubGlobal('fetch', fetchMock)
  const store = replyStore({
    text: 'Can we meet?',
    html: '<p>Can we meet?</p>',
    thread: [
      {
        id: REPLY_TO,
        from_name: 'Alex',
        from_address: 'alex@example.com',
        sent_at: '2026-09-01T10:30:00.000Z',
      },
    ],
  })

  await sendMail.call(store, {
    to: 'alex@example.com',
    subject: 'Re: Meeting',
    text: 'Yes, Tuesday works.',
    html: '<p>Yes, Tuesday works.</p>',
    replyToMessageId: REPLY_TO,
  })

  expect(store.fetchMessageBody).toHaveBeenCalledWith(REPLY_TO)
  const sent = JSON.parse(fetchMock.mock.calls[0][1].body)
  expect(sent.text).toMatch(
    /^Yes, Tuesday works\.\n\nOn .+, Alex <alex@example\.com> wrote:\n> Can we meet\?$/,
  )
  expect(sent.html.startsWith('<p>Yes, Tuesday works.</p><div class="cookie-reply-quote">')).toBe(
    true,
  )
  expect(sent.html).toContain('<blockquote type="cite"')
  expect(sent.html).toContain('<p>Can we meet?</p></blockquote>')
})

it('still sends the reply, unquoted, when the original cannot be loaded', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
  vi.stubGlobal('fetch', fetchMock)

  await sendMail.call(replyStore(null), {
    to: 'alex@example.com',
    subject: 'Re: Meeting',
    text: 'Yes.',
    html: '<p>Yes.</p>',
    replyToMessageId: REPLY_TO,
  })

  const sent = JSON.parse(fetchMock.mock.calls[0][1].body)
  expect(sent.text).toBe('Yes.')
  expect(sent.html).toBe('<p>Yes.</p>')
})
