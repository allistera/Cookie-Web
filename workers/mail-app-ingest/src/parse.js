import PostalMime from 'postal-mime'

import { syntheticMessageId } from './synthetic-id.js'

// Bodies are stored inline in Postgres, capped per spec. Attachment blobs are
// not stored at all in v1 — only metadata. R2 upload would hook in where
// attachment metadata is collected below.
const BODY_CAP_BYTES = 512 * 1024
const SNIPPET_LENGTH = 100

// Header/attachment metadata is attacker-controlled and lands in jsonb —
// bound everything so a crafted message can't bloat rows or burn the store
// budget.
const MAX_HEADERS = 100
const MAX_HEADER_VALUE = 2048
const MAX_ATTACHMENTS_META = 100
const MAX_REFERENCES = 50
// btree index tuples cap out around 2.7 KB; RFC 5322 lines at 998.
const MAX_MESSAGE_ID = 998
// A spoofed far-future Date header would otherwise pin its thread to the top
// of the inbox forever via last_message_at.
const MAX_FUTURE_MS = 24 * 60 * 60 * 1000

// Postgres text/jsonb reject U+0000 outright.
function stripNul(value) {
  return value == null ? value : String(value).replaceAll('\u0000', '')
}

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
  const sliced = new TextDecoder('utf-8').decode(bytes.slice(0, BODY_CAP_BYTES))
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

// Message-IDs from In-Reply-To/References, used to attach replies to an
// existing thread.
function extractReferences(email) {
  const raw = `${email.inReplyTo ?? ''} ${email.references ?? ''}`
  return [...new Set(raw.match(/<[^>]+>/g) ?? [])].slice(0, MAX_REFERENCES)
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

  const bodyText = capBody(stripNul(email.text ?? htmlToText(email.html)))
  const bodyHtml = capBody(stripNul(email.html ?? null))

  const headerMessageId = stripNul(email.messageId)
  const messageId =
    headerMessageId && headerMessageId.length <= MAX_MESSAGE_ID
      ? headerMessageId
      : await syntheticMessageId({
          from: message.from,
          to: message.to,
          date: email.date,
          subject: email.subject,
          bodyPrefix: (email.text ?? email.html ?? '').slice(0, 1024),
        })

  let sentAt = email.date && !Number.isNaN(Date.parse(email.date)) ? new Date(email.date) : new Date()
  if (sentAt.getTime() > Date.now() + MAX_FUTURE_MS) sentAt = new Date()

  const from = flattenAddresses(email.from ? [email.from] : [])[0] ?? { name: null, address: null }

  return {
    messageId,
    subject: stripNul(email.subject) ?? null,
    fromName: stripNul(from.name),
    // from_address is NOT NULL in the schema; the envelope sender always exists.
    fromAddress: stripNul(from.address) ?? message.from,
    recipients: {
      to: flattenAddresses(email.to),
      cc: flattenAddresses(email.cc),
      bcc: flattenAddresses(email.bcc),
    },
    snippet: makeSnippet(bodyText.text),
    bodyText: bodyText.text,
    bodyHtml: bodyHtml.text,
    truncated: bodyText.truncated || bodyHtml.truncated,
    references: extractReferences(email),
    headers: (email.headers ?? []).slice(0, MAX_HEADERS).map((h) => ({
      key: stripNul(h.key),
      value: stripNul(h.value)?.slice(0, MAX_HEADER_VALUE) ?? null,
    })),
    attachments: (email.attachments ?? []).slice(0, MAX_ATTACHMENTS_META).map((a) => ({
      filename: stripNul(a.filename) ?? null,
      mime_type: stripNul(a.mimeType) ?? null,
      // Approximate for string parts — metadata only, not worth a re-encode.
      size: typeof a.content === 'string' ? a.content.length : (a.content?.byteLength ?? 0),
    })),
    rawSize: message.rawSize,
    envelopeFrom: message.from,
    envelopeTo: message.to,
    sentAt,
  }
}
