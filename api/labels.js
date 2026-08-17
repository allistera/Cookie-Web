import { createServices } from './_lib/services.js'
import { readJsonBody } from './_lib/body.js'
import { createHandler as createLabelRulesHandler } from './_lib/label-rules.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const COLOR_RE = /^#[0-9a-f]{6}$/i
const MAX_NAME = 50
const MAX_DESCRIPTION = 200

async function listLabels(sql, userId, res) {
  const labels = await sql`
    SELECT l.id, l.name, l.color, l.kind, l.description, l.auto_apply,
           count(ml.message_id)::int AS message_count
    FROM labels l
    LEFT JOIN message_labels ml ON ml.label_id = l.id
    WHERE l.user_id = ${userId}
    GROUP BY l.id
    ORDER BY l.name
  `
  res.statusCode = 200
  res.end(JSON.stringify({ labels }))
}

async function createLabel(sql, userId, body, res) {
  const name = String(body.name ?? '').trim()
  const color = String(body.color ?? '').trim()
  const description = String(body.description ?? '').trim() || null
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
    VALUES (${userId}, ${name}, ${color}, ${description})
    ON CONFLICT (user_id, name) DO NOTHING
    RETURNING id, name, color, kind, description, auto_apply, 0 AS message_count
  `
  if (!label) {
    res.statusCode = 409
    res.end(JSON.stringify({ error: 'A label with that name already exists' }))
    return
  }
  res.statusCode = 201
  res.end(JSON.stringify({ label }))
}

async function updateLabel(sql, userId, body, res) {
  const id = UUID_RE.test(body.id) ? String(body.id) : null
  const hasName = Object.hasOwn(body, 'name')
  const hasColor = Object.hasOwn(body, 'color')
  const hasDescription = Object.hasOwn(body, 'description')
  const hasAutoApply = Object.hasOwn(body, 'auto_apply')
  const name = String(body.name ?? '').trim()
  const color = String(body.color ?? '').trim()
  const description = String(body.description ?? '').trim() || null

  if (
    !id ||
    (!hasName && !hasColor && !hasDescription && !hasAutoApply) ||
    (hasName && (!name || name.length > MAX_NAME)) ||
    (hasColor && !COLOR_RE.test(color)) ||
    (hasDescription && description && description.length > MAX_DESCRIPTION) ||
    (hasAutoApply && body.auto_apply !== true && body.auto_apply !== false)
  ) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'id and a valid label update are required' }))
    return
  }

  let label
  try {
    ;[label] = await sql`
      UPDATE labels l
      SET name = COALESCE(${hasName ? name : null}, l.name),
          color = CASE WHEN ${hasColor} THEN ${color} ELSE l.color END,
          description = CASE WHEN ${hasDescription} THEN ${description} ELSE l.description END,
          auto_apply = COALESCE(${hasAutoApply ? body.auto_apply : null}::boolean, l.auto_apply)
      WHERE l.id = ${id} AND l.user_id = ${userId}
        AND l.kind = 'user'
      RETURNING l.id, l.name, l.color, l.kind, l.description, l.auto_apply
    `
  } catch (error) {
    if (hasName && error?.code === '23505') {
      res.statusCode = 409
      res.end(JSON.stringify({ error: 'A label with that name already exists' }))
      return
    }
    throw error
  }

  if (!label) {
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'User label not found' }))
    return
  }
  res.statusCode = 200
  res.end(JSON.stringify({ label }))
}

async function deleteLabel(sql, userId, body, res) {
  const id = UUID_RE.test(body.id) ? String(body.id) : null
  if (!id) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'id is required' }))
    return
  }
  const rows = await sql`
    DELETE FROM labels l
    WHERE l.id = ${id} AND l.user_id = ${userId}
      AND l.kind = 'user'
    RETURNING l.id
  `
  if (rows.length === 0) {
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'User label not found' }))
    return
  }
  res.statusCode = 200
  res.end(JSON.stringify({ ok: true }))
}

// /api/labels — GET lists the user's labels (with message counts),
// POST creates one, PATCH edits user-owned fields, DELETE removes one.
// ?resource=rules delegates to the tag-rules CRUD handler — kept out of its
// own api/*.js file to stay within Vercel Hobby's function-count limit.
export function createHandler(overrides = {}) {
  const services = createServices({
    // The ?resource=rules sub-handler shares this handler's overrides so
    // injected fakes flow through the dispatch too.
    labelRulesHandler: createLabelRulesHandler(overrides),
    ...overrides,
  })
  return async function handler(req, res) {
    if (new URL(req.url, 'http://localhost').searchParams.get('resource') === 'rules') {
      await services.labelRulesHandler(req, res)
      return
    }

    res.setHeader('Content-Type', 'application/json')

    let userId
    try {
      ;({ userId } = await services.verifyAccessToken(req))
    } catch {
      res.statusCode = 401
      res.end(JSON.stringify({ error: 'Unauthorized' }))
      return
    }

    try {
      const sql = services.getSql()
      if (req.method === 'GET') {
        await listLabels(sql, userId, res)
        return
      }
      if (req.method === 'POST' || req.method === 'PATCH' || req.method === 'DELETE') {
        let body
        try {
          body = await readJsonBody(req)
        } catch {
          res.statusCode = 400
          res.end(JSON.stringify({ error: 'Invalid JSON body' }))
          return
        }
        if (req.method === 'POST') await createLabel(sql, userId, body, res)
        else if (req.method === 'PATCH') await updateLabel(sql, userId, body, res)
        else await deleteLabel(sql, userId, body, res)
        return
      }
      res.statusCode = 405
      res.end(JSON.stringify({ error: 'Method not allowed' }))
    } catch (err) {
      console.error(`${req.method} /api/labels failed:`, err)
      res.statusCode = 500
      res.end(JSON.stringify({ error: 'Labels request failed' }))
    }
  }
}

export default createHandler()
