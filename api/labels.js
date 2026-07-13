import { getSql } from './_lib/db.js'
import { verifyAccessToken } from './_lib/auth.js'
import { captureApiError } from './_lib/sentry.js'
import { readJsonBody } from './_lib/body.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const COLOR_RE = /^#[0-9a-f]{6}$/i
const MAX_NAME = 50
const MAX_DESCRIPTION = 200

async function listLabels(sql, email, res) {
  const labels = await sql`
    SELECT l.id, l.name, l.color, l.kind, l.description,
           count(ml.message_id)::int AS message_count
    FROM labels l
    JOIN users u ON u.id = l.user_id
    LEFT JOIN message_labels ml ON ml.label_id = l.id
    WHERE lower(u.email) = ${email}
    GROUP BY l.id
    ORDER BY l.name
  `
  res.statusCode = 200
  res.end(JSON.stringify({ labels }))
}

async function createLabel(sql, email, body, res) {
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const color = typeof body.color === 'string' ? body.color.trim() : ''
  const description =
    typeof body.description === 'string' ? body.description.trim() || null : null
  if (
    !name || name.length > MAX_NAME ||
    !COLOR_RE.test(color) ||
    (description && description.length > MAX_DESCRIPTION)
  ) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'name (max 50) and hex color are required' }))
    return
  }

  const [label] = await sql`
    INSERT INTO labels (user_id, name, color, description)
    SELECT u.id, ${name}, ${color}, ${description}
    FROM users u
    WHERE lower(u.email) = ${email}
    ON CONFLICT (user_id, name) DO NOTHING
    RETURNING id, name, color, kind, description, 0 AS message_count
  `
  if (!label) {
    // Either the name already exists or (rare) no users row: the unique
    // conflict is the overwhelmingly common case.
    res.statusCode = 409
    res.end(JSON.stringify({ error: 'A label with that name already exists' }))
    return
  }
  res.statusCode = 201
  res.end(JSON.stringify({ label }))
}

async function deleteLabel(sql, email, body, res) {
  const id = typeof body.id === 'string' && UUID_RE.test(body.id) ? body.id : null
  if (!id) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'id is required' }))
    return
  }
  const rows = await sql`
    DELETE FROM labels l
    USING users u
    WHERE l.id = ${id} AND l.user_id = u.id AND lower(u.email) = ${email}
    RETURNING l.id
  `
  if (rows.length === 0) {
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'Label not found' }))
    return
  }
  res.statusCode = 200
  res.end(JSON.stringify({ ok: true }))
}

// /api/labels — GET lists the user's labels (with message counts),
// POST creates one, DELETE removes one (message_labels rows cascade).
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json')

  let email
  try {
    ;({ email } = await verifyAccessToken(req))
  } catch {
    res.statusCode = 401
    res.end(JSON.stringify({ error: 'Unauthorized' }))
    return
  }

  try {
    const sql = getSql()
    if (req.method === 'GET') {
      await listLabels(sql, email, res)
      return
    }
    if (req.method === 'POST' || req.method === 'DELETE') {
      let body
      try {
        body = await readJsonBody(req)
      } catch {
        res.statusCode = 400
        res.end(JSON.stringify({ error: 'Invalid JSON body' }))
        return
      }
      if (req.method === 'POST') await createLabel(sql, email, body, res)
      else await deleteLabel(sql, email, body, res)
      return
    }
    res.statusCode = 405
    res.end(JSON.stringify({ error: 'Method not allowed' }))
  } catch (err) {
    console.error(`${req.method} /api/labels failed:`, err)
    await captureApiError(err, { route: `${req.method} /api/labels` })
    res.statusCode = 500
    res.end(JSON.stringify({ error: 'Labels request failed' }))
  }
}
