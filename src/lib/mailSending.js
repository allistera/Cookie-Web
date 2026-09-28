import { toRaw } from 'vue'

import { buildReplyQuote } from './forwardEmail'

// A failed send keeps its request identity so Retry is safe after an uncertain
// network outcome. A confirmed send releases it, allowing intentional repeats.
const requestIds = new WeakMap()

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

export async function sendMail({ attachments = [], ...message }) {
  if (attachments.length) message.attachmentIds = attachments.map(({ id }) => id)
  if (!requestIds.has(toRaw(this))) requestIds.set(toRaw(this), new Map())
  const requests = requestIds.get(toRaw(this))
  const key = JSON.stringify(message)
  const requestId = requests.get(key) ?? crypto.randomUUID()
  requests.set(key, requestId)
  const quote = message.replyToMessageId
    ? await replyQuoteFor(this, message.replyToMessageId)
    : null
  const outgoing = quote
    ? {
        ...message,
        text: `${message.text ?? ''}${quote.text}`,
        html: message.html ? `${message.html}${quote.html}` : message.html,
      }
    : message
  const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
  const response = await fetch('/api/send', {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...outgoing, requestId }),
  })
  if (!response.ok) throw new Error(`POST /api/send responded ${response.status}`)
  const result = await response.json()
  requests.delete(key)
  if (!message.sendAt && this.isSentLoaded) this.loadSentEmails().catch(() => {})
  return result
}
