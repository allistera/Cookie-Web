// Email attachments: the built-in folder of the Documents area that lists
// every file the mailbox received or sent. The list is read from the mail
// itself (Cookie-Worker cookie-web-messages, attachmentLibrary.js); nothing
// is copied into Documents.
import { MESSAGES_API_URL } from './apiWorkers'
import { authHeaders } from './authHeaders'
import { jsonRequest } from './jsonRequest'

// Stands in for a folder id in /documents?folder=. Real folder ids are UUIDs,
// so it cannot collide with one.
export const EMAIL_ATTACHMENTS_FOLDER = 'email-attachments'
export const EMAIL_ATTACHMENTS_TITLE = 'Email attachments'
export const EMAIL_ATTACHMENTS_ROUTE = {
  path: '/documents',
  query: { folder: EMAIL_ATTACHMENTS_FOLDER },
}

// One page, newest first. `direction` is 'received', 'sent' or anything else
// for both; `embedded` also lists the pictures that belong to an email's
// body; `before` is the previous page's nextCursor.
export async function fetchEmailAttachments({ direction, embedded = false, before = '' } = {}) {
  const query = new URLSearchParams()
  if (direction === 'received' || direction === 'sent') query.set('direction', direction)
  if (embedded) query.set('embedded', '1')
  if (before) query.set('before', before)
  const suffix = query.size ? `?${query}` : ''
  const data = await jsonRequest(`${MESSAGES_API_URL}/messages/attachments${suffix}`, {
    headers: await authHeaders(),
  })
  return {
    attachments: Array.isArray(data?.attachments) ? data.attachments : [],
    nextCursor: data?.nextCursor ? String(data.nextCursor) : null,
  }
}

// The attachment's date, or null when it has none that can be read. A missing
// date must not become 1 January 1970, which is what new Date(null) gives.
export function attachmentDate(attachment) {
  if (!attachment?.date) return null
  const date = new Date(attachment.date)
  return Number.isNaN(date.getTime()) ? null : date
}

const MONTH_FMT = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' })

// Consecutive attachments of the same calendar month, in the order given
// (the server sends newest first), each group under a "November 2026"
// heading. An attachment without a usable date goes under "Undated".
export function groupAttachmentsByMonth(attachments) {
  const groups = []
  for (const attachment of attachments) {
    const date = attachmentDate(attachment)
    const key = date ? `${date.getFullYear()}-${date.getMonth()}` : 'undated'
    const last = groups[groups.length - 1]
    if (last?.key === key) last.attachments.push(attachment)
    else {
      groups.push({
        key,
        label: date ? MONTH_FMT.format(date) : 'Undated',
        attachments: [attachment],
      })
    }
  }
  return groups
}

// The line under a file's name: who it came from or went to, then the
// subject of its email.
export function attachmentSummary(attachment) {
  return [correspondentLabel(attachment), attachment.subject || '(no subject)']
    .filter(Boolean)
    .join(' · ')
}

// "From Northwind Billing", "To Sam Carter and 2 others", or nothing when the
// mail names nobody.
export function correspondentLabel(attachment) {
  const person = attachment.correspondent
  if (!person) return ''
  const name = person.name || person.address
  const others = Number(person.others) || 0
  const rest = others === 0 ? '' : others === 1 ? ' and 1 other' : ` and ${others} others`
  return `${attachment.direction === 'sent' ? 'To' : 'From'} ${name}${rest}`
}

// The attachment's email in the shape the inbox store opens (the raw row of
// GET /emails), so the reader can show it straight from this list.
export function attachmentEmailRow(attachment) {
  const person = attachment.correspondent
  const sent = attachment.direction === 'sent'
  return {
    id: attachment.messageId,
    from_name: sent ? null : (person?.name ?? null),
    from_address: sent ? null : (person?.address ?? null),
    recipients: {
      to: sent && person ? [{ name: person.name ?? null, address: person.address }] : [],
    },
    subject: attachment.subject,
    sent_at: attachment.date,
    is_sent: sent,
    is_unread: Boolean(attachment.unread),
    is_starred: Boolean(attachment.starred),
    is_archived: Boolean(attachment.archived),
    has_html: true,
    has_attachments: true,
  }
}
