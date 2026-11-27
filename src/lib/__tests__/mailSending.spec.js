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
  await expect(sendMail.call(store, message)).rejects.toMatchObject({ code: 'DELIVERY_PENDING' })
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

it('persists a frozen request before dispatch and reuses it after a reload', async () => {
  let recovered
  const store = {
    ...replyStore({ text: 'Original', html: '<p>Original</p>' }),
    composeOwnerSub: 'account',
    persistComposerRecovery: vi.fn(async (draft) => {
      recovered = JSON.parse(JSON.stringify(draft))
      return { durable: true }
    }),
  }
  const fetchMock = vi.fn(async () => {
    expect(recovered.sendIdentity.requestId).toBeTruthy()
    throw new TypeError('Network lost')
  })
  vi.stubGlobal('fetch', fetchMock)
  const draft = {
    owner: 'account',
    recoveryId: 'recovery',
    to: 'alex@example.com',
    subject: 'Re: Hi',
    text: 'Reply',
    replyToMessageId: REPLY_TO,
  }
  await expect(sendMail.call(store, draft)).rejects.toMatchObject({ code: 'DELIVERY_PENDING' })
  const firstBody = fetchMock.mock.calls[0][1].body
  const reloadedStore = {
    ...store,
    fetchMessageBody: vi.fn(async () => ({ text: 'Different original' })),
  }
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'provider-id' }) })
  await sendMail.call(reloadedStore, recovered)
  expect(fetchMock.mock.calls[1][1].body).toBe(firstBody)
  expect(reloadedStore.fetchMessageBody).not.toHaveBeenCalled()
  expect(JSON.parse(firstBody)).not.toHaveProperty('sendIdentity')
  expect(JSON.parse(firstBody)).not.toHaveProperty('owner')
})

it('does not mint a new request when an unresolved recovered draft has been edited', async () => {
  const fetchMock = vi.fn().mockRejectedValue(new TypeError('Network lost'))
  vi.stubGlobal('fetch', fetchMock)
  const store = { authHeaders: async () => ({}) }
  const draft = { to: 'a@example.com', subject: 'Hi', text: 'First' }
  await expect(sendMail.call(store, draft)).rejects.toMatchObject({ code: 'DELIVERY_PENDING' })
  draft.text = 'Changed'
  await expect(sendMail.call(store, draft)).rejects.toMatchObject({ code: 'DELIVERY_CONFLICT' })
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

it('does not send when recovery storage fails or the account changes during authentication', async () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  const store = {
    composeOwnerSub: 'account',
    persistComposerRecovery: async () => ({ durable: false }),
    authHeaders: async () => ({}),
  }
  const draft = {
    owner: 'account',
    recoveryId: 'recovery',
    to: 'a@example.com',
    subject: 'Hi',
    text: 'Body',
  }
  await expect(sendMail.call(store, draft)).rejects.toThrow('recovery copy')
  store.persistComposerRecovery = async () => ({ durable: true })
  store.authHeaders = async () => {
    store.composeOwnerSub = 'other'
    return {}
  }
  await expect(sendMail.call(store, draft)).rejects.toThrow('account changed')
  expect(fetchMock).not.toHaveBeenCalled()
})

it('preserves structured uncertainty errors and the original send identity', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ code: 'DELIVERY_UNCERTAIN', error: 'Delivery needs confirmation' }),
    }),
  )
  const draft = { to: 'a@example.com', subject: 'Hi', text: 'Body' }
  await expect(sendMail.call({ authHeaders: async () => ({}) }, draft)).rejects.toMatchObject({
    code: 'DELIVERY_UNCERTAIN',
  })
  expect(draft.sendIdentity.requestId).toBeTruthy()
})

it('scopes ownerless retry caches to the account and abandons quotes loaded across account changes', async () => {
  const fetchMock = vi.fn().mockRejectedValue(new TypeError('Network lost'))
  vi.stubGlobal('fetch', fetchMock)
  const store = { authHeaders: async () => ({}), composeOwnerSub: 'first' }
  const message = { to: 'a@example.com', subject: 'Hi', text: 'Body' }
  await expect(sendMail.call(store, { ...message })).rejects.toMatchObject({
    code: 'DELIVERY_PENDING',
  })
  store.composeOwnerSub = 'second'
  await expect(sendMail.call(store, { ...message })).rejects.toMatchObject({
    code: 'DELIVERY_PENDING',
  })
  const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body))
  expect(bodies[0].requestId).not.toBe(bodies[1].requestId)

  store.fetchMessageBody = async () => {
    store.composeOwnerSub = 'third'
    return { text: 'Private original' }
  }
  const draft = { ...message, replyToMessageId: REPLY_TO }
  await expect(sendMail.call(store, draft)).rejects.toMatchObject({ code: 'ACCOUNT_CHANGED' })
  expect(draft.sendIdentity).toBeUndefined()
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

it('sends the Cc and Bcc lines only when someone is on them', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
  vi.stubGlobal('fetch', fetchMock)
  const store = { authHeaders: async () => ({}) }
  const message = { to: 'recipient@example.com', subject: 'Hello', text: 'Body' }

  await sendMail.call(store, { ...message, cc: 'dana@example.com,  sam@example.com, ', bcc: ' ' })
  await sendMail.call(store, { ...message, cc: '', bcc: 'finance@example.com' })
  await sendMail.call(store, { ...message, cc: ', ', bcc: '' })

  const bodies = fetchMock.mock.calls.map(([, options]) => JSON.parse(options.body))
  expect(bodies[0].cc).toBe('dana@example.com, sam@example.com')
  expect(bodies[0]).not.toHaveProperty('bcc')
  expect(bodies[1].bcc).toBe('finance@example.com')
  expect(bodies[1]).not.toHaveProperty('cc')
  expect(bodies[2]).not.toHaveProperty('cc')
  expect(bodies[2]).not.toHaveProperty('bcc')
})

function failedSend(status, code) {
  return { ok: false, status, json: async () => ({ error: 'Not sent', code }) }
}

it.each([422, 503])(
  'releases the identity when the provider rejects the email (status %i)',
  async (status) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(failedSend(status, 'DELIVERY_REJECTED'))
      .mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    const store = { authHeaders: async () => ({}) }
    const draft = { to: 'typo@example.con', subject: 'Hello', text: 'Body' }

    await expect(sendMail.call(store, draft)).rejects.toMatchObject({ code: 'DELIVERY_REJECTED' })
    expect(draft.sendIdentity).toBeNull()

    draft.to = 'right@example.com'
    await sendMail.call(store, draft)
    const bodies = fetchMock.mock.calls.map(([, options]) => JSON.parse(options.body))
    expect(bodies[1].to).toBe('right@example.com')
    expect(bodies[1].requestId).not.toBe(bodies[0].requestId)
  },
)

it('keeps the identity when nothing reached the provider, so the retry is the same request', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(failedSend(503, 'DELIVERY_NOT_SENT'))
    .mockResolvedValue({ ok: true, json: async () => ({}) })
  vi.stubGlobal('fetch', fetchMock)
  const store = { authHeaders: async () => ({}) }
  const draft = { to: 'recipient@example.com', subject: 'Hello', text: 'Body' }

  await expect(sendMail.call(store, draft)).rejects.toMatchObject({ code: 'DELIVERY_NOT_SENT' })
  expect(draft.sendIdentity).toBeTruthy()
  await expect(sendMail.call(store, { ...draft, text: 'Edited' })).rejects.toMatchObject({
    code: 'DELIVERY_CONFLICT',
  })

  await sendMail.call(store, draft)
  const bodies = fetchMock.mock.calls.map(([, options]) => JSON.parse(options.body))
  expect(bodies[1].requestId).toBe(bodies[0].requestId)
})

// The send Worker's error contract (Cookie-Worker docs/delivery-and-search-recovery.md,
// "Send error contract"). Release frees the request id so the message can be
// edited and sent as a new request; retry and surface keep it, so the only
// way forward is the same unchanged request.
const SEND_ERROR_CONTRACT = [
  [422, 'DELIVERY_REJECTED', 'release'],
  [503, 'DELIVERY_NOT_SENT', 'retry'],
  [503, 'DELIVERY_PENDING', 'retry'],
  [502, 'DELIVERY_PENDING', 'retry'],
  [409, 'DELIVERY_UNCERTAIN', 'surface'],
  [409, 'DELIVERY_CONFLICT', 'surface'],
  [409, 'DELIVERY_REQUEST_ID_REQUIRED', 'release'],
  [403, 'SEND_CONFIRMATION_REQUIRED', 'release'],
  [503, 'SEND_CONFIRMATION_UNAVAILABLE', 'retry'],
  [400, undefined, 'release'],
  [401, undefined, 'release'],
  [403, undefined, 'release'],
  [404, undefined, 'release'],
  [413, undefined, 'release'],
  [415, undefined, 'release'],
  [429, undefined, 'release'],
  [500, undefined, 'retry'],
  [502, undefined, 'retry'],
  [503, undefined, 'retry'],
]

it.each(SEND_ERROR_CONTRACT)(
  'follows the contract for %i %s (%s)',
  async (status, code, action) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(failedSend(status, code))
      .mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    const store = { authHeaders: async () => ({}) }
    const draft = { to: 'recipient@example.com', subject: 'Hello', text: 'Body' }

    const error = await sendMail.call(store, draft).catch((caught) => caught)
    const kept = action !== 'release'
    expect(error).toMatchObject({ code, released: !kept })
    expect(Boolean(draft.sendIdentity)).toBe(kept)

    // Sending again is the same request only while the identity is kept.
    await sendMail.call(store, draft)
    const bodies = fetchMock.mock.calls.map(([, options]) => JSON.parse(options.body))
    expect(bodies[1].requestId === bodies[0].requestId).toBe(kept)
  },
)
