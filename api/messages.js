import process from 'node:process'

import { Resend } from 'resend'

import { getSql } from './_lib/db.js'
import { verifyAccessToken } from './_lib/auth.js'
import { captureApiError } from './_lib/sentry.js'
import { readJsonBody } from './_lib/body.js'
import { parseListUnsubscribe, isSafeUnsubscribeUrl } from './_lib/unsubscribe.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// GET /api/messages?id=<uuid> — the full body of a single message owned by the
// authenticated user, fetched on demand when the reader opens (body_html is
// deliberately excluded from the /api/emails list payload as it can be large
// and untrusted). The saved AI summary is returned alongside the body so the
// reader can restore it without inflating every inbox-list response.
export function fetchOwnedMessageBody(sql, id, email) {
  return sql`
    SELECT m.id, m.body_html, m.body_text, m.headers, ai.summary
    FROM messages m
    JOIN users u ON u.id = m.user_id
    LEFT JOIN message_ai ai ON ai.message_id = m.id
    WHERE m.id = ${id} AND lower(u.email) = ${email}
  `
}

// 404 for a message that is not the caller's (or does not exist), 400 for a
// malformed id.
async function handleGet(req, res, email) {
  const id = new URL(req.url, 'http://localhost').searchParams.get('id')
  if (typeof id !== 'string' || !UUID_RE.test(id)) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'A valid message id is required' }))
    return
  }

  try {
    const sql = getSql()
    const rows = await fetchOwnedMessageBody(sql, id, email)
    if (rows.length === 0) {
      res.statusCode = 404
      res.end(JSON.stringify({ error: 'Message not found' }))
      return
    }
    // Never return the raw sender-controlled headers to the client; expose only
    // the parsed, safe unsubscribe summary.
    const { headers, ...rest } = rows[0]
    res.statusCode = 200
    res.end(JSON.stringify({ ...rest, unsubscribe: parseListUnsubscribe(headers) }))
  } catch (err) {
    console.error('GET /api/messages failed:', err)
    await captureApiError(err, { route: 'GET /api/messages' })
    res.statusCode = 500
    res.end(JSON.stringify({ error: 'Failed to load message' }))
  }
}

// Apply or remove one of the caller's user labels on a message they own. Both
// the message and the label are ownership-checked before the join row changes,
// and the message's full label set is returned so the reader can resync its
// pills. add_label is idempotent (ON CONFLICT DO NOTHING).
async function mutateMessageLabel(res, email, messageId, action, labelId) {
  if (typeof labelId !== 'string' || !UUID_RE.test(labelId)) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'A valid label_id is required' }))
    return
  }

  try {
    const sql = getSql()
    const [owns] = await sql`
      SELECT
        EXISTS (
          SELECT 1 FROM messages m JOIN users u ON u.id = m.user_id
          WHERE m.id = ${messageId} AND lower(u.email) = ${email}
        ) AS message,
        EXISTS (
          SELECT 1 FROM labels l JOIN users u ON u.id = l.user_id
          WHERE l.id = ${labelId} AND lower(u.email) = ${email} AND l.kind = 'user'
        ) AS label
    `
    if (!owns?.message) {
      res.statusCode = 404
      res.end(JSON.stringify({ error: 'Message not found' }))
      return
    }
    if (!owns?.label) {
      res.statusCode = 404
      res.end(JSON.stringify({ error: 'Label not found' }))
      return
    }

    if (action === 'add_label') {
      await sql`
        INSERT INTO message_labels (message_id, label_id)
        VALUES (${messageId}, ${labelId})
        ON CONFLICT DO NOTHING
      `
    } else {
      await sql`
        DELETE FROM message_labels
        WHERE message_id = ${messageId} AND label_id = ${labelId}
      `
    }

    // Return the same {name, color, kind} shape the list endpoint uses.
    const labels = await sql`
      SELECT l.name, l.color, l.kind
      FROM message_labels ml
      JOIN labels l ON l.id = ml.label_id
      WHERE ml.message_id = ${messageId}
      ORDER BY l.name
    `
    res.statusCode = 200
    res.end(JSON.stringify({ labels }))
  } catch (err) {
    console.error('POST /api/messages label change failed:', err)
    await captureApiError(err, { route: 'POST /api/messages (label)' })
    res.statusCode = 500
    res.end(JSON.stringify({ error: 'Failed to update labels' }))
  }
}

// POST /api/messages — { id, action: 'unsubscribe' } acts on a message owned by
// the authenticated user. Parses the (untrusted) List-Unsubscribe headers and,
// in preference order: performs a server-side, SSRF-guarded one-click POST;
// sends a mailto unsubscribe via Resend; or returns a safe target for the
// client to open manually. No DB writes.
async function handlePost(req, res, email) {
  let body
  try {
    body = await readJsonBody(req)
  } catch {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'Invalid JSON body' }))
    return
  }

  const { id, action } = body
  if (typeof id !== 'string' || !UUID_RE.test(id)) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'A valid id is required' }))
    return
  }

  // Tagging: apply or remove one of the user's labels on the message.
  if (action === 'add_label' || action === 'remove_label') {
    return mutateMessageLabel(res, email, id, action, body.label_id)
  }

  if (action !== 'unsubscribe') {
    res.statusCode = 400
    res.end(JSON.stringify({ error: "A valid id and action are required" }))
    return
  }

  try {
    const sql = getSql()
    const rows = await sql`
      SELECT m.headers
      FROM messages m
      JOIN users u ON u.id = m.user_id
      WHERE m.id = ${id} AND lower(u.email) = ${email}
    `
    if (rows.length === 0) {
      res.statusCode = 404
      res.end(JSON.stringify({ error: 'Message not found' }))
      return
    }

    const parsed = parseListUnsubscribe(rows[0].headers)
    if (!parsed) {
      res.statusCode = 422
      res.end(JSON.stringify({ error: 'Message has no unsubscribe information' }))
      return
    }
    const { oneClick, url, mailto } = parsed

    // 1. RFC 8058 one-click: server-side POST, only to an SSRF-safe https URL.
    if (oneClick && url && isSafeUnsubscribeUrl(url)) {
      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'List-Unsubscribe=One-Click',
          redirect: 'manual',
          signal: AbortSignal.timeout(10000),
        })
        if (resp.status < 400) {
          res.statusCode = 200
          res.end(JSON.stringify({ status: 'unsubscribed', method: 'one-click' }))
          return
        }
        console.error('one-click unsubscribe returned status', resp.status)
      } catch (err) {
        console.error('one-click unsubscribe request failed:', err.message)
      }
      // fall through to the fallbacks below on any failure/timeout — never 500.
    }

    // 2. mailto unsubscribe via Resend (when configured).
    if (mailto && process.env.RESEND_API_KEY) {
      try {
        const resend = new Resend(process.env.RESEND_API_KEY)
        const { error } = await resend.emails.send({
          from: process.env.EMAIL_FROM || 'Allister <me@allisterantosik.com>',
          to: [mailto.address],
          subject: mailto.subject || 'unsubscribe',
          text: 'Please unsubscribe me from this mailing list.',
        })
        if (error) throw new Error(error.message || 'Resend send failed')
        res.statusCode = 200
        res.end(JSON.stringify({ status: 'unsubscribed', method: 'mailto' }))
        return
      } catch (err) {
        console.error('mailto unsubscribe via Resend failed:', err.message)
        // Resend failed — try the link fallback, else 502.
        if (url && isSafeUnsubscribeUrl(url)) {
          res.statusCode = 200
          res.end(JSON.stringify({ status: 'manual', method: 'link', url }))
          return
        }
        res.statusCode = 502
        res.end(JSON.stringify({ error: 'Failed to unsubscribe' }))
        return
      }
    }

    // 3. Safe https link for the client to open manually.
    if (url && isSafeUnsubscribeUrl(url)) {
      res.statusCode = 200
      res.end(JSON.stringify({ status: 'manual', method: 'link', url }))
      return
    }

    // 4. mailto with no Resend key: hand the client a mailto: URI to open.
    if (mailto) {
      const mailtoUri =
        'mailto:' +
        mailto.address +
        (mailto.subject ? '?subject=' + encodeURIComponent(mailto.subject) : '')
      res.statusCode = 200
      res.end(JSON.stringify({ status: 'manual', method: 'mailto', mailto: mailtoUri }))
      return
    }

    // 5. Nothing safe/usable (e.g. only an unsafe URL).
    res.statusCode = 422
    res.end(JSON.stringify({ error: 'No safe unsubscribe method is available' }))
  } catch (err) {
    console.error('POST /api/messages failed:', err)
    await captureApiError(err, { route: 'POST /api/messages' })
    res.statusCode = 500
    res.end(JSON.stringify({ error: 'Failed to unsubscribe' }))
  }
}

// GET returns a single message body (plus a parsed unsubscribe summary); POST
// acts on the unsubscribe or applies/removes a label (action: 'add_label' |
// 'remove_label' with a label_id); PATCH updates flags (is_unread, is_starred,
// is_archived, scheduled_for) on a message owned by the authenticated user.
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json')

  if (req.method !== 'GET' && req.method !== 'PATCH' && req.method !== 'POST') {
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

  if (req.method === 'GET') {
    return handleGet(req, res, email)
  }

  if (req.method === 'POST') {
    return handlePost(req, res, email)
  }

  let body
  try {
    body = await readJsonBody(req)
  } catch {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'Invalid JSON body' }))
    return
  }

  const { id, is_unread, is_starred, is_archived, scheduled_for } = body
  const flags = [is_unread, is_starred, is_archived]
  const validId = typeof id === 'string' && UUID_RE.test(id)
  const flagsValid = flags.every((f) => f === undefined || typeof f === 'boolean')
  const hasScheduledChange = Object.hasOwn(body, 'scheduled_for')
  const scheduledForValid =
    !hasScheduledChange ||
    scheduled_for === null ||
    (typeof scheduled_for === 'string' && Number.isFinite(Date.parse(scheduled_for)))
  const hasChange = flags.some((f) => typeof f === 'boolean') || hasScheduledChange
  if (!validId || !flagsValid || !scheduledForValid || !hasChange) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'id and at least one valid change are required' }))
    return
  }

  try {
    const sql = getSql()
    const rows = await sql`
      UPDATE messages m SET
        is_unread   = COALESCE(${is_unread ?? null}::boolean, m.is_unread),
        is_starred  = COALESCE(${is_starred ?? null}::boolean, m.is_starred),
        is_archived = COALESCE(${is_archived ?? null}::boolean, m.is_archived),
        scheduled_for = CASE
          WHEN ${hasScheduledChange}::boolean THEN ${scheduled_for ?? null}::timestamptz
          ELSE m.scheduled_for
        END
      FROM users u
      WHERE m.id = ${id} AND m.user_id = u.id AND lower(u.email) = ${email}
      RETURNING m.id, m.is_unread, m.is_starred, m.is_archived, m.scheduled_for
    `
    if (rows.length === 0) {
      res.statusCode = 404
      res.end(JSON.stringify({ error: 'Message not found' }))
      return
    }
    res.statusCode = 200
    res.end(JSON.stringify({ message: rows[0] }))
  } catch (err) {
    console.error('PATCH /api/messages failed:', err)
    await captureApiError(err, { route: 'PATCH /api/messages' })
    res.statusCode = 500
    res.end(JSON.stringify({ error: 'Failed to update message' }))
  }
}
