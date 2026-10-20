import { toRaw } from 'vue'

import { buildReplyQuote } from './forwardEmail'

// A failed send keeps its request identity so Retry is safe after an uncertain
// network outcome. A confirmed send releases it, allowing intentional repeats.
const requestIds = new WeakMap()

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

export async function prepareMailSend(store, draft) {
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

export async function sendMail(draft) {
  const assertOwner = accountGuard(this, draft)
  assertOwner()
  if (!draft.owner && this.composeOwnerSub) draft.owner = this.composeOwnerSub
  const identity = await prepareMailSend(this, draft)
  // Persist before dispatch, including the quote as it was on the first
  // attempt. A changed original message cannot silently alter a retry.
  if (draft.recoveryId && this.persistComposerRecovery) {
    const recovery = await this.persistComposerRecovery(draft)
    if (!recovery?.durable) throw new Error('The send recovery copy could not be saved.')
  }
  assertOwner()
  const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
  assertOwner()
  const response = await fetch('/api/send', {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...identity.outgoing, requestId: identity.requestId }),
  })
  assertOwner()
  if (!response.ok) {
    const result = await response.json().catch(() => ({}))
    assertOwner()
    const error = new Error(result.error || `POST /api/send responded ${response.status}`)
    error.code = result.code
    throw error
  }
  const result = await response.json()
  assertOwner()
  requestIds
    .get(toRaw(this))
    ?.delete(JSON.stringify([this.composeOwnerSub ?? null, identity.fingerprint]))
  draft.sendIdentity = null
  if (!draft.sendAt && this.isSentLoaded) this.loadSentEmails().catch(() => {})
  return result
}
