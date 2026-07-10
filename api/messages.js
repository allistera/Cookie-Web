import { getSql } from './_lib/db.js'
import { verifyAccessToken } from './_lib/auth.js'
import { captureApiError } from './_lib/sentry.js'
import { readJsonBody } from './_lib/body.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// PATCH /api/messages — update flags (is_unread, is_starred, is_archived) on
// a message owned by the authenticated user.
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json')

  if (req.method !== 'PATCH') {
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
