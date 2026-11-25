// Subscriptions lists the senders whose mail carries a List-Unsubscribe
// header, one row per sender, and unsubscribes from a sender through the
// newest of their mail (Cookie-Worker cookie-web-messages, subscriptions.js).
import { MESSAGES_API_URL } from './apiWorkers'
import { authHeaders } from './authHeaders'
import { isSafeUnsubscribeUrl } from './isSafeUnsubscribeUrl'
import { jsonRequest } from './jsonRequest'
import { parseMailto } from './unsubscribeContent'

export async function fetchSubscriptions() {
  const data = await jsonRequest(`${MESSAGES_API_URL}/messages/subscriptions`, {
    headers: await authHeaders(),
  })
  return Array.isArray(data?.subscriptions) ? data.subscriptions : []
}

// Asks the server to unsubscribe through the sender's newest list message.
// Resolves to { status: 'unsubscribed' } when the sender confirmed it,
// { status: 'manual', href } when the person has to finish on the sender's
// page (or by sending the unsubscribe mail themselves), and
// { status: 'failed' } when the sender offers nothing usable. The targets
// come from sender-controlled headers, so each passes the same checks as in
// the reader before it can become a link.
export async function unsubscribeFromSender(subscription) {
  const result = await jsonRequest(`${MESSAGES_API_URL}/messages`, {
    method: 'POST',
    headers: await authHeaders({ 'Content-Type': 'application/json' }),
    body: { id: subscription.messageId, action: 'unsubscribe', allow_ai: true },
    // Slightly longer than the server's three-minute budget for working
    // through a sender's page, so the server's verdict decides the outcome.
    signal: AbortSignal.timeout(190_000),
  })
  if (result?.status === 'unsubscribed') return { status: 'unsubscribed' }
  if (isSafeUnsubscribeUrl(result?.url)) return { status: 'manual', href: result.url }
  const mailto = parseMailto(result?.mailto)
  return mailto ? { status: 'manual', href: mailto.href } : { status: 'failed' }
}

// Mail that arrived after the unsubscribe means the sender has not stopped
// (yet): the row offers Unsubscribe again.
export function isStillSending(subscription) {
  if (!subscription.unsubscribedAt) return false
  return (
    new Date(subscription.lastReceivedAt).getTime() >
    new Date(subscription.unsubscribedAt).getTime()
  )
}
