// Senders retry deliveries, and some mail lacks a Message-ID header. Those
// messages get a deterministic synthetic ID so retries still dedupe.
export async function syntheticMessageId({ from, to, date, subject, bodyPrefix }) {
  const input = [from, to, date, subject, bodyPrefix].map((part) => part ?? '').join('|')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
  return `<synthetic-${hex}@mail-app-ingest>`
}
