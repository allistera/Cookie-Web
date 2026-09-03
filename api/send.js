import process from 'node:process'
import crypto from 'node:crypto'
import { Buffer } from 'node:buffer'

import { del, get, head } from '@vercel/blob'
import { handleUpload } from '@vercel/blob/client'
import { Resend } from 'resend'

import { writeAuthError } from './_lib/auth.js'
import { createServices } from './_lib/services.js'
import { readJsonBody } from './_lib/body.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SNIPPET_LENGTH = 100
export const MAX_OUTBOUND_RECIPIENTS = 20
export const MAX_OUTBOUND_SUBJECT_BYTES = 998
export const MAX_OUTBOUND_TEXT_BYTES = 100_000
export const MAX_OUTBOUND_HTML_BYTES = 200_000
export const MAX_OUTBOUND_TOTAL_BYTES = 256_000
export const MAX_OUTBOUND_ATTACHMENTS = 20
// Resend's 40 MB ceiling is measured after Base64 encoding, and Workers need
// headroom while converting streamed bytes into a provider-safe Base64 string.
export const MAX_OUTBOUND_ATTACHMENT_BYTES = 20 * 1024 * 1024
const OUTBOUND_SENDS_PER_MINUTE = 10
// Composer uploads land under a per-user prefix so a registration call can
// only ever claim a blob the caller's own token was minted for.
const ATTACHMENT_BLOB_PREFIX = 'outbound-attachments'
const ATTACHMENT_UPLOADS_PER_MINUTE = 30
// An upload the composer never sent (draft abandoned, tab closed) keeps its
// bytes in Blob forever otherwise. A day is long enough that a slow draft is
// never swept out from under the person writing it.
const ORPHAN_UPLOAD_RETENTION_HOURS = 24
const ORPHAN_UPLOAD_SWEEP_LIMIT = 50
// A scheduled send needs enough lead time that it can't fire before the
// composer has even finished closing — matches ScheduleMenu's own minimum.
const MIN_SCHEDULE_LEAD_MS = 60_000
export const MAX_PENDING_SCHEDULED_SENDS = 50
const FLUSH_BATCH_SIZE = 20
const FLUSH_CONCURRENCY = 4
const ATTACHMENT_FLUSH_CONCURRENCY = 1
const SCHEDULED_SEND_LEASE_MINUTES = 15
// After this many failed delivery attempts a scheduled send stops retrying
// and is surfaced to the user as failed, rather than silently retried on
// every flush forever.
const MAX_SCHEDULED_SEND_ATTEMPTS = 5
// Resolved scheduled_sends rows and expired read receipts otherwise
// accumulate forever; the flush job is the only periodic cron trigger this
// app has, so it doubles as the sweep for both.
const RESOLVED_STATE_RETENTION_DAYS = 30
const FLUSH_CLAIM_ATTEMPTS = 3
const FLUSH_CLAIM_BASE_DELAY_MS = 500
const TRANSIENT_DB_ERROR_CODES = new Set([
  'CONNECT_TIMEOUT',
  '08006',
  '08001',
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
])

// A picked filename reaches the recipient as the provider attachment name, so
// drop directory separators and control characters (classic header/path
// smuggling shapes) and keep the result short enough for any mail client.
export function sanitizeAttachmentFilename(value) {
  const base = String(value ?? '')
    .split(/[/\\]/)
    .pop()
  // Stripping control characters is the whole point here: they are what makes
  // a filename header-injection bait.
  // oxlint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  if (!cleaned || cleaned === '.' || cleaned === '..') return 'attachment'
  return cleaned.slice(0, 200)
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

// The pixel endpoint lives on the cookie-web-receipts Worker now (Cookie-Worker
// repo) — a public identifier like src/lib/apiWorkers.js's other Worker URLs,
// not configuration. A vercel.json redirect keeps the old same-origin
// /api/read-receipts pixels in already-sent mail working.
const READ_RECEIPTS_PIXEL_BASE = 'https://receipts-api.infinitywave.online/read-receipts'

export function buildReadReceiptUrl(token, env = process.env) {
  // The public-origin check stays as the "is this a deployed environment?"
  // gate: dev and e2e runs without one must keep producing pixel-free mail.
  const configured = env.PUBLIC_APP_URL || env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL
  if (!configured || !UUID_RE.test(token)) return null
  const url = new URL(READ_RECEIPTS_PIXEL_BASE)
  url.searchParams.set('token', token)
  return url.toString()
}

export function appendReadReceipt(html, text, receiptUrl) {
  if (!receiptUrl) return html
  const content = html || escapeHtml(text).replaceAll('\n', '<br>')
  return `${content}<img src="${receiptUrl}" width="1" height="1" alt="" style="display:none;width:1px;height:1px;border:0" />`
}

function makeSnippet(text) {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length > SNIPPET_LENGTH ? `${collapsed.slice(0, SNIPPET_LENGTH)}...` : collapsed
}

export function configuredEmailFrom(env = process.env) {
  const from = String(env.EMAIL_FROM || '').trim()
  if (!from) throw new Error('EMAIL_FROM is not configured')
  return from
}

// "Name <addr@example.com>" -> { name, address }; bare address -> name null.
function parseFromEnv(from) {
  const match = /^(.*)<([^>]+)>\s*$/.exec(from)
  if (match) {
    return { name: match[1].trim() || null, address: match[2].trim() }
  }
  return { name: null, address: from.trim() }
}

// The "to" field is a comma-separated list of addresses; returns the trimmed,
// non-empty ones. Exported for testing.
// Longest representation a valid list can take: MAX_OUTBOUND_RECIPIENTS
// addresses of at most 320 chars, plus separators and generous whitespace.
// Enforced before split() so a multi-megabyte comma flood is rejected in O(1)
// instead of being expanded into millions of array entries first.
const MAX_RECIPIENTS_FIELD_CHARS = MAX_OUTBOUND_RECIPIENTS * 512

export function parseRecipients(to) {
  if (!(to?.split instanceof Function)) return []
  if (String(to).length > MAX_RECIPIENTS_FIELD_CHARS) return []
  const recipients = to
    .split(',')
    .map((address) => address.trim())
    .filter(Boolean)
  if (recipients.length > MAX_OUTBOUND_RECIPIENTS) return []
  return recipients
}

export function parseAttachmentIds(value) {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > MAX_OUTBOUND_ATTACHMENTS) return null
  const ids = value.map((id) => String(id))
  if (ids.some((id) => !UUID_RE.test(id)) || new Set(ids).size !== ids.length) return null
  return ids
}

// Pragmatic RFC 5322 subset: one @, no whitespace or control characters, no
// header-significant punctuation, and a dotted domain. Resend would reject
// malformed values anyway, but rejecting here keeps CRLF/control-character
// payloads (classic SMTP header-injection shapes) out of the provider payload,
// the stored recipients column, and the scheduled-send queue.
const ADDRESS_RE =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}.-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/

/** @param {string} value */
function hasControlChars(value) {
  for (const character of value) {
    const code = character.codePointAt(0)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

function validOutboundAddress(address) {
  return address.length <= 320 && ADDRESS_RE.test(address)
}

export function validateOutboundMessage({ to, subject, text, html }) {
  const recipients = parseRecipients(to)
  const htmlText = String(html ?? '')
  const bodyHtml = htmlText.trim() ? htmlText : null
  const subjectText = String(subject ?? '')
  const bodyText = String(text ?? '')
  if (
    recipients.length === 0 ||
    !recipients.every(validOutboundAddress) ||
    !subjectText.trim() ||
    hasControlChars(subjectText) ||
    !bodyText.trim()
  ) {
    return { error: 'to, subject and text are required and must be valid' }
  }

  const subjectBytes = Buffer.byteLength(subjectText)
  const textBytes = Buffer.byteLength(bodyText)
  const htmlBytes = bodyHtml ? Buffer.byteLength(bodyHtml) : 0
  if (
    subjectBytes > MAX_OUTBOUND_SUBJECT_BYTES ||
    textBytes > MAX_OUTBOUND_TEXT_BYTES ||
    htmlBytes > MAX_OUTBOUND_HTML_BYTES ||
    subjectBytes + textBytes + htmlBytes > MAX_OUTBOUND_TOTAL_BYTES
  ) {
    return { error: 'The email exceeds the allowed content size' }
  }
  return { recipients, bodyHtml }
}

// A future ISO timestamp at least MIN_SCHEDULE_LEAD_MS out; anything else
// (missing, unparsable, in the past, or too soon) is rejected. Exported for
// testing.
export function parseScheduledFor(sendAt) {
  const timestamp = Date.parse(String(sendAt ?? ''))
  if (Number.isNaN(timestamp) || timestamp < Date.now() + MIN_SCHEDULE_LEAD_MS) return null
  return new Date(timestamp).toISOString()
}

export function parseFollowUpAt(followUpAt, after = Date.now()) {
  const timestamp = Date.parse(String(followUpAt ?? ''))
  const afterTimestamp = new Date(after).getTime()
  if (
    Number.isNaN(timestamp) ||
    Number.isNaN(afterTimestamp) ||
    timestamp < Math.max(Date.now(), afterTimestamp) + MIN_SCHEDULE_LEAD_MS
  ) {
    return null
  }
  return new Date(timestamp).toISOString()
}

export async function claimOutboundEmailQuota(sql, userId) {
  const [result] = await sql`
    WITH claimed AS (
      INSERT INTO outbound_email_quotas (user_id, window_start, send_count)
      VALUES (${userId}, date_trunc('minute', now()), 1)
      ON CONFLICT (user_id) DO UPDATE SET
        window_start = CASE
          WHEN outbound_email_quotas.window_start < date_trunc('minute', now())
            THEN EXCLUDED.window_start
          ELSE outbound_email_quotas.window_start
        END,
        send_count = CASE
          WHEN outbound_email_quotas.window_start < date_trunc('minute', now()) THEN 1
          ELSE outbound_email_quotas.send_count + 1
        END,
        updated_at = now()
      WHERE outbound_email_quotas.window_start < date_trunc('minute', now())
         OR outbound_email_quotas.send_count < ${OUTBOUND_SENDS_PER_MINUTE}
      RETURNING user_id
    )
    SELECT
      EXISTS (SELECT 1 FROM users WHERE id = ${userId}) AS authorized,
      EXISTS (SELECT 1 FROM claimed) AS quota_claimed
  `
  return result || { authorized: false, quota_claimed: false }
}

// Compensating decrement after a failed provider delivery so an outage does
// not burn the user's per-minute allowance on mail that never went out. The
// window_start guard keeps the refund from leaking into a newer minute's
// counter after a rollover.
export async function refundOutboundEmailQuota(sql, userId) {
  try {
    await sql`
      UPDATE outbound_email_quotas
      SET send_count = GREATEST(send_count - 1, 0), updated_at = now()
      WHERE user_id = ${userId}
        AND window_start = date_trunc('minute', now())
        AND send_count > 0
    `
  } catch (err) {
    console.error('failed to refund outbound email quota:', err.message)
  }
}

function isUndefinedOutboundAttachmentsTable(err) {
  return err?.code === '42P01' && /outbound_attachments/i.test(String(err.message ?? ''))
}

// Inbound attachments are owned through their message; composer uploads are
// owned directly. Both are addressed by the same opaque id in the request, so
// resolve across both and let the caller treat them uniformly.
async function selectOwnedAttachmentRows(sql, userId, attachmentIds) {
  try {
    return await sql`
      SELECT * FROM (
        SELECT a.id, a.filename, a.content_type, a.size_bytes, a.blob_url,
               'inbound' AS source
        FROM attachments a
        JOIN messages m ON m.id = a.message_id
        WHERE a.id = ANY(${attachmentIds}::uuid[])
          AND m.user_id = ${userId}
          AND NOT m.is_deleted
          AND a.blob_url IS NOT NULL
        UNION ALL
        SELECT o.id, o.filename, o.content_type, o.size_bytes, o.blob_url,
               'upload' AS source
        FROM outbound_attachments o
        WHERE o.id = ANY(${attachmentIds}::uuid[])
          AND o.user_id = ${userId}
      ) owned
      ORDER BY array_position(${attachmentIds}::uuid[], owned.id)
    `
  } catch (err) {
    // Rolling deploy: this release can run against a database that has not
    // taken 0060 yet. Forwarded attachments keep working; an upload id simply
    // resolves to nothing and the send is rejected as a missing attachment.
    if (!isUndefinedOutboundAttachmentsTable(err)) throw err
    return sql`
      SELECT a.id, a.filename, a.content_type, a.size_bytes, a.blob_url,
             'inbound' AS source
      FROM attachments a
      JOIN messages m ON m.id = a.message_id
      WHERE a.id = ANY(${attachmentIds}::uuid[])
        AND m.user_id = ${userId}
        AND NOT m.is_deleted
        AND a.blob_url IS NOT NULL
      ORDER BY array_position(${attachmentIds}::uuid[], a.id)
    `
  }
}

async function resolveOwnedAttachments(sql, userId, attachmentIds) {
  if (attachmentIds.length === 0) return { attachments: [] }
  const rows = await selectOwnedAttachmentRows(sql, userId, attachmentIds)
  if (rows.length !== attachmentIds.length) return { missing: true }

  let declaredBytes = 0
  for (const attachment of rows) {
    if (attachment.size_bytes === null || attachment.size_bytes === undefined) continue
    const size = Number(attachment.size_bytes)
    if (!Number.isSafeInteger(size) || size < 0) return { invalid: true }
    declaredBytes += size
  }
  if (declaredBytes > MAX_OUTBOUND_ATTACHMENT_BYTES) return { tooLarge: true }
  return { attachments: rows }
}

async function readAttachmentContent(attachment, readBlob) {
  const result = await readBlob(attachment.blob_url)
  if (!result?.stream) throw new Error(`Attachment blob is unavailable: ${attachment.id}`)
  const chunks = []
  let bytes = 0
  for await (const chunk of result.stream) {
    const buffer = Buffer.from(chunk)
    bytes += buffer.byteLength
    if (bytes > MAX_OUTBOUND_ATTACHMENT_BYTES) {
      throw new Error('Outbound attachments exceed the provider size limit')
    }
    chunks.push(buffer)
  }
  return {
    byteLength: bytes,
    providerAttachment: {
      content: Buffer.concat(chunks).toString('base64'),
      filename: attachment.filename || 'attachment',
      contentType: attachment.content_type || 'application/octet-stream',
    },
  }
}

async function loadProviderAttachments(attachments, readBlob) {
  const loaded = []
  let totalBytes = 0
  for (const attachment of attachments) {
    const loadedAttachment = await readAttachmentContent(attachment, readBlob)
    totalBytes += loadedAttachment.byteLength
    if (totalBytes > MAX_OUTBOUND_ATTACHMENT_BYTES) {
      throw new Error('Outbound attachments exceed the provider size limit')
    }
    loaded.push(loadedAttachment.providerAttachment)
  }
  return loaded
}

// Stores the sent copy in the existing tables (is_sent=true, excluded from
// the inbox list, included in search). Threads with the replied-to message
// when replyToMessageId is given; otherwise starts a fresh thread. Returns
// the new message's id so callers (e.g. the scheduled-send flush job) can
// link back to it.
async function storeSentMessage(
  sql,
  userId,
  {
    recipients,
    subject,
    text,
    html,
    replyToMessageId,
    resendId,
    readReceiptToken,
    followUpAt,
    attachments = [],
  },
) {
  const messageId = resendId ? `<${resendId}@resend.cookie-web>` : null
  const [lookup] = await sql`
    SELECT CASE WHEN ${replyToMessageId ?? null}::uuid IS NOT NULL THEN
             (SELECT m.thread_id FROM messages m
              WHERE m.id = ${replyToMessageId ?? null}::uuid AND m.user_id = ${userId})
           END AS thread_id,
           (SELECT m.id FROM messages m
            WHERE m.user_id = ${userId} AND m.message_id = ${messageId}
            LIMIT 1) AS existing_message_id
    FROM users u
    WHERE u.id = ${userId}
    LIMIT 1
  `
  if (!lookup) {
    throw new Error('no users row matches the authenticated user; sent copy not stored')
  }

  const { name: fromName, address: fromAddress } = parseFromEnv(configuredEmailFrom())
  const messageUuid = lookup.existing_message_id ?? crypto.randomUUID()
  const threadUuid = lookup.thread_id ?? crypto.randomUUID()
  const sentAt = new Date().toISOString()
  const recipientsJson = JSON.stringify({
    to: recipients.map((address) => ({ name: null, address })),
    cc: [],
    bcc: [],
  })
  if (!lookup.existing_message_id) {
    const statements = []
    if (!lookup.thread_id) {
      statements.push(
        (sql) => sql`
        INSERT INTO threads (id, user_id, subject, last_message_at)
        VALUES (${threadUuid}, ${userId}, ${subject}, ${sentAt})
      `,
      )
    }
    const messagesStatement = statements.length
    statements.push(
      (sql) => sql`
      INSERT INTO messages (id, thread_id, user_id, from_name, from_address,
                            recipients, subject, snippet, body_text, body_html, sent_at,
                            message_id, is_unread, is_sent, follow_up_at)
      VALUES (${messageUuid}, ${threadUuid}, ${userId}, ${fromName},
              ${fromAddress}, ${recipientsJson}::jsonb, ${subject}, ${makeSnippet(text)},
              ${text}, ${html ?? null}, ${sentAt}, ${messageId}, false, true,
              ${followUpAt ?? null}::timestamptz)
      ON CONFLICT (user_id, message_id) WHERE message_id IS NOT NULL DO NOTHING
      RETURNING id
    `,
    )
    if (lookup.thread_id) {
      statements.push(
        (sql) => sql`
        UPDATE threads
        SET message_count = message_count + 1,
            last_message_at = GREATEST(last_message_at, ${sentAt}::timestamptz)
        WHERE id = ${threadUuid}
          AND EXISTS (SELECT 1 FROM messages WHERE id = ${messageUuid})
      `,
      )
    }
    await sql.begin(async (sql) => {
      let inserted = false
      for (const [index, statement] of statements.entries()) {
        const result = await statement(sql)
        if (index === messagesStatement) inserted = result.length > 0
      }
      if (inserted) {
        for (const attachment of attachments) {
          await sql`
            INSERT INTO attachments (message_id, filename, content_type, size_bytes, blob_url)
            VALUES (${messageUuid}, ${attachment.filename ?? null},
                    ${attachment.content_type ?? null}, ${attachment.size_bytes ?? null},
                    ${attachment.blob_url})
          `
        }
      }
    })
  } else if (followUpAt) {
    await sql`
      UPDATE messages
      SET follow_up_at = ${followUpAt}::timestamptz
      WHERE id = ${messageUuid} AND user_id = ${userId} AND is_sent
    `
  }

  // Best effort and outside the sent-copy transaction: during a rolling
  // migration, a missing receipt table must not roll back the sent message.
  if (readReceiptToken) {
    try {
      await sql`
        INSERT INTO message_read_receipts (message_id, user_id, token)
        SELECT m.id, m.user_id, ${readReceiptToken}::uuid
        FROM messages m
        WHERE m.id = ${messageUuid} AND m.user_id = ${userId}
        ON CONFLICT (message_id) DO NOTHING
      `
    } catch (err) {
      console.error('failed to store read receipt:', err.message)
    }
  }

  return { messageUuid }
}

// Sends immediately through Resend, from the shared inbound handler (a
// logged-in user's request) and the flush job (a claimed scheduled row)
// alike. Throws on failure; callers decide how to react.
async function deliverMail(
  sql,
  userId,
  {
    recipients,
    subject,
    text,
    html,
    replyToMessageId,
    idempotencyKey,
    readReceiptToken,
    followUpAt,
    attachments = [],
  },
  services,
) {
  const receiptToken = readReceiptToken ?? crypto.randomUUID()
  const receiptUrl = buildReadReceiptUrl(receiptToken)
  const trackedHtml = appendReadReceipt(html, text, receiptUrl)

  const resend = services.createResend(process.env.RESEND_API_KEY)
  const providerAttachments = attachments.length
    ? await loadProviderAttachments(attachments, services.readBlob)
    : []
  const payload = {
    from: configuredEmailFrom(),
    to: recipients,
    subject,
    text,
  }
  if (trackedHtml) payload.html = trackedHtml
  if (providerAttachments.length) payload.attachments = providerAttachments
  const { data, error } = idempotencyKey
    ? await resend.emails.send(payload, { idempotencyKey })
    : await resend.emails.send(payload)
  if (error) throw new Error(error.message || 'Failed to send email')

  let messageUuid = null
  try {
    ;({ messageUuid } = await storeSentMessage(sql, userId, {
      recipients,
      subject,
      text,
      html,
      replyToMessageId,
      resendId: data.id,
      readReceiptToken: receiptUrl ? receiptToken : null,
      followUpAt,
      attachments,
    }))
  } catch (err) {
    // Sending always wins: a storage failure is logged but the mail really
    // did go out, so this must never be treated as a failed send.
    console.error('failed to store sent copy:', err.message)
  }
  return { resendId: data.id, messageUuid }
}

// Inserts a pending scheduled_sends row, capped at MAX_PENDING_SCHEDULED_SENDS
// per user so a runaway client can't queue unbounded future sends. Returns
// null if the cap is hit.
async function ownedReplyToMessageId(sql, userId, replyToMessageId) {
  if (!replyToMessageId) return { replyTo: null }
  const [row] = await sql`
    SELECT m.id
    FROM messages m
    WHERE m.id = ${replyToMessageId}::uuid AND m.user_id = ${userId} AND NOT m.is_deleted
    LIMIT 1
  `
  return row ? { replyTo: replyToMessageId } : { missing: true }
}

// The content hash alone would silently dedupe a deliberate re-send of the
// identical message within the provider's idempotency window. Mixing in an
// optional client-generated requestId keeps double-click/retry protection
// (same requestId dedupes) while letting intentional duplicates through
// (new requestId, new send).
function immediateSendIdempotencyKey(
  userId,
  { recipients, subject, text, html, replyToMessageId, attachmentIds = [], requestId },
) {
  const digest = crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        userId,
        recipients,
        subject,
        text,
        html: html ?? null,
        replyToMessageId: replyToMessageId ?? null,
        attachmentIds,
        requestId: requestId ?? null,
      }),
    )
    .digest('hex')
  return `immediate-send/${digest}`
}

async function createScheduledSend(
  sql,
  userId,
  { recipients, subject, text, html, replyToMessageId, scheduledFor, followUpAt, attachments = [] },
) {
  // The count-then-insert cap is not safe under READ COMMITTED on its own:
  // two concurrent transactions can both snapshot count = MAX - 1 and both
  // insert. A per-user transaction-scoped advisory lock serializes schedule
  // attempts so the cap actually holds.
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${userId}::text)::bigint)`
    const [row] = await tx`
      INSERT INTO scheduled_sends
        (user_id, to_addresses, subject, body_text, body_html, reply_to_message_id,
         scheduled_for, follow_up_at)
      SELECT ${userId}, ${recipients.join(', ')}, ${subject}, ${text}, ${html ?? null},
             ${replyToMessageId}::uuid, ${scheduledFor}::timestamptz,
             ${followUpAt ?? null}::timestamptz
      WHERE (
        SELECT count(*) FROM scheduled_sends s
        WHERE s.user_id = ${userId} AND s.status = 'pending'
      ) < ${MAX_PENDING_SCHEDULED_SENDS}
      RETURNING id, to_addresses AS "toAddresses", subject, scheduled_for AS "scheduledFor",
                follow_up_at AS "followUpAt"
    `
    if (!row) return null
    for (const [position, attachment] of attachments.entries()) {
      const isUpload = attachment.source === 'upload'
      await tx`
        INSERT INTO scheduled_send_attachments
          (scheduled_send_id, attachment_id, outbound_attachment_id, position)
        VALUES (${row.id}, ${isUpload ? null : attachment.id}::uuid,
                ${isUpload ? attachment.id : null}::uuid, ${position})
      `
    }
    return row
  })
}

async function listScheduledSends(sql, userId) {
  return sql`
    SELECT s.id, s.to_addresses AS "toAddresses", s.subject, s.scheduled_for AS "scheduledFor",
           s.follow_up_at AS "followUpAt", s.status, s.last_error AS "lastError"
    FROM scheduled_sends s
    WHERE s.user_id = ${userId} AND s.status IN ('pending', 'failed')
    ORDER BY s.scheduled_for ASC
  `
}

// Either half of the scheduled-attachment join can be missing mid-rollout:
// scheduled_send_attachments arrives with 0059, outbound_attachments with 0060.
function isUndefinedScheduledAttachmentsTable(err) {
  return (
    err?.code === '42P01' &&
    /scheduled_send_attachments|outbound_attachments/i.test(String(err.message ?? ''))
  )
}

async function cancelScheduledSendWithoutAttachments(sql, userId, id) {
  return sql.begin(async (tx) => {
    const [row] = await tx`
      SELECT s.id, s.to_addresses AS "toAddresses", s.subject,
             s.body_text AS "text", s.body_html AS "html",
             s.reply_to_message_id AS "replyToMessageId",
             s.follow_up_at AS "followUpAt", '[]'::jsonb AS attachments
      FROM scheduled_sends s
      WHERE s.id = ${id} AND s.user_id = ${userId} AND s.status = 'pending'
      FOR UPDATE
    `
    if (!row) return null
    await tx`DELETE FROM scheduled_sends WHERE id = ${id}`
    return row
  })
}

// Only a still-pending row can be canceled — one already claimed by the
// flush job (status 'sending') or already resolved ('sent'/'failed') is
// left alone. Returns the full content so the client can reopen it in the
// composer, mirroring undoPendingSend's immediate-send equivalent.
async function cancelScheduledSend(sql, userId, id) {
  try {
    return await sql.begin(async (tx) => {
      const [row] = await tx`
        SELECT s.id, s.to_addresses AS "toAddresses", s.subject,
               s.body_text AS "text", s.body_html AS "html",
               s.reply_to_message_id AS "replyToMessageId",
               s.follow_up_at AS "followUpAt",
               COALESCE((
                 SELECT jsonb_agg(jsonb_build_object(
                   'id', COALESCE(a.id, oa.id),
                   'filename', COALESCE(a.filename, oa.filename),
                   'content_type', COALESCE(a.content_type, oa.content_type),
                   'size_bytes', COALESCE(a.size_bytes, oa.size_bytes),
                   'downloadable', COALESCE(a.blob_url, oa.blob_url) IS NOT NULL,
                   -- Reopening a canceled send puts these chips back in the
                   -- composer, where removing an upload should reclaim its
                   -- bytes rather than wait for the orphan sweep.
                   'source', CASE WHEN oa.id IS NOT NULL THEN 'upload' ELSE 'inbound' END
                 ) ORDER BY ssa.position)
                 FROM scheduled_send_attachments ssa
                 LEFT JOIN attachments a ON a.id = ssa.attachment_id
                 LEFT JOIN outbound_attachments oa ON oa.id = ssa.outbound_attachment_id
                 WHERE ssa.scheduled_send_id = s.id
               ), '[]'::jsonb) AS attachments
        FROM scheduled_sends s
        WHERE s.id = ${id} AND s.user_id = ${userId} AND s.status = 'pending'
        FOR UPDATE
      `
      if (!row) return null
      await tx`DELETE FROM scheduled_sends WHERE id = ${id}`
      return row
    })
  } catch (err) {
    if (!isUndefinedScheduledAttachmentsTable(err)) throw err
    return cancelScheduledSendWithoutAttachments(sql, userId, id)
  }
}

// Atomically claims up to `limit` due rows so two overlapping flush calls
// (e.g. a slow run overlapping the next tick) never send the same row twice
// — FOR UPDATE SKIP LOCKED lets a concurrent call skip rows this one already
// has locked instead of blocking on them.
async function claimDueScheduledSends(sql, limit) {
  try {
    return await sql`
      UPDATE scheduled_sends s
      SET status = 'sending', claimed_at = now()
      FROM (
        SELECT id FROM scheduled_sends
        WHERE (status = 'pending' AND scheduled_for <= now())
           OR (status = 'sending'
               AND claimed_at < now() - make_interval(mins => ${SCHEDULED_SEND_LEASE_MINUTES}))
        ORDER BY scheduled_for
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      ) due
      WHERE s.id = due.id
      RETURNING s.id, s.user_id, s.to_addresses AS "toAddresses", s.subject,
                s.body_text AS "text", s.body_html AS "html",
                s.reply_to_message_id AS "replyToMessageId",
                s.follow_up_at AS "followUpAt", s.attempts,
                COALESCE((
                  SELECT jsonb_agg(jsonb_build_object(
                    'id', COALESCE(a.id, oa.id),
                    'filename', COALESCE(a.filename, oa.filename),
                    'content_type', COALESCE(a.content_type, oa.content_type),
                    'size_bytes', COALESCE(a.size_bytes, oa.size_bytes),
                    'blob_url', COALESCE(a.blob_url, oa.blob_url)
                  ) ORDER BY ssa.position)
                  FROM scheduled_send_attachments ssa
                  LEFT JOIN attachments a ON a.id = ssa.attachment_id
                  LEFT JOIN outbound_attachments oa ON oa.id = ssa.outbound_attachment_id
                  WHERE ssa.scheduled_send_id = s.id
                ), '[]'::jsonb) AS attachments
    `
  } catch (err) {
    if (!isUndefinedScheduledAttachmentsTable(err)) throw err
    return sql`
      UPDATE scheduled_sends s
      SET status = 'sending', claimed_at = now()
      FROM (
        SELECT id FROM scheduled_sends
        WHERE (status = 'pending' AND scheduled_for <= now())
           OR (status = 'sending'
               AND claimed_at < now() - make_interval(mins => ${SCHEDULED_SEND_LEASE_MINUTES}))
        ORDER BY scheduled_for
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      ) due
      WHERE s.id = due.id
      RETURNING s.id, s.user_id, s.to_addresses AS "toAddresses", s.subject,
                s.body_text AS "text", s.body_html AS "html",
                s.reply_to_message_id AS "replyToMessageId",
                s.follow_up_at AS "followUpAt", s.attempts,
                '[]'::jsonb AS attachments
    `
  }
}

function isTransientDbConnectionError(err) {
  const code = err?.code
  const message = err instanceof Error ? err.message : String(err)
  return (
    TRANSIENT_DB_ERROR_CODES.has(code) ||
    /CONNECT_TIMEOUT|Failed to connect to database|ENETUNREACH/i.test(message)
  )
}

async function claimDueScheduledSendsWithRetry(sql, limit) {
  for (let attempt = 1; attempt <= FLUSH_CLAIM_ATTEMPTS; attempt += 1) {
    try {
      return await claimDueScheduledSends(sql, limit)
    } catch (err) {
      if (attempt === FLUSH_CLAIM_ATTEMPTS || !isTransientDbConnectionError(err)) throw err
      await new Promise((resolve) => setTimeout(resolve, FLUSH_CLAIM_BASE_DELAY_MS * attempt))
    }
  }
  throw new Error('flush claim attempts must be at least 1')
}

async function markScheduledSendFailed(sql, id, error, attempts = null) {
  await sql`
    UPDATE scheduled_sends
    SET status = 'failed', last_error = ${error},
        attempts = COALESCE(${attempts}, attempts), claimed_at = NULL
    WHERE id = ${id}
  `
}

// Delivers one claimed row. Never leaves a row claimed ('sending' status)
// without resolving it to 'pending' (retry), 'sent', or 'failed'.
async function deliverScheduledSend(sql, row, services) {
  const [owner] = await sql`SELECT 1 AS "exists" FROM users WHERE id = ${row.user_id}`
  if (!owner) {
    await markScheduledSendFailed(sql, row.id, 'Owning user no longer exists')
    return 'failed'
  }

  const quota = await claimOutboundEmailQuota(sql, row.user_id)
  if (!quota.authorized) {
    await markScheduledSendFailed(sql, row.id, 'Mailbox access is not provisioned')
    return 'failed'
  }
  if (!quota.quota_claimed) {
    // Rate-limited, not the message's fault — leave it pending for the next
    // flush instead of spending a retry attempt.
    await sql`UPDATE scheduled_sends SET status = 'pending', claimed_at = NULL WHERE id = ${row.id}`
    return 'retried'
  }

  const recipients = parseRecipients(row.toAddresses)
  let delivered
  try {
    delivered = await deliverMail(
      sql,
      row.user_id,
      {
        recipients,
        subject: row.subject,
        text: row.text,
        html: row.html,
        replyToMessageId: row.replyToMessageId,
        idempotencyKey: `scheduled-send/${row.id}`,
        // The receipt URL is part of the provider payload, so it must remain
        // stable when an expired lease retries with the same idempotency key.
        readReceiptToken: row.id,
        followUpAt: row.followUpAt,
        attachments: row.attachments ?? [],
      },
      services,
    )
  } catch (err) {
    const attempts = row.attempts + 1
    console.error(`scheduled send ${row.id} delivery failed (attempt ${attempts}):`, err.message)
    // Nothing went out, so give the minute's quota back instead of letting a
    // provider outage consume the user's allowance through retries.
    await refundOutboundEmailQuota(sql, row.user_id)
    if (attempts >= MAX_SCHEDULED_SEND_ATTEMPTS) {
      await markScheduledSendFailed(sql, row.id, err.message, attempts)
      return 'failed'
    }
    await sql`
      UPDATE scheduled_sends
      SET status = 'pending', attempts = ${attempts}, last_error = ${err.message}, claimed_at = NULL
      WHERE id = ${row.id}
    `
    return 'retried'
  }

  if (row.followUpAt && !delivered.messageUuid) {
    console.error(`scheduled send ${row.id} delivered but its follow-up could not be stored`)
    return 'unconfirmed'
  }

  try {
    await sql`
      UPDATE scheduled_sends
      SET status = 'sent', sent_at = now(), sent_message_id = ${delivered.messageUuid},
          claimed_at = NULL, last_error = NULL
      WHERE id = ${row.id}
    `
    return 'sent'
  } catch (err) {
    // Delivery is irreversible and succeeded. Leave the row leased as
    // `sending`: a later flush can safely reclaim it because the provider call
    // uses the stable scheduled-send idempotency key.
    console.error(`scheduled send ${row.id} delivered but could not be marked sent:`, err.message)
    return 'unconfirmed'
  }
}

async function mapWithConcurrency(items, concurrency, operation) {
  const results = Array.from({ length: items.length })
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await operation(items[index])
    }
  })
  await Promise.all(workers)
  return results
}

// GET/DELETE /api/send?resource=scheduled — list or cancel the authenticated
// user's own pending (or recently failed) scheduled sends.
async function handleScheduled(req, res, userId, services) {
  const sql = services.getSql()
  if (req.method === 'GET') {
    const scheduledSends = await listScheduledSends(sql, userId)
    res.statusCode = 200
    res.end(JSON.stringify({ scheduledSends }))
    return
  }
  if (req.method === 'DELETE') {
    let body
    try {
      body = await readJsonBody(req)
    } catch {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'Invalid JSON body' }))
      return
    }
    const id = UUID_RE.test(body.id) ? String(body.id) : null
    if (!id) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'id is required' }))
      return
    }
    const scheduledSend = await cancelScheduledSend(sql, userId, id)
    if (!scheduledSend) {
      res.statusCode = 404
      res.end(JSON.stringify({ error: 'Scheduled send not found or already sent' }))
      return
    }
    res.statusCode = 200
    res.end(JSON.stringify({ scheduledSend }))
    return
  }
  res.statusCode = 405
  res.end(JSON.stringify({ error: 'Method not allowed' }))
}

async function handleFollowUp(req, res, userId, services) {
  if (req.method !== 'PATCH') {
    res.statusCode = 405
    res.end(JSON.stringify({ error: 'Method not allowed' }))
    return
  }

  let body
  try {
    body = await readJsonBody(req)
  } catch {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'Invalid JSON body' }))
    return
  }
  const messageId = UUID_RE.test(body.messageId) ? String(body.messageId) : null
  if (!messageId || !Object.hasOwn(body, 'followUpAt')) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'messageId and followUpAt are required' }))
    return
  }

  let followUpAt = null
  if (body.followUpAt !== null) {
    followUpAt = parseFollowUpAt(body.followUpAt)
    if (!followUpAt) {
      res.statusCode = 400
      res.end(
        JSON.stringify({ error: 'followUpAt must be an ISO timestamp at least a minute out' }),
      )
      return
    }
  }

  const sql = services.getSql()
  const [message] =
    followUpAt === null
      ? await sql`
          UPDATE messages
          SET follow_up_at = NULL
          WHERE id = ${messageId}::uuid AND user_id = ${userId}
            AND is_sent AND NOT is_deleted
          RETURNING id, follow_up_at AS "followUpAt"
        `
      : await sql`
          UPDATE messages m
          SET follow_up_at = ${followUpAt}::timestamptz
          WHERE m.id = ${messageId}::uuid AND m.user_id = ${userId}
            AND m.is_sent AND NOT m.is_deleted
            AND NOT EXISTS (
              SELECT 1
              FROM messages reply
              WHERE reply.user_id = m.user_id
                AND reply.thread_id = m.thread_id
                AND NOT reply.is_sent
                AND NOT reply.is_deleted
                AND reply.sent_at > m.sent_at
            )
          RETURNING m.id, m.follow_up_at AS "followUpAt"
        `
  if (message) {
    res.statusCode = 200
    res.end(JSON.stringify({ message }))
    return
  }

  const [owned] = await sql`
    SELECT 1 AS "exists"
    FROM messages
    WHERE id = ${messageId}::uuid AND user_id = ${userId}
      AND is_sent AND NOT is_deleted
  `
  res.statusCode = owned ? 409 : 404
  res.end(
    JSON.stringify({
      error: owned ? 'This message already has a reply' : 'Sent message not found',
    }),
  )
}

// Hashing both sides to a fixed-length digest before comparing means
// crypto.timingSafeEqual (which requires equal-length buffers) works
// regardless of the two strings' actual lengths, and neither a length nor a
// byte-value mismatch is distinguishable by comparison time.
function timingSafeEqualStrings(a, b) {
  const digestA = crypto
    .createHash('sha256')
    .update(String(a ?? ''))
    .digest()
  const digestB = crypto
    .createHash('sha256')
    .update(String(b ?? ''))
    .digest()
  return crypto.timingSafeEqual(digestA, digestB)
}

// Best-effort; a sweep failure must never block the flush job's actual
// purpose of sending due mail.
async function sweepResolvedState(sql, services) {
  try {
    await sql`
      DELETE FROM scheduled_sends
      WHERE status IN ('sent', 'failed')
        AND COALESCE(sent_at, created_at) < now() - make_interval(days => ${RESOLVED_STATE_RETENTION_DAYS})
    `
    await sql`DELETE FROM message_read_receipts WHERE expires_at < now()`
  } catch (err) {
    console.error('resolved-state sweep failed:', err.message)
  }
  await sweepOrphanedUploads(sql, services)
}

// A composer upload the user never sent keeps its bytes in Blob forever. Rows
// still referenced by a pending scheduled send or a saved draft are off
// limits, and so is any
// blob a sent copy now shares (storeSentMessage records the same blob_url on
// the sent message's own attachments row) — deleting those bytes would empty
// an attachment the user can still open in their sent mail.
async function sweepOrphanedUploads(sql, services) {
  try {
    const orphans = await sql`
      DELETE FROM outbound_attachments oa
      WHERE oa.id IN (
        SELECT candidate.id
        FROM outbound_attachments candidate
        WHERE candidate.created_at
                < now() - make_interval(hours => ${ORPHAN_UPLOAD_RETENTION_HOURS})
          AND NOT EXISTS (
            SELECT 1 FROM scheduled_send_attachments ssa
            WHERE ssa.outbound_attachment_id = candidate.id
          )
          -- A saved draft can sit untouched for weeks; its files are still
          -- spoken for and must outlive the retention window.
          AND NOT EXISTS (
            SELECT 1 FROM draft_attachments da
            WHERE da.outbound_attachment_id = candidate.id
          )
        ORDER BY candidate.created_at
        LIMIT ${ORPHAN_UPLOAD_SWEEP_LIMIT}
      )
      RETURNING oa.blob_url,
                NOT EXISTS (
                  SELECT 1 FROM attachments a WHERE a.blob_url = oa.blob_url
                ) AS "blobUnreferenced"
    `
    for (const orphan of orphans) {
      if (!orphan.blobUnreferenced) continue
      try {
        await services.deleteBlob(orphan.blob_url)
      } catch (err) {
        console.error('failed to delete orphaned attachment blob:', err.message)
      }
    }
  } catch (err) {
    console.error('orphaned-upload sweep failed:', err.message)
  }
}

// POST /api/send?resource=flush — called on a schedule by the
// scheduled-send-flusher Worker cron in Cookie-Worker (never by the browser
// app), bearer-authenticated with a secret shared out-of-band. Claims and
// delivers due scheduled sends in small batches so one slow invocation
// doesn't run unbounded.
async function handleFlush(req, res, services) {
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.end(JSON.stringify({ error: 'Method not allowed' }))
    return
  }
  const token = process.env.SCHEDULED_SEND_FLUSH_TOKEN
  if (!token || !timingSafeEqualStrings(req.headers.authorization, `Bearer ${token}`)) {
    res.statusCode = 401
    res.end(JSON.stringify({ error: 'Unauthorized' }))
    return
  }
  if (!process.env.RESEND_API_KEY || !String(process.env.EMAIL_FROM || '').trim()) {
    res.statusCode = 503
    res.end(JSON.stringify({ error: 'Email sending is not configured' }))
    return
  }

  try {
    const sql = services.getSql()
    const claimed = await claimDueScheduledSendsWithRetry(sql, FLUSH_BATCH_SIZE)
    const attachmentRows = claimed.filter((row) => row.attachments?.length)
    const ordinaryRows = claimed.filter((row) => !row.attachments?.length)
    // Attachment payloads are buffered for the provider. Keep those rows
    // serial so several large forwards cannot exhaust the function's memory.
    const [ordinaryResults, attachmentResults] = await Promise.all([
      mapWithConcurrency(ordinaryRows, FLUSH_CONCURRENCY, (row) =>
        deliverScheduledSend(sql, row, services),
      ),
      mapWithConcurrency(attachmentRows, ATTACHMENT_FLUSH_CONCURRENCY, (row) =>
        deliverScheduledSend(sql, row, services),
      ),
    ])
    const results = [...ordinaryResults, ...attachmentResults]
    await sweepResolvedState(sql, services)
    res.statusCode = 200
    res.end(
      JSON.stringify({
        claimed: claimed.length,
        sent: results.filter((result) => result === 'sent').length,
        retried: results.filter((result) => result === 'retried').length,
        failed: results.filter((result) => result === 'failed').length,
        unconfirmed: results.filter((result) => result === 'unconfirmed').length,
      }),
    )
  } catch (err) {
    console.error('POST /api/send?resource=flush failed:', err)
    res.statusCode = 500
    res.end(JSON.stringify({ error: 'Flush failed' }))
  }
}

// POST /api/send — send an email through Resend as the app's mailbox
// address and store the sent copy, or (given a future `sendAt`) queue it as
// a scheduled_sends row for the flush job to deliver later. Immediate
// sending always wins: a storage failure is logged and the response is
// still a success.
async function handleSend(req, res, userId, services) {
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.end(JSON.stringify({ error: 'Method not allowed' }))
    return
  }

  if (!process.env.RESEND_API_KEY) {
    res.statusCode = 503
    res.end(JSON.stringify({ error: 'Email sending is not configured' }))
    return
  }
  if (!String(process.env.EMAIL_FROM || '').trim()) {
    res.statusCode = 503
    res.end(JSON.stringify({ error: 'Email sending is not configured' }))
    return
  }

  let body
  try {
    body = await readJsonBody(req)
  } catch {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'Invalid JSON body' }))
    return
  }

  const {
    to,
    subject,
    text,
    html,
    replyToMessageId,
    sendAt,
    requestId,
    followUpAt,
    attachmentIds: rawAttachmentIds,
  } = body
  // Optional client-generated id for idempotency; bounded and restricted so
  // it can only widen the key space, never collide or smuggle content.
  const requestIdText = String(requestId ?? '')
  const clientRequestId = /^[A-Za-z0-9._:-]{1,128}$/.test(requestIdText) ? requestIdText : null
  const validated = validateOutboundMessage({ to, subject, text, html })
  if (validated.error) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: validated.error }))
    return
  }
  const { recipients, bodyHtml } = validated
  const attachmentIds = parseAttachmentIds(rawAttachmentIds)
  if (attachmentIds === null) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'attachmentIds must be a unique list of valid ids' }))
    return
  }
  // Fixture ids from e2e/dev mode aren't UUIDs — ignore them rather than error.
  let replyTo = UUID_RE.test(replyToMessageId) ? String(replyToMessageId) : null

  if (sendAt !== undefined) {
    const scheduledFor = parseScheduledFor(sendAt)
    if (!scheduledFor) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'sendAt must be an ISO timestamp at least a minute out' }))
      return
    }
    const parsedFollowUpAt =
      followUpAt === undefined || followUpAt === null
        ? null
        : parseFollowUpAt(followUpAt, scheduledFor)
    if (followUpAt !== undefined && followUpAt !== null && !parsedFollowUpAt) {
      res.statusCode = 400
      res.end(
        JSON.stringify({
          error: 'followUpAt must be an ISO timestamp at least a minute after sendAt',
        }),
      )
      return
    }
    try {
      const sql = services.getSql()
      const owned = await ownedReplyToMessageId(sql, userId, replyTo)
      if (owned.missing) {
        res.statusCode = 404
        res.end(JSON.stringify({ error: 'Reply target not found' }))
        return
      }
      const resolved = await resolveOwnedAttachments(sql, userId, attachmentIds)
      if (resolved.missing) {
        res.statusCode = 404
        res.end(JSON.stringify({ error: 'Attachment not found' }))
        return
      }
      if (resolved.invalid || resolved.tooLarge) {
        res.statusCode = 400
        res.end(JSON.stringify({ error: 'Attachments exceed the allowed size' }))
        return
      }
      const scheduledSend = await createScheduledSend(sql, userId, {
        recipients,
        subject,
        text,
        html: bodyHtml,
        replyToMessageId: owned.replyTo,
        scheduledFor,
        followUpAt: parsedFollowUpAt,
        attachments: resolved.attachments,
      })
      if (!scheduledSend) {
        res.statusCode = 429
        res.end(JSON.stringify({ error: 'Too many pending scheduled sends' }))
        return
      }
      res.statusCode = 201
      res.end(JSON.stringify({ scheduledSend }))
    } catch (err) {
      console.error('POST /api/send (schedule) failed:', err)
      res.statusCode = 500
      res.end(JSON.stringify({ error: 'Failed to schedule email' }))
    }
    return
  }

  const parsedFollowUpAt =
    followUpAt === undefined || followUpAt === null ? null : parseFollowUpAt(followUpAt)
  if (followUpAt !== undefined && followUpAt !== null && !parsedFollowUpAt) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'followUpAt must be an ISO timestamp at least a minute out' }))
    return
  }

  let sql
  let attachments
  try {
    sql = services.getSql()
    const owned = await ownedReplyToMessageId(sql, userId, replyTo)
    if (owned.missing) {
      res.statusCode = 404
      res.end(JSON.stringify({ error: 'Reply target not found' }))
      return
    }
    replyTo = owned.replyTo
    const resolved = await resolveOwnedAttachments(sql, userId, attachmentIds)
    if (resolved.missing) {
      res.statusCode = 404
      res.end(JSON.stringify({ error: 'Attachment not found' }))
      return
    }
    if (resolved.invalid || resolved.tooLarge) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'Attachments exceed the allowed size' }))
      return
    }
    attachments = resolved.attachments
    const quota = await claimOutboundEmailQuota(sql, userId)
    if (!quota.authorized) {
      res.statusCode = 403
      res.end(JSON.stringify({ error: 'Mailbox access is not provisioned' }))
      return
    }
    if (!quota.quota_claimed) {
      res.statusCode = 429
      res.end(JSON.stringify({ error: 'Outbound email quota exceeded; try again shortly' }))
      return
    }
  } catch (err) {
    console.error('failed to enforce outbound email quota:', err.message)
    res.statusCode = 503
    res.end(JSON.stringify({ error: 'Email sending is temporarily unavailable' }))
    return
  }

  try {
    const { resendId, messageUuid } = await deliverMail(
      sql,
      userId,
      {
        recipients,
        subject,
        text,
        html: bodyHtml,
        replyToMessageId: replyTo,
        idempotencyKey: immediateSendIdempotencyKey(userId, {
          recipients,
          subject,
          text,
          html: bodyHtml,
          replyToMessageId: replyTo,
          attachmentIds,
          requestId: clientRequestId,
        }),
        followUpAt: parsedFollowUpAt,
        attachments,
      },
      services,
    )
    res.statusCode = 200
    res.end(
      JSON.stringify({
        id: resendId,
        messageId: messageUuid,
        followUpScheduled: parsedFollowUpAt ? Boolean(messageUuid) : undefined,
      }),
    )
  } catch (err) {
    console.error('Resend send failed:', err)
    // The quota was claimed but no email was delivered — refund it so a
    // provider outage doesn't lock the user out of sending for the minute.
    await refundOutboundEmailQuota(sql, userId)
    res.statusCode = 502
    res.end(JSON.stringify({ error: 'Failed to send email' }))
  }
}

// Composer uploads are addressed by a pathname the browser proposes, so every
// path that trusts one re-derives ownership from this prefix rather than from
// anything the client asserts about itself.
function attachmentPrefix(userId) {
  return `${ATTACHMENT_BLOB_PREFIX}/${userId}/`
}

// Only our own store's hosts are worth a head() call; anything else is a
// client-supplied URL we should reject before it reaches the Blob API.
function parseBlobUrl(value) {
  let url
  try {
    url = new URL(String(value ?? ''))
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  if (url.hostname !== 'vercel-storage.com' && !url.hostname.endsWith('.vercel-storage.com')) {
    return null
  }
  return url.href
}

// POST /api/send?resource=upload-token — mints a short-lived Blob client
// token so the browser can stream attachment bytes straight to storage.
// Proxying them through this function instead would cap attachments at
// Vercel's ~4.5 MB request body limit, well under the 20 MB outbound ceiling.
async function handleAttachmentUploadToken(req, res, userId, services) {
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.end(JSON.stringify({ error: 'Method not allowed' }))
    return
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    res.statusCode = 503
    res.end(JSON.stringify({ error: 'Attachment storage is not configured' }))
    return
  }

  let body
  try {
    body = await readJsonBody(req)
  } catch {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'Invalid JSON body' }))
    return
  }

  let rateLimited = false
  try {
    const sql = services.getSql()
    const result = await services.handleBlobUpload({
      body,
      request: req,
      token: process.env.BLOB_READ_WRITE_TOKEN,
      onBeforeGenerateToken: async (pathname) => {
        // The token is minted for the pathname the client asked for, so a
        // foreign prefix must be refused here — not merely at registration.
        if (!String(pathname ?? '').startsWith(attachmentPrefix(userId))) {
          throw new Error('Attachment pathname is outside the caller prefix')
        }
        const allowed = await services.allowRequest(sql, userId, 'attachment-upload', {
          limit: ATTACHMENT_UPLOADS_PER_MINUTE,
          windowMs: 60_000,
        })
        if (!allowed) {
          rateLimited = true
          throw new Error('Too many attachment uploads')
        }
        return {
          addRandomSuffix: true,
          maximumSizeInBytes: MAX_OUTBOUND_ATTACHMENT_BYTES,
          tokenPayload: JSON.stringify({ userId }),
        }
      },
    })
    res.statusCode = 200
    res.end(JSON.stringify(result))
  } catch (err) {
    if (rateLimited) {
      res.statusCode = 429
      res.end(JSON.stringify({ error: 'Too many attachment uploads, slow down' }))
      return
    }
    console.error('attachment upload token failed:', err)
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'Failed to authorize attachment upload' }))
  }
}

// POST /api/send?resource=attachment — records a client upload that finished.
// head() is the authority on what actually landed: a client that lies about
// its size or content type cannot widen the row beyond the stored blob, and a
// pathname outside the caller's prefix is not theirs to claim.
async function registerUploadedAttachment(req, res, userId, services) {
  let body
  try {
    body = await readJsonBody(req)
  } catch {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'Invalid JSON body' }))
    return
  }

  const blobUrl = parseBlobUrl(body?.url)
  if (!blobUrl) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'A Blob storage url is required' }))
    return
  }

  let blob
  try {
    blob = await services.headBlob(blobUrl)
  } catch (err) {
    console.error('attachment head failed:', err.message)
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'Uploaded attachment not found' }))
    return
  }

  if (!String(blob?.pathname ?? '').startsWith(attachmentPrefix(userId))) {
    res.statusCode = 403
    res.end(JSON.stringify({ error: 'Attachment does not belong to this account' }))
    return
  }
  const sizeBytes = Number(blob?.size)
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'Uploaded attachment has no readable size' }))
    return
  }
  if (sizeBytes > MAX_OUTBOUND_ATTACHMENT_BYTES) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'Attachments exceed the allowed size' }))
    return
  }

  // The filename is display-only metadata that also becomes the provider
  // attachment name, so strip path separators and control characters rather
  // than trusting whatever the picker reported.
  const filename = sanitizeAttachmentFilename(body?.filename ?? blob?.pathname)

  try {
    const sql = services.getSql()
    const [row] = await sql`
      INSERT INTO outbound_attachments (user_id, filename, content_type, size_bytes, blob_url)
      VALUES (${userId}, ${filename}, ${blob?.contentType ?? null}, ${sizeBytes}, ${blobUrl})
      RETURNING id, filename, content_type, size_bytes
    `
    res.statusCode = 201
    res.end(JSON.stringify({ attachment: row }))
  } catch (err) {
    if (isUndefinedOutboundAttachmentsTable(err)) {
      res.statusCode = 503
      res.end(JSON.stringify({ error: 'Attachment uploads are not available yet' }))
      return
    }
    throw err
  }
}

// DELETE /api/send?resource=attachment&id=... — drops an upload the user
// removed from the composer before sending.
async function deleteUploadedAttachment(req, res, userId, services) {
  const id = new URL(req.url, 'http://localhost').searchParams.get('id')
  if (!id || !UUID_RE.test(id)) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'A valid attachment id is required' }))
    return
  }

  try {
    const sql = services.getSql()
    const [row] = await sql`
      DELETE FROM outbound_attachments oa
      WHERE oa.id = ${id}::uuid AND oa.user_id = ${userId}
      RETURNING oa.blob_url,
                NOT EXISTS (
                  SELECT 1 FROM attachments a WHERE a.blob_url = oa.blob_url
                ) AS "blobUnreferenced"
    `
    if (!row) {
      res.statusCode = 404
      res.end(JSON.stringify({ error: 'Attachment not found' }))
      return
    }
    // Best effort: the row is already gone, and a stranded blob is the
    // orphan sweep's problem rather than a failed removal for the user.
    if (row.blobUnreferenced) {
      try {
        await services.deleteBlob(row.blob_url)
      } catch (err) {
        console.error('failed to delete attachment blob:', err.message)
      }
    }
    res.statusCode = 204
    res.end()
  } catch (err) {
    if (isUndefinedOutboundAttachmentsTable(err)) {
      res.statusCode = 404
      res.end(JSON.stringify({ error: 'Attachment not found' }))
      return
    }
    throw err
  }
}

async function handleAttachment(req, res, userId, services) {
  if (req.method === 'POST') {
    await registerUploadedAttachment(req, res, userId, services)
    return
  }
  if (req.method === 'DELETE') {
    await deleteUploadedAttachment(req, res, userId, services)
    return
  }
  res.statusCode = 405
  res.end(JSON.stringify({ error: 'Method not allowed' }))
}

export function createHandler(overrides = {}) {
  const services = createServices({
    createResend: (key) => new Resend(key),
    readBlob: (url) => get(url, { access: 'private', token: process.env.BLOB_READ_WRITE_TOKEN }),
    headBlob: (url) => head(url, { token: process.env.BLOB_READ_WRITE_TOKEN }),
    deleteBlob: (url) => del(url, { token: process.env.BLOB_READ_WRITE_TOKEN }),
    handleBlobUpload: handleUpload,
    ...overrides,
  })
  return async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json')
    const resource = new URL(req.url, 'http://localhost').searchParams.get('resource')

    // The flush job authenticates with its own bearer secret, not a user
    // Auth0 token, so it must be dispatched before verifyAccessToken runs.
    if (resource === 'flush') {
      await handleFlush(req, res, services)
      return
    }

    let userId
    try {
      ;({ userId } = await services.verifyAccessToken(req))
    } catch (error) {
      writeAuthError(res, error)
      return
    }

    try {
      if (resource === 'scheduled') {
        await handleScheduled(req, res, userId, services)
        return
      }
      if (resource === 'follow-up') {
        await handleFollowUp(req, res, userId, services)
        return
      }
      if (resource === 'upload-token') {
        await handleAttachmentUploadToken(req, res, userId, services)
        return
      }
      if (resource === 'attachment') {
        await handleAttachment(req, res, userId, services)
        return
      }
      await handleSend(req, res, userId, services)
    } catch (err) {
      console.error(`${req.method} /api/send failed:`, err)
      res.statusCode = 500
      res.end(JSON.stringify({ error: 'Failed to send email' }))
    }
  }
}

export default createHandler()
