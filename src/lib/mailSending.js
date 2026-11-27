import { toRaw } from 'vue'

import { SEND_API_URL } from './apiWorkers'
import { buildReplyQuote } from './forwardEmail'
import { parseRecipients } from './recipients'

// A failed send keeps its request identity so Retry is safe after an uncertain
// network outcome. A confirmed send releases it, allowing intentional repeats.
const requestIds = new WeakMap()
// How long a send waits for the Worker before treating delivery as pending.
const SEND_TIMEOUT_MS = 25_000

function accountGuard(store, draft) {
  const owner = store.composeOwnerSub
  const generation = store.composeGeneration
  return () => {
    if (
      (draft.owner && draft.owner !== owner) ||
      store.composeOwnerSub !== owner ||
      store.composeGeneration !== generation
    ) {
      const error = new Error('The account changed. Open this draft in its original account.')
      error.code = 'ACCOUNT_CHANGED'
      throw error
    }
  }
}

// The message being answered, quoted below the reply. Its sender and date
// come from the thread row the body API returns (the list row may not be
// loaded, e.g. a reply drafted from AI Today). A body that cannot be loaded
// leaves the reply unquoted rather than blocking the send.
async function replyQuoteFor(store, replyToMessageId) {
  let body = null
  try {
    body = await store.fetchMessageBody(replyToMessageId)
  } catch (error) {
    console.error('Could not load the original message to quote:', error)
  }
  if (!body) return null
  const row = body.thread?.find((entry) => entry.id === replyToMessageId)
  const listed = store.emailById?.(replyToMessageId)
  return buildReplyQuote({
    sender: row ? row.from_name || row.from_address : listed?.sender,
    address: row ? row.from_address : listed?.address,
    sentAt: row?.sent_at ?? listed?.sentAt,
    text: body.text,
    html: body.html,
  })
}

async function prepareMailSend(store, draft) {
  const assertAccount = accountGuard(store, draft)
  assertAccount()
  // Recovery metadata stays in this browser. Only the API contract enters
  // the fingerprint and the persisted, frozen provider request.
  const message = {}
  for (const field of [
    'to',
    'subject',
    'text',
    'html',
    'replyToMessageId',
    'followUpAt',
    'sendAt',
  ]) {
    if (draft[field] !== undefined) message[field] = draft[field]
  }
  // Cc and Bcc are named only when someone is on them, so a message without
  // copies keeps the fingerprint (and the saved send identity) it had before
  // these lines existed.
  for (const field of ['cc', 'bcc']) {
    const line = parseRecipients(draft[field]).join(', ')
    if (line) message[field] = line
  }
  const attachments = draft.attachments ?? []
  if (attachments.length) message.attachmentIds = attachments.map(({ id }) => id)
  if (!requestIds.has(toRaw(store))) requestIds.set(toRaw(store), new Map())
  const requests = requestIds.get(toRaw(store))
  const fingerprint = JSON.stringify(message)
  const cacheKey = JSON.stringify([store.composeOwnerSub ?? null, fingerprint])
  const previous = draft.sendIdentity ?? requests.get(cacheKey)
  if (previous) {
    if (previous.fingerprint !== fingerprint) {
      const error = new Error('Confirm the previous delivery before sending an edited copy.')
      error.code = 'DELIVERY_CONFLICT'
      throw error
    }
    draft.sendIdentity = previous
    return previous
  }
  const quote = message.replyToMessageId
    ? await replyQuoteFor(store, message.replyToMessageId)
    : null
  assertAccount()
  // Re-check after the async quote lookup so concurrent sends of the same
  // reply cannot mint two distinct requestIds.
  const existing = draft.sendIdentity ?? requests.get(cacheKey)
  if (existing && existing.fingerprint === fingerprint) {
    draft.sendIdentity = existing
    return existing
  }
  const outgoing = quote
    ? {
        ...message,
        text: `${message.text ?? ''}${quote.text}`,
        html: message.html ? `${message.html}${quote.html}` : message.html,
      }
    : message
  const identity = { requestId: crypto.randomUUID(), fingerprint, outgoing }
  draft.sendIdentity = identity
  requests.set(cacheKey, identity)
  return identity
}

function releaseIdentity(store, ownerSub, draft, identity) {
  requestIds.get(toRaw(store))?.delete(JSON.stringify([ownerSub ?? null, identity.fingerprint]))
  if (draft.sendIdentity === identity) draft.sendIdentity = null
}

export async function sendMail(draft) {
  const ownerSub = this.composeOwnerSub ?? null
  const assertOwner = accountGuard(this, draft)
  assertOwner()
  if (!draft.owner && this.composeOwnerSub) draft.owner = this.composeOwnerSub
  const hadIdentity = Boolean(draft.sendIdentity)
  const identity = await prepareMailSend(this, draft)
  // Persist before dispatch, including the quote as it was on the first
  // attempt. A changed original message cannot silently alter a retry.
  if (draft.recoveryId && this.persistComposerRecovery) {
    let recovery
    try {
      recovery = await this.persistComposerRecovery(draft)
    } catch (error) {
      if (!hadIdentity) releaseIdentity(this, ownerSub, draft, identity)
      throw error
    }
    if (!recovery?.durable) {
      if (!hadIdentity) releaseIdentity(this, ownerSub, draft, identity)
      throw new Error('The send recovery copy could not be saved.')
    }
  }
  assertOwner()
  let headers
  try {
    headers = await this.authHeaders({ 'Content-Type': 'application/json' })
  } catch (error) {
    if (!hadIdentity) releaseIdentity(this, ownerSub, draft, identity)
    throw error
  }
  assertOwner()
  let response
  try {
    response = await fetch(`${SEND_API_URL}/send`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...identity.outgoing, requestId: identity.requestId }),
      redirect: 'error',
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    })
  } catch {
    // No answer, so the mail may or may not have gone. The identity is kept
    // and a retry of the unchanged message asks the Worker again.
    const error = new Error(
      'Delivery confirmation is unavailable. Retry the same unchanged message.',
    )
    error.code = 'DELIVERY_PENDING'
    throw error
  }
  if (!response.ok) {
    const result = await response.json().catch(() => ({}))
    // Deterministic 4xx rejections (excluding delivery uncertainty codes) mean
    // the server refused the message before delivery; release the identity so
    // the user can edit and resend instead of hitting a permanent lockout. A
    // provider rejection is final whatever its status: retrying the same
    // request would only replay it. DELIVERY_NOT_SENT (503) keeps the identity
    // so its retry stays idempotent.
    const uncertainCodes = new Set(['DELIVERY_PENDING', 'DELIVERY_UNCERTAIN', 'DELIVERY_CONFLICT'])
    const released =
      result.code === 'DELIVERY_REJECTED' ||
      (response.status >= 400 && response.status < 500 && !uncertainCodes.has(result.code))
    if (released) releaseIdentity(this, ownerSub, draft, identity)
    assertOwner()
    const error = new Error(result.error || `POST /send responded ${response.status}`)
    error.code = result.code
    // The message may be edited and sent again as a new request.
    error.released = released
    throw error
  }
  // Release the consumed requestId before assertOwner() so an account switch
  // during delivery never strands a spent identity in requestIds.
  releaseIdentity(this, ownerSub, draft, identity)
  assertOwner()
  const result = await response.json()
  assertOwner()
  if (!draft.sendAt && this.isSentLoaded) this.loadSentEmails().catch(() => {})
  return result
}
