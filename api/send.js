import process from 'node:process'
import crypto from 'node:crypto'

import { Resend } from 'resend'

import { getSql } from './_lib/db.js'
import { verifyAccessToken } from './_lib/auth.js'
import { captureApiError } from './_lib/sentry.js'
import { readJsonBody } from './_lib/body.js'
import { embedText, EMBEDDING_MODEL } from './_lib/embeddings.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SNIPPET_LENGTH = 100

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

// Stores the sent copy in the existing tables (is_sent=true, excluded from
// the inbox list, included in search). Threads with the replied-to message
// when replyToMessageId is given; otherwise starts a fresh thread.
async function storeSentMessage(sql, email, { to, subject, text, replyToMessageId, resendId }) {
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
  const recipients = JSON.stringify({ to: [{ name: null, address: to }], cc: [], bcc: [] })
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
                          recipients, subject, snippet, body_text, sent_at,
                          message_id, is_unread, is_sent)
    VALUES (${messageUuid}, ${threadUuid}, ${lookup.user_id}, ${fromName},
            ${fromAddress}, ${recipients}::jsonb, ${subject}, ${makeSnippet(text)},
            ${text}, ${sentAt}, ${messageId}, false, true)
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

  const { to, subject, text, replyToMessageId } = body
  if (
    typeof to !== 'string' || !to.includes('@') ||
    typeof subject !== 'string' || !subject.trim() ||
    typeof text !== 'string' || !text.trim()
  ) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'to, subject and text are required' }))
    return
  }
  // Fixture ids from e2e/dev mode aren't UUIDs — ignore them rather than error.
  const replyTo =
    typeof replyToMessageId === 'string' && UUID_RE.test(replyToMessageId)
      ? replyToMessageId
      : null

  try {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || 'Allister <me@allisterantosik.com>',
      to: [to],
      subject,
      text,
    })
    if (error) {
      console.error('Resend send failed:', error)
      res.statusCode = 502
      res.end(JSON.stringify({ error: 'Failed to send email' }))
      return
    }

    try {
      const sql = getSql()
      await storeSentMessage(sql, email, {
        to,
        subject,
        text,
        replyToMessageId: replyTo,
        resendId: data.id,
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
