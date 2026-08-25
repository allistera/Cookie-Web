// Helpers for the composer "to" field, which holds a comma-separated list of
// recipient addresses (send to several people by adding a comma).

// The trimmed, non-empty addresses in the field.
export function parseRecipients(value) {
  return (value || '')
    .split(',')
    .map((address) => address.trim())
    .filter(Boolean)
}

// Mirrors api/send.js's MAX_OUTBOUND_RECIPIENTS so an over-long list disables
// Send immediately instead of failing after the undo countdown.
export const MAX_RECIPIENTS = 20

// True when there are 1–20 recipients and every one looks like an address.
export function recipientsValid(value) {
  const list = parseRecipients(value)
  return (
    list.length > 0 &&
    list.length <= MAX_RECIPIENTS &&
    list.every((address) => address.includes('@'))
  )
}

// The address fragment the user is currently typing (after the last comma).
export function currentRecipientToken(value) {
  const text = value || ''
  return text.slice(text.lastIndexOf(',') + 1).trim()
}

// Addresses already committed before the current token.
export function completedRecipients(value) {
  const text = value || ''
  const idx = text.lastIndexOf(',')
  if (idx === -1) return []
  return text
    .slice(0, idx)
    .split(',')
    .map((address) => address.trim())
    .filter(Boolean)
}

// Replaces the current token with a chosen address and readies the next one,
// so an auto-suggest pick appends rather than overwriting earlier recipients.
export function appendRecipient(value, address) {
  const text = value || ''
  const idx = text.lastIndexOf(',')
  const head = idx === -1 ? '' : `${text.slice(0, idx + 1)} `
  return `${head}${address}, `
}
