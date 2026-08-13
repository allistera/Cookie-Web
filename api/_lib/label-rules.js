import { createServices } from './services.js'
import { readJsonBody } from './body.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FIELDS = ['subject', 'body', 'from', 'to']
const OPERATORS = ['contains', 'equals', 'starts_with', 'ends_with']
const MATCH_TYPES = ['all', 'any']
const ACTIONS = ['apply_label', 'mark_done']
const MAX_NAME = 100
const MAX_VALUE = 200
const MAX_CONDITIONS = 10

function normalizeConditions(input) {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_CONDITIONS) return null
  const conditions = []
  for (const raw of input) {
    const field = String(raw?.field ?? '')
    const operator = String(raw?.operator ?? '')
    const value = String(raw?.value ?? '').trim()
    if (!FIELDS.includes(field) || !OPERATORS.includes(operator) || !value || value.length > MAX_VALUE) {
      return null
    }
    conditions.push({ field, operator, value })
  }
  return conditions
}

async function listRules(sql, email, res) {
  const rows = await sql`
    SELECT r.id, r.name, r.label_id, r.action, r.match_type, r.enabled, r.created_at,
           c.id AS condition_id, c.field, c.operator, c.value, c.position
    FROM label_rules r
    JOIN users u ON u.id = r.user_id
    LEFT JOIN label_rule_conditions c ON c.rule_id = r.id
    WHERE lower(u.email) = ${email}
    ORDER BY r.created_at, c.position
  `
  const rules = []
  const byId = new Map()
  for (const row of rows) {
    let rule = byId.get(row.id)
    if (!rule) {
      rule = {
        id: row.id,
        name: row.name,
        label_id: row.label_id,
        action: row.action,
        match_type: row.match_type,
        enabled: row.enabled,
        conditions: [],
      }
      byId.set(row.id, rule)
      rules.push(rule)
    }
    if (row.condition_id) {
      rule.conditions.push({
        id: row.condition_id,
        field: row.field,
        operator: row.operator,
        value: row.value,
      })
    }
  }
  res.statusCode = 200
  res.end(JSON.stringify({ rules }))
}

async function createRule(sql, email, body, res) {
  const name = String(body.name ?? '').trim() || null
  const action = ACTIONS.includes(body.action) ? body.action : 'apply_label'
  const labelId = UUID_RE.test(body.label_id) ? String(body.label_id) : null
  const matchType = MATCH_TYPES.includes(body.match_type) ? body.match_type : 'all'
  const enabled = body.enabled === true || body.enabled === false ? body.enabled : true
  const conditions = normalizeConditions(body.conditions)

  if (
    !conditions ||
    (name && name.length > MAX_NAME) ||
    (action === 'apply_label' && !labelId) ||
    (action === 'mark_done' && labelId)
  ) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'A valid action (with label_id for apply_label) and 1-10 valid conditions are required' }))
    return
  }

  let rule
  if (action === 'apply_label') {
    ;[rule] = await sql`
      INSERT INTO label_rules (user_id, label_id, name, action, match_type, enabled)
      SELECT u.id, ${labelId}, ${name}, ${action}, ${matchType}, ${enabled}
      FROM users u
      JOIN labels l ON l.id = ${labelId} AND l.user_id = u.id AND l.kind = 'user'
      WHERE lower(u.email) = ${email}
      RETURNING id, name, label_id, action, match_type, enabled
    `
    if (!rule) {
      res.statusCode = 404
      res.end(JSON.stringify({ error: 'Label not found' }))
      return
    }
  } else {
    ;[rule] = await sql`
      INSERT INTO label_rules (user_id, label_id, name, action, match_type, enabled)
      SELECT u.id, NULL, ${name}, ${action}, ${matchType}, ${enabled}
      FROM users u
      WHERE lower(u.email) = ${email}
      RETURNING id, name, label_id, action, match_type, enabled
    `
    if (!rule) {
      res.statusCode = 404
      res.end(JSON.stringify({ error: 'User not found' }))
      return
    }
  }

  await sql.begin(async (tx) => {
    let position = 0
    for (const condition of conditions) {
      await tx`
        INSERT INTO label_rule_conditions (rule_id, field, operator, value, position)
        VALUES (${rule.id}, ${condition.field}, ${condition.operator}, ${condition.value}, ${position})
      `
      position += 1
    }
  })

  res.statusCode = 201
  res.end(JSON.stringify({
    rule: { ...rule, conditions: conditions.map((c, i) => ({ ...c, position: i })) },
  }))
}

async function updateRule(sql, email, body, res) {
  const id = UUID_RE.test(body.id) ? String(body.id) : null
  const hasName = Object.hasOwn(body, 'name')
  const hasAction = Object.hasOwn(body, 'action')
  const hasLabelId = Object.hasOwn(body, 'label_id')
  const hasMatchType = Object.hasOwn(body, 'match_type')
  const hasEnabled = Object.hasOwn(body, 'enabled')
  const hasConditions = Object.hasOwn(body, 'conditions')

  const name = String(body.name ?? '').trim() || null
  const labelId = UUID_RE.test(body.label_id) ? String(body.label_id) : null
  const conditions = hasConditions ? normalizeConditions(body.conditions) : undefined

  if (
    !id ||
    (!hasName && !hasAction && !hasLabelId && !hasMatchType && !hasEnabled && !hasConditions) ||
    (hasAction && !ACTIONS.includes(body.action)) ||
    (hasLabelId && !labelId) ||
    (hasName && name && name.length > MAX_NAME) ||
    (hasMatchType && !MATCH_TYPES.includes(body.match_type)) ||
    (hasEnabled && body.enabled !== true && body.enabled !== false) ||
    (hasConditions && !conditions)
  ) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'id and a valid rule update are required' }))
    return
  }

  const [existing] = await sql`
    SELECT r.name, r.label_id, r.action, r.match_type, r.enabled
    FROM label_rules r
    JOIN users u ON u.id = r.user_id
    WHERE r.id = ${id} AND lower(u.email) = ${email}
  `
  if (!existing) {
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'Rule not found' }))
    return
  }

  const resultAction = hasAction ? body.action : existing.action
  // mark_done clears any label, even one already on the rule, since a rule
  // can only carry a label meaningful to its own action.
  const resultLabelId = resultAction === 'mark_done' ? null : (hasLabelId ? labelId : existing.label_id)

  if (
    (resultAction === 'apply_label' && !resultLabelId) ||
    (resultAction === 'mark_done' && hasLabelId)
  ) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'apply_label requires label_id; mark_done cannot set one' }))
    return
  }

  if (hasLabelId && resultAction === 'apply_label') {
    const [label] = await sql`
      SELECT 1 FROM labels l
      JOIN users u ON u.id = l.user_id
      WHERE l.id = ${labelId} AND lower(u.email) = ${email} AND l.kind = 'user'
    `
    if (!label) {
      res.statusCode = 404
      res.end(JSON.stringify({ error: 'Label not found' }))
      return
    }
  }

  const [rule] = await sql`
    UPDATE label_rules r
    SET name = ${hasName ? name : existing.name},
        label_id = ${resultLabelId},
        action = ${resultAction},
        match_type = ${hasMatchType ? body.match_type : existing.match_type},
        enabled = ${hasEnabled ? body.enabled : existing.enabled},
        updated_at = now()
    FROM users u
    WHERE r.id = ${id} AND r.user_id = u.id AND lower(u.email) = ${email}
    RETURNING r.id, r.name, r.label_id, r.action, r.match_type, r.enabled
  `

  if (hasConditions) {
    await sql.begin(async (tx) => {
      await tx`DELETE FROM label_rule_conditions WHERE rule_id = ${id}`
      let position = 0
      for (const condition of conditions) {
        await tx`
          INSERT INTO label_rule_conditions (rule_id, field, operator, value, position)
          VALUES (${id}, ${condition.field}, ${condition.operator}, ${condition.value}, ${position})
        `
        position += 1
      }
    })
  }

  const rows = hasConditions
    ? conditions.map((condition, i) => ({ ...condition, position: i }))
    : await sql`
      SELECT field, operator, value, position FROM label_rule_conditions
      WHERE rule_id = ${id} ORDER BY position
    `
  res.statusCode = 200
  res.end(JSON.stringify({ rule: { ...rule, conditions: rows } }))
}

async function deleteRule(sql, email, body, res) {
  const id = UUID_RE.test(body.id) ? String(body.id) : null
  if (!id) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'id is required' }))
    return
  }
  const rows = await sql`
    DELETE FROM label_rules r
    USING users u
    WHERE r.id = ${id} AND r.user_id = u.id AND lower(u.email) = ${email}
    RETURNING r.id
  `
  if (rows.length === 0) {
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'Rule not found' }))
    return
  }
  res.statusCode = 200
  res.end(JSON.stringify({ ok: true }))
}

// /api/labels?resource=rules — GET lists the user's tag rules (with
// conditions), POST creates one, PATCH edits name/action/label/match-type/
// enabled/conditions, DELETE removes one. A rule's action is either
// apply_label (label_id required) or mark_done (label_id must be null).
// Rule matching itself runs in Cookie-Worker at inbound storage time; this
// endpoint only manages rule definitions.
// Lives under _lib (not a top-level api/*.js file) to stay within Vercel
// Hobby's 12-serverless-function-per-deployment limit; api/labels.js
// dispatches here by resource query param instead of Vercel routing it.
export function createHandler(overrides = {}) {
  const services = createServices(overrides)
  return async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json')

    let email
    try {
      ;({ email } = await services.verifyAccessToken(req))
    } catch {
      res.statusCode = 401
      res.end(JSON.stringify({ error: 'Unauthorized' }))
      return
    }

    try {
      const sql = services.getSql()
      if (req.method === 'GET') {
        await listRules(sql, email, res)
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
        if (req.method === 'POST') await createRule(sql, email, body, res)
        else if (req.method === 'PATCH') await updateRule(sql, email, body, res)
        else await deleteRule(sql, email, body, res)
        return
      }
      res.statusCode = 405
      res.end(JSON.stringify({ error: 'Method not allowed' }))
    } catch (err) {
      console.error(`${req.method} /api/labels?resource=rules failed:`, err)
      await services.captureApiError(err, { route: `${req.method} /api/labels?resource=rules` })
      res.statusCode = 500
      res.end(JSON.stringify({ error: 'Label rules request failed' }))
    }
  }
}

export default createHandler()
