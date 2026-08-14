import process from 'node:process'
import crypto from 'node:crypto'
import { Buffer } from 'node:buffer'

import { Resend } from 'resend'

import { createServices } from './_lib/services.js'
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
// A scheduled send needs enough lead time that it can't fire before the
// composer has even finished closing — matches ScheduleMenu's own minimum.
const MIN_SCHEDULE_LEAD_MS = 60_000
export const MAX_PENDING_SCHEDULED_SENDS = 50
const FLUSH_BATCH_SIZE = 20
// After this many failed delivery attempts a scheduled send stops retrying
// and is surfaced to the user as failed, rather than silently retried on
// every flush forever.
const MAX_SCHEDULED_SEND_ATTEMPTS = 5
// Resolved scheduled_sends rows and expired read receipts otherwise
// accumulate forever; the flush job is the only periodic cron trigger this
// app has, so it doubles as the sweep for both.
const RESOLVED_STATE_RETENTION_DAYS = 30

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
  if (!(to?.split instanceof Function)) return []
  const recipients = to.split(',').map((address) => address.trim()).filter(Boolean)
  if (recipients.length > MAX_OUTBOUND_RECIPIENTS) return []
  return recipients
}

export function validateOutboundMessage({ to, subject, text, html }) {
  const recipients = parseRecipients(to)
  const htmlText = String(html ?? '')
  const bodyHtml = htmlText.trim() ? htmlText : null
  const subjectText = String(subject ?? '')
  const bodyText = String(text ?? '')
  if (
    recipients.length === 0 ||
    !recipients.every((address) => address.length <= 320 && address.includes('@')) ||
    !subjectText.trim() ||
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
// when replyToMessageId is given; otherwise starts a fresh thread. Returns
// the new message's id so callers (e.g. the scheduled-send flush job) can
// link back to it.
async function storeSentMessage(
  sql,
  email,
  { recipients, subject, text, html, replyToMessageId, resendId, readReceiptToken },
  services,
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
  // are healed by the Backfill Embeddings workflow. Not awaited: the send
  // response shouldn't wait on an OpenAI round trip for a value that's
  // already designed to be safely missing and healed later.
  if (process.env.OPENAI_API_KEY) {
    services
      .embedText(`${subject}\n\n${text}`, process.env.OPENAI_API_KEY)
      .then(
        (vector) => sql`
          UPDATE messages
          SET embedding = ${JSON.stringify(vector)}::extensions.vector, embedding_model = ${EMBEDDING_MODEL}
          WHERE id = ${messageUuid} AND embedding IS NULL
        `,
      )
      .catch((err) => console.error('sent-message embedding failed:', err.message))
  }

  return { messageUuid }
}

// Sends immediately through Resend, from the shared inbound handler (a
// logged-in user's request) and the flush job (a claimed scheduled row)
// alike. Throws on failure; callers decide how to react.
async function deliverMail(sql, email, { recipients, subject, text, html, replyToMessageId }, services) {
  const readReceiptToken = crypto.randomUUID()
  const receiptUrl = buildReadReceiptUrl(readReceiptToken)
  const trackedHtml = appendReadReceipt(html, text, receiptUrl)

  const resend = services.createResend(process.env.RESEND_API_KEY)
  const payload = {
    from: process.env.EMAIL_FROM || 'Allister <me@allisterantosik.com>',
    to: recipients,
    subject,
    text,
  }
  if (trackedHtml) payload.html = trackedHtml
  const { data, error } = await resend.emails.send(payload)
  if (error) throw new Error(error.message || 'Failed to send email')

  let messageUuid = null
  try {
    ;({ messageUuid } = await storeSentMessage(
      sql,
      email,
      {
        recipients,
        subject,
        text,
        html,
        replyToMessageId,
        resendId: data.id,
        readReceiptToken: receiptUrl ? readReceiptToken : null,
      },
      services,
    ))
  } catch (err) {
    // Sending always wins: a storage failure is logged but the mail really
    // did go out, so this must never be treated as a failed send.
    console.error('failed to store sent copy:', err.message)
  }
  return { resendId: data.id, messageUuid }
}

// Inserts a pending scheduled_sends row, capped at MAX_PENDING_SCHEDULED_SENDS
// per user so a runaway client can't queue unbounded future sends. Returns
// null if the cap is hit or the authenticated email has no users row.
async function createScheduledSend(
  sql,
  email,
  { recipients, subject, text, html, replyToMessageId, scheduledFor },
) {
  const [row] = await sql`
    INSERT INTO scheduled_sends
      (user_id, to_addresses, subject, body_text, body_html, reply_to_message_id, scheduled_for)
    SELECT u.id, ${recipients.join(', ')}, ${subject}, ${text}, ${html ?? null},
           ${replyToMessageId}::uuid, ${scheduledFor}::timestamptz
    FROM users u
    WHERE lower(u.email) = ${email}
      AND (
        SELECT count(*) FROM scheduled_sends s
        WHERE s.user_id = u.id AND s.status = 'pending'
      ) < ${MAX_PENDING_SCHEDULED_SENDS}
    RETURNING id, to_addresses AS "toAddresses", subject, scheduled_for AS "scheduledFor"
  `
  return row ?? null
}

async function listScheduledSends(sql, email) {
  return sql`
    SELECT s.id, s.to_addresses AS "toAddresses", s.subject, s.scheduled_for AS "scheduledFor",
           s.status, s.last_error AS "lastError"
    FROM scheduled_sends s
    JOIN users u ON u.id = s.user_id
    WHERE lower(u.email) = ${email} AND s.status IN ('pending', 'failed')
    ORDER BY s.scheduled_for ASC
  `
}

// Only a still-pending row can be canceled — one already claimed by the
// flush job (status 'sending') or already resolved ('sent'/'failed') is
// left alone. Returns the full content so the client can reopen it in the
// composer, mirroring undoPendingSend's immediate-send equivalent.
async function cancelScheduledSend(sql, email, id) {
  const [row] = await sql`
    DELETE FROM scheduled_sends s
    USING users u
    WHERE s.id = ${id} AND s.user_id = u.id AND lower(u.email) = ${email} AND s.status = 'pending'
    RETURNING s.id, s.to_addresses AS "toAddresses", s.subject,
              s.body_text AS "text", s.body_html AS "html",
              s.reply_to_message_id AS "replyToMessageId"
  `
  return row ?? null
}

// Atomically claims up to `limit` due rows so two overlapping flush calls
// (e.g. a slow run overlapping the next tick) never send the same row twice
// — FOR UPDATE SKIP LOCKED lets a concurrent call skip rows this one already
// has locked instead of blocking on them.
async function claimDueScheduledSends(sql, limit) {
  return sql`
    UPDATE scheduled_sends s
    SET status = 'sending'
    FROM (
      SELECT id FROM scheduled_sends
      WHERE status = 'pending' AND scheduled_for <= now()
      ORDER BY scheduled_for
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    ) due
    WHERE s.id = due.id
    RETURNING s.id, s.user_id, s.to_addresses AS "toAddresses", s.subject,
              s.body_text AS "text", s.body_html AS "html",
              s.reply_to_message_id AS "replyToMessageId", s.attempts
  `
}

async function markScheduledSendFailed(sql, id, error, attempts = null) {
  await sql`
    UPDATE scheduled_sends
    SET status = 'failed', last_error = ${error},
        attempts = COALESCE(${attempts}, attempts)
    WHERE id = ${id}
  `
}

// Delivers one claimed row. Never leaves a row claimed ('sending' status)
// without resolving it to 'pending' (retry), 'sent', or 'failed'.
async function deliverScheduledSend(sql, row, services) {
  const [owner] = await sql`SELECT lower(email) AS email FROM users WHERE id = ${row.user_id}`
  if (!owner) {
    await markScheduledSendFailed(sql, row.id, 'Owning user no longer exists')
    return 'failed'
  }

  const quota = await claimOutboundEmailQuota(sql, owner.email)
  if (!quota.authorized) {
    await markScheduledSendFailed(sql, row.id, 'Mailbox access is not provisioned')
    return 'failed'
  }
  if (!quota.quota_claimed) {
    // Rate-limited, not the message's fault — leave it pending for the next
    // flush instead of spending a retry attempt.
    await sql`UPDATE scheduled_sends SET status = 'pending' WHERE id = ${row.id}`
    return 'retried'
  }

  const recipients = parseRecipients(row.toAddresses)
  try {
    const { messageUuid } = await deliverMail(
      sql,
      owner.email,
      {
        recipients,
        subject: row.subject,
        text: row.text,
        html: row.html,
        replyToMessageId: row.replyToMessageId,
      },
      services,
    )
    await sql`
      UPDATE scheduled_sends
      SET status = 'sent', sent_at = now(), sent_message_id = ${messageUuid}
      WHERE id = ${row.id}
    `
    return 'sent'
  } catch (err) {
    const attempts = row.attempts + 1
    console.error(`scheduled send ${row.id} delivery failed (attempt ${attempts}):`, err.message)
    if (attempts >= MAX_SCHEDULED_SEND_ATTEMPTS) {
      await markScheduledSendFailed(sql, row.id, err.message, attempts)
      return 'failed'
    }
    await sql`
      UPDATE scheduled_sends
      SET status = 'pending', attempts = ${attempts}, last_error = ${err.message}
      WHERE id = ${row.id}
    `
    return 'retried'
  }
}

// GET/DELETE /api/send?resource=scheduled — list or cancel the authenticated
// user's own pending (or recently failed) scheduled sends.
async function handleScheduled(req, res, email, services) {
  const sql = services.getSql()
  if (req.method === 'GET') {
    const scheduledSends = await listScheduledSends(sql, email)
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
    const scheduledSend = await cancelScheduledSend(sql, email, id)
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

// Hashing both sides to a fixed-length digest before comparing means
// crypto.timingSafeEqual (which requires equal-length buffers) works
// regardless of the two strings' actual lengths, and neither a length nor a
// byte-value mismatch is distinguishable by comparison time.
function timingSafeEqualStrings(a, b) {
  const digestA = crypto.createHash('sha256').update(String(a ?? '')).digest()
  const digestB = crypto.createHash('sha256').update(String(b ?? '')).digest()
  return crypto.timingSafeEqual(digestA, digestB)
}

// Best-effort; a sweep failure must never block the flush job's actual
// purpose of sending due mail.
async function sweepResolvedState(sql) {
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
  if (!process.env.RESEND_API_KEY) {
    res.statusCode = 503
    res.end(JSON.stringify({ error: 'Email sending is not configured' }))
    return
  }

  try {
    const sql = services.getSql()
    const claimed = await claimDueScheduledSends(sql, FLUSH_BATCH_SIZE)
    const results = []
    for (const row of claimed) {
      results.push(await deliverScheduledSend(sql, row, services))
    }
    await sweepResolvedState(sql)
    res.statusCode = 200
    res.end(JSON.stringify({
      claimed: claimed.length,
      sent: results.filter((result) => result === 'sent').length,
      retried: results.filter((result) => result === 'retried').length,
      failed: results.filter((result) => result === 'failed').length,
    }))
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
async function handleSend(req, res, email, services) {
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

  let body
  try {
    body = await readJsonBody(req)
  } catch {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'Invalid JSON body' }))
    return
  }

  const { to, subject, text, html, replyToMessageId, sendAt } = body
  const validated = validateOutboundMessage({ to, subject, text, html })
  if (validated.error) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: validated.error }))
    return
  }
  const { recipients, bodyHtml } = validated
  // Fixture ids from e2e/dev mode aren't UUIDs — ignore them rather than error.
  const replyTo = UUID_RE.test(replyToMessageId) ? String(replyToMessageId) : null

  if (sendAt !== undefined) {
    const scheduledFor = parseScheduledFor(sendAt)
    if (!scheduledFor) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'sendAt must be an ISO timestamp at least a minute out' }))
      return
    }
    try {
      const sql = services.getSql()
      const scheduledSend = await createScheduledSend(sql, email, {
        recipients,
        subject,
        text,
        html: bodyHtml,
        replyToMessageId: replyTo,
        scheduledFor,
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

  let sql
  try {
    sql = services.getSql()
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
    res.statusCode = 503
    res.end(JSON.stringify({ error: 'Email sending is temporarily unavailable' }))
    return
  }

  try {
    const { resendId } = await deliverMail(
      sql,
      email,
      {
        recipients,
        subject,
        text,
        html: bodyHtml,
        replyToMessageId: replyTo,
      },
      services,
    )
    res.statusCode = 200
    res.end(JSON.stringify({ id: resendId }))
  } catch (err) {
    console.error('Resend send failed:', err)
    res.statusCode = 502
    res.end(JSON.stringify({ error: 'Failed to send email' }))
  }
}

export function createHandler(overrides = {}) {
  const services = createServices({
    embedText,
    createResend: (key) => new Resend(key),
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

    let email
    try {
      ;({ email } = await services.verifyAccessToken(req))
    } catch {
      res.statusCode = 401
      res.end(JSON.stringify({ error: 'Unauthorized' }))
      return
    }

    try {
      if (resource === 'scheduled') {
        await handleScheduled(req, res, email, services)
        return
      }
      await handleSend(req, res, email, services)
    } catch (err) {
      console.error(`${req.method} /api/send failed:`, err)
      res.statusCode = 500
      res.end(JSON.stringify({ error: 'Failed to send email' }))
    }
  }
}

export default createHandler()
