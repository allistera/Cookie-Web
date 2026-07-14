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
// and untrusted). Returns {id, body_html, body_text}; 404 for a message that
// is not the caller's (or does not exist), 400 for a malformed id.
async function handleGet(req, res, email) {
  const id = new URL(req.url, 'http://localhost').searchParams.get('id')
  if (typeof id !== 'string' || !UUID_RE.test(id)) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'A valid message id is required' }))
    return
  }

  try {
    const sql = getSql()
    const rows = await sql`
      SELECT m.id, m.body_html, m.body_text, m.headers
      FROM messages m
      JOIN users u ON u.id = m.user_id
      WHERE m.id = ${id} AND lower(u.email) = ${email}
    `
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
  if (typeof id !== 'string' || !UUID_RE.test(id) || action !== 'unsubscribe') {
    res.statusCode = 400
    res.end(JSON.stringify({ error: "A valid id and action: 'unsubscribe' are required" }))
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
// acts on the unsubscribe; PATCH updates flags (is_unread, is_starred,
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
