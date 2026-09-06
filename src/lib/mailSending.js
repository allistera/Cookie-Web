import { toRaw } from 'vue'
// A failed send keeps its request identity so Retry is safe after an uncertain
// network outcome. A confirmed send releases it, allowing intentional repeats.
const requestIds = new WeakMap()
export async function sendMail({ attachments = [], ...message }) {
  if (attachments.length) message.attachmentIds = attachments.map(({ id }) => id)
  if (!requestIds.has(toRaw(this))) requestIds.set(toRaw(this), new Map())
  const requests = requestIds.get(toRaw(this))
  const key = JSON.stringify(message)
  const requestId = requests.get(key) ?? crypto.randomUUID()
  requests.set(key, requestId)
  const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
  const response = await fetch('/api/send', {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...message, requestId }),
  })
  if (!response.ok) throw new Error(`POST /api/send responded ${response.status}`)
  const result = await response.json()
  requests.delete(key)
  if (!message.sendAt && this.isSentLoaded) this.loadSentEmails().catch(() => {})
  return result
}
