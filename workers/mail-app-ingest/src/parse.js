import PostalMime from 'postal-mime'

import { syntheticMessageId } from './synthetic-id.js'

// Bodies are stored inline in Postgres, capped per spec. Attachment blobs are
// not stored at all in v1 — only metadata. R2 upload would hook in where
// attachment metadata is collected below.
const BODY_CAP_BYTES = 512 * 1024
const SNIPPET_LENGTH = 100

// postal-mime Address entries are mailboxes ({name, address}) or groups
// ({name, group: [...]}) — flatten to a plain mailbox list.
function flattenAddresses(addresses) {
  const out = []
  for (const entry of addresses ?? []) {
    if (entry.group) {
      out.push(...flattenAddresses(entry.group))
    } else {
      out.push({ name: entry.name || null, address: entry.address || null })
    }
  }
  return out
}

function capBody(text) {
  if (text == null) return { text: null, truncated: false }
  const bytes = new TextEncoder().encode(text)
  if (bytes.length <= BODY_CAP_BYTES) return { text, truncated: false }
  const sliced = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, BODY_CAP_BYTES))
  // Drop a possible partial trailing code point produced by the byte slice.
  return { text: sliced.replace(/�+$/, ''), truncated: true }
}

// Minimal HTML → text for mail with no text/plain part: body_text drives both
// the UI rendering and the messages.search tsvector, so it must never be null
// when the message had any content.
export function htmlToText(html) {
  if (!html) return null
  const text = html
    .replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text || null
}

function makeSnippet(text) {
  const collapsed = (text ?? '').replace(/\s+/g, ' ').trim()
  if (!collapsed) return ''
  if (collapsed.length <= SNIPPET_LENGTH) return collapsed
  return `${collapsed.slice(0, SNIPPET_LENGTH).trimEnd()}...`
}

// message: ForwardableEmailMessage (or a test fake with the same shape).
// Returns the normalized record src/store.js persists.
export async function parseEmail(message) {
  const email = await PostalMime.parse(message.raw)

  const bodyText = capBody(email.text ?? htmlToText(email.html))
  const bodyHtml = capBody(email.html ?? null)

  const messageId =
    email.messageId ||
    (await syntheticMessageId({
      from: message.from,
      to: message.to,
      date: email.date,
      subject: email.subject,
      bodyPrefix: (email.text ?? email.html ?? '').slice(0, 1024),
    }))

  const sentAt = email.date && !Number.isNaN(Date.parse(email.date)) ? new Date(email.date) : new Date()

  const from = flattenAddresses(email.from ? [email.from] : [])[0] ?? { name: null, address: null }

  return {
    messageId,
    subject: email.subject ?? null,
    fromName: from.name,
    // from_address is NOT NULL in the schema; the envelope sender always exists.
    fromAddress: from.address ?? message.from,
    recipients: {
      to: flattenAddresses(email.to),
      cc: flattenAddresses(email.cc),
      bcc: flattenAddresses(email.bcc),
    },
    snippet: makeSnippet(bodyText.text),
    bodyText: bodyText.text,
    bodyHtml: bodyHtml.text,
    truncated: bodyText.truncated || bodyHtml.truncated,
    headers: email.headers ?? [],
    attachments: (email.attachments ?? []).map((a) => ({
      filename: a.filename ?? null,
      mime_type: a.mimeType ?? null,
      size:
        typeof a.content === 'string'
          ? new TextEncoder().encode(a.content).length
          : (a.content?.byteLength ?? 0),
    })),
    rawSize: message.rawSize,
    envelopeFrom: message.from,
    envelopeTo: message.to,
    sentAt,
  }
}
