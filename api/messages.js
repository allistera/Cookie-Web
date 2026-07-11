import { getSql } from './_lib/db.js'
import { verifyAccessToken } from './_lib/auth.js'
import { captureApiError } from './_lib/sentry.js'
import { readJsonBody } from './_lib/body.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// GET /api/messages?id=<uuid> — the full body of a single message owned by the
// authenticated user, fetched on demand when the reader opens (body_html is
// deliberately excluded from the /api/emails list payload as it can be large
// and untrusted). Returns {id, body_html, body_text}; 404 for a message that
// is not the caller's (or does not exist), 400 for a malformed id.
async function handleGet(req, res, sub) {
  const id = new URL(req.url, 'http://localhost').searchParams.get('id')
  if (typeof id !== 'string' || !UUID_RE.test(id)) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'A valid message id is required' }))
    return
  }

  try {
    const sql = getSql()
    const rows = await sql`
      SELECT m.id, m.body_html, m.body_text
      FROM messages m
      JOIN users u ON u.id = m.user_id
      WHERE m.id = ${id} AND u.auth0_sub = ${sub}
    `
    if (rows.length === 0) {
      res.statusCode = 404
      res.end(JSON.stringify({ error: 'Message not found' }))
      return
    }
    res.statusCode = 200
    res.end(JSON.stringify(rows[0]))
  } catch (err) {
    console.error('GET /api/messages failed:', err)
    await captureApiError(err, { route: 'GET /api/messages' })
    res.statusCode = 500
    res.end(JSON.stringify({ error: 'Failed to load message' }))
  }
}

// GET returns a single message body; PATCH updates flags (is_unread,
// is_starred, is_archived) on a message owned by the authenticated user.
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json')

  if (req.method !== 'GET' && req.method !== 'PATCH') {
    res.statusCode = 405
    res.end(JSON.stringify({ error: 'Method not allowed' }))
    return
  }

  let sub
  try {
    ;({ sub } = await verifyAccessToken(req))
  } catch {
    res.statusCode = 401
    res.end(JSON.stringify({ error: 'Unauthorized' }))
    return
  }

  if (req.method === 'GET') {
    return handleGet(req, res, sub)
  }

  let body
  try {
    body = await readJsonBody(req)
  } catch {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'Invalid JSON body' }))
    return
  }

  const { id, is_unread, is_starred, is_archived } = body
  const flags = [is_unread, is_starred, is_archived]
  const validId = typeof id === 'string' && UUID_RE.test(id)
  const flagsValid = flags.every((f) => f === undefined || typeof f === 'boolean')
  const hasChange = flags.some((f) => typeof f === 'boolean')
  if (!validId || !flagsValid || !hasChange) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'id and at least one boolean flag are required' }))
    return
  }

  try {
    const sql = getSql()
    const rows = await sql`
      UPDATE messages m SET
        is_unread   = COALESCE(${is_unread ?? null}::boolean, m.is_unread),
        is_starred  = COALESCE(${is_starred ?? null}::boolean, m.is_starred),
        is_archived = COALESCE(${is_archived ?? null}::boolean, m.is_archived)
      FROM users u
      WHERE m.id = ${id} AND m.user_id = u.id AND u.auth0_sub = ${sub}
      RETURNING m.id, m.is_unread, m.is_starred, m.is_archived
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
