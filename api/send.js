import process from 'node:process'
import crypto from 'node:crypto'
import { Buffer } from 'node:buffer'

import { Resend } from 'resend'

import { getSql } from './_lib/db.js'
import { verifyAccessToken } from './_lib/auth.js'
import { captureApiError } from './_lib/sentry.js'
import { readJsonBody } from './_lib/body.js'
import { embedText, EMBEDDING_MODEL } from './_lib/embeddings.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SNIPPET_LENGTH = 100
export const MAX_OUTBOUND_RECIPIENTS = 20
export const MAX_OUTBOUND_SUBJECT_BYTES = 998
export const MAX_OUTBOUND_TEXT_BYTES = 100_000
export const MAX_OUTBOUND_HTML_BYTES = 200_000
export const MAX_OUTBOUND_TOTAL_BYTES = 256_000
const OUTBOUND_SENDS_PER_MINUTE = 10

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function buildReadReceiptUrl(token, env = process.env) {
  const configured = env.PUBLIC_APP_URL || env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL
  if (!configured || !UUID_RE.test(token)) return null
  const base = /^https?:\/\//i.test(configured) ? configured : `https://${configured}`
  try {
    const url = new URL('/api/read-receipts', base)
    url.searchParams.set('token', token)
    return url.toString()
  } catch {
    return null
  }
}

export function appendReadReceipt(html, text, receiptUrl) {
  if (!receiptUrl) return html
  const content = html || escapeHtml(text).replaceAll('\n', '<br>')
  return `${content}<img src="${receiptUrl}" width="1" height="1" alt="" style="display:none;width:1px;height:1px;border:0" />`
}

function makeSnippet(text) {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length > SNIPPET_LENGTH
    ? `${collapsed.slice(0, SNIPPET_LENGTH)}...`
    : collapsed
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
export function parseRecipients(to) {
  if (typeof to !== 'string') return []
  const recipients = to.split(',').map((address) => address.trim()).filter(Boolean)
  if (recipients.length > MAX_OUTBOUND_RECIPIENTS) return []
  return recipients
}

export function validateOutboundMessage({ to, subject, text, html }) {
  const recipients = parseRecipients(to)
  const bodyHtml = typeof html === 'string' && html.trim() ? html : null
  if (
    recipients.length === 0 ||
    !recipients.every((address) => address.length <= 320 && address.includes('@')) ||
    typeof subject !== 'string' || !subject.trim() ||
    typeof text !== 'string' || !text.trim()
  ) {
    return { error: 'to, subject and text are required and must be valid' }
  }

  const subjectBytes = Buffer.byteLength(subject)
  const textBytes = Buffer.byteLength(text)
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

export async function claimOutboundEmailQuota(sql, email) {
  const [result] = await sql`
    WITH app_user AS (
      SELECT id
      FROM users
      WHERE lower(email) = ${email}
      LIMIT 1
    ), claimed AS (
      INSERT INTO outbound_email_quotas (user_id, window_start, send_count)
      SELECT id, date_trunc('minute', now()), 1
      FROM app_user
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
      EXISTS (SELECT 1 FROM app_user) AS authorized,
      EXISTS (SELECT 1 FROM claimed) AS quota_claimed
  `
  return result || { authorized: false, quota_claimed: false }
}

// Stores the sent copy in the existing tables (is_sent=true, excluded from
// the inbox list, included in search). Threads with the replied-to message
// when replyToMessageId is given; otherwise starts a fresh thread.
async function storeSentMessage(
  sql,
  email,
  { recipients, subject, text, html, replyToMessageId, resendId, readReceiptToken },
) {
  const [lookup] = await sql`
    SELECT u.id AS user_id,
           CASE WHEN ${replyToMessageId ?? null}::uuid IS NOT NULL THEN
             (SELECT m.thread_id FROM messages m
              WHERE m.id = ${replyToMessageId ?? null}::uuid AND m.user_id = u.id)
           END AS thread_id
    FROM users u
    WHERE lower(u.email) = ${email}
    LIMIT 1
  `
  if (!lookup) {
    throw new Error('no users row matches the authenticated user; sent copy not stored')
  }

  const { name: fromName, address: fromAddress } = parseFromEnv(
    process.env.EMAIL_FROM || 'Allister <me@allisterantosik.com>',
  )
  const messageUuid = crypto.randomUUID()
  const threadUuid = lookup.thread_id ?? crypto.randomUUID()
  const sentAt = new Date().toISOString()
  const recipientsJson = JSON.stringify({
    to: recipients.map((address) => ({ name: null, address })),
    cc: [],
    bcc: [],
  })
  const messageId = resendId ? `<${resendId}@resend.cookie-web>` : null

  const statements = []
  if (!lookup.thread_id) {
    statements.push((sql) => sql`
      INSERT INTO threads (id, user_id, subject, last_message_at)
      VALUES (${threadUuid}, ${lookup.user_id}, ${subject}, ${sentAt})
    `)
  }
  statements.push((sql) => sql`
    INSERT INTO messages (id, thread_id, user_id, from_name, from_address,
                          recipients, subject, snippet, body_text, body_html, sent_at,
                          message_id, is_unread, is_sent)
    VALUES (${messageUuid}, ${threadUuid}, ${lookup.user_id}, ${fromName},
            ${fromAddress}, ${recipientsJson}::jsonb, ${subject}, ${makeSnippet(text)},
            ${text}, ${html ?? null}, ${sentAt}, ${messageId}, false, true)
    ON CONFLICT (user_id, message_id) WHERE message_id IS NOT NULL DO NOTHING
  `)
  if (lookup.thread_id) {
    statements.push((sql) => sql`
      UPDATE threads
      SET message_count = message_count + 1,
          last_message_at = GREATEST(last_message_at, ${sentAt}::timestamptz)
      WHERE id = ${threadUuid}
        AND EXISTS (SELECT 1 FROM messages WHERE id = ${messageUuid})
    `)
  }
  await sql.begin(async (sql) => {
    for (const statement of statements) {
      await statement(sql)
    }
  })

  // Best effort and outside the sent-copy transaction: during a rolling
  // migration, a missing receipt table must not roll back the sent message.
  if (readReceiptToken) {
    try {
      await sql`
        INSERT INTO message_read_receipts (message_id, user_id, token)
        SELECT m.id, m.user_id, ${readReceiptToken}::uuid
        FROM messages m
        WHERE m.id = ${messageUuid} AND m.user_id = ${lookup.user_id}
        ON CONFLICT (message_id) DO NOTHING
      `
    } catch (err) {
      console.error('failed to store read receipt:', err.message)
    }
  }

  // Best-effort embedding so sent mail is semantically searchable; NULL rows
  // are healed by the Backfill Embeddings workflow.
  if (process.env.OPENAI_API_KEY) {
    try {
      const vector = JSON.stringify(
        await embedText(`${subject}\n\n${text}`, process.env.OPENAI_API_KEY),
      )
      await sql`
        UPDATE messages
        SET embedding = ${vector}::extensions.vector, embedding_model = ${EMBEDDING_MODEL}
        WHERE id = ${messageUuid} AND embedding IS NULL
      `
    } catch (err) {
      console.error('sent-message embedding failed:', err.message)
    }
  }
}

// POST /api/send — send an email through Resend as the app's mailbox address,
// then store the sent copy. Sending always wins: a storage failure is logged
// and the response is still a success.
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json')

  if (req.method !== 'POST') {
    res.statusCode = 405
    res.end(JSON.stringify({ error: 'Method not allowed' }))
    return
  }

  let email
  try {
    ;({ email } = await verifyAccessToken(req))
  } catch {
    res.statusCode = 401
    res.end(JSON.stringify({ error: 'Unauthorized' }))
    return
  }

  if (!process.env.RESEND_API_KEY) {
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

  const { to, subject, text, html, replyToMessageId } = body
  const validated = validateOutboundMessage({ to, subject, text, html })
  if (validated.error) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: validated.error }))
    return
  }
  const { recipients, bodyHtml } = validated

  let sql
  try {
    sql = getSql()
    const quota = await claimOutboundEmailQuota(sql, email)
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
    await captureApiError(err, { route: 'POST /api/send (quota)' })
    res.statusCode = 503
    res.end(JSON.stringify({ error: 'Email sending is temporarily unavailable' }))
    return
  }
  // Fixture ids from e2e/dev mode aren't UUIDs — ignore them rather than error.
  const replyTo =
    typeof replyToMessageId === 'string' && UUID_RE.test(replyToMessageId)
      ? replyToMessageId
      : null
  const readReceiptToken = crypto.randomUUID()
  const receiptUrl = buildReadReceiptUrl(readReceiptToken)
  const trackedHtml = appendReadReceipt(bodyHtml, text, receiptUrl)

  try {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || 'Allister <me@allisterantosik.com>',
      to: recipients,
      subject,
      text,
      ...(trackedHtml ? { html: trackedHtml } : {}),
    })
    if (error) {
      console.error('Resend send failed:', error)
      res.statusCode = 502
      res.end(JSON.stringify({ error: 'Failed to send email' }))
      return
    }

    try {
      await storeSentMessage(sql, email, {
        recipients,
        subject,
        text,
        html: bodyHtml,
        replyToMessageId: replyTo,
        resendId: data.id,
        readReceiptToken: receiptUrl ? readReceiptToken : null,
      })
    } catch (err) {
      console.error('failed to store sent copy:', err.message)
    }

    res.statusCode = 200
    res.end(JSON.stringify({ id: data.id }))
  } catch (err) {
    console.error('POST /api/send failed:', err)
    await captureApiError(err, { route: 'POST /api/send' })
    res.statusCode = 500
    res.end(JSON.stringify({ error: 'Failed to send email' }))
  }
}
