import process from 'node:process'

import { getSql } from './_lib/db.js'
import { verifyAccessToken } from './_lib/auth.js'
import { captureApiError } from './_lib/sentry.js'
import { readJsonBody } from './_lib/body.js'

const RESULTS = 25
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// The authenticated user's gathered tasks (Todoist tasks + AI-extracted email
// action items), most-pressing first: soonest due, then highest priority.
export function fetchTasks(sql, email) {
  return sql`
    SELECT t.id, t.source, t.content, t.description, t.due_date,
           t.priority, t.url, t.message_id,
           m.from_address AS reply_to, m.subject AS message_subject
    FROM tasks t
    JOIN users u ON u.id = t.user_id
    LEFT JOIN messages m ON m.id = t.message_id AND m.user_id = t.user_id
    WHERE lower(u.email) = ${email}
    ORDER BY t.due_date ASC NULLS LAST, t.priority DESC NULLS LAST, t.created_at DESC
    LIMIT ${RESULTS}
  `
}

// One gathered task owned by the caller, returning what completion needs.
export function fetchOwnedTask(sql, id, email) {
  return sql`
    SELECT t.id, t.source, t.external_id
    FROM tasks t
    JOIN users u ON u.id = t.user_id
    WHERE t.id = ${id} AND lower(u.email) = ${email}
  `
}

// Completing a task removes it from the gathered set; there is no done column.
// A closed Todoist task is no longer "due today", so the daily enricher will
// not re-add it.
export function deleteOwnedTask(sql, id, email) {
  return sql`
    DELETE FROM tasks t
    USING users u
    WHERE t.id = ${id} AND t.user_id = u.id AND lower(u.email) = ${email}
  `
}

// Close a task in Todoist via the unified API (api.todoist.com/api/v1). The
// deprecated REST v2 base returns 410 Gone. Throws on any non-2xx response.
export async function closeTodoistTask(externalId, token) {
  const response = await fetch(
    `https://api.todoist.com/api/v1/tasks/${encodeURIComponent(externalId)}/close`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    },
  )
  if (!response.ok) {
    throw new Error(`Todoist close responded ${response.status}`)
  }
}

// POST /api/tasks — { id, action: 'complete' } marks a gathered task done for
// the authenticated user. Todoist-sourced tasks are closed in Todoist first
// (when a TODOIST_API_TOKEN is configured); the local row is then removed.
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
    res.end(JSON.stringify({ error: 'A valid task id is required' }))
    return
  }
  if (action !== 'complete') {
    res.statusCode = 400
    res.end(JSON.stringify({ error: "action must be 'complete'" }))
    return
  }

  try {
    const sql = getSql()
    const [task] = await fetchOwnedTask(sql, id, email)
    if (!task) {
      res.statusCode = 404
      res.end(JSON.stringify({ error: 'Task not found' }))
      return
    }

    // Close the real Todoist task before dropping our copy, so a failed close
    // leaves the task visible instead of silently vanishing. Without a token
    // configured we fall back to clearing it from Cookie only.
    const token = process.env.TODOIST_API_TOKEN
    const closedInTodoist = task.source === 'todoist' && Boolean(token)
    if (closedInTodoist) {
      try {
        await closeTodoistTask(task.external_id, token)
      } catch (err) {
        console.error('Todoist close failed:', err.message)
        await captureApiError(err, { route: 'POST /api/tasks (todoist close)' })
        res.statusCode = 502
        res.end(JSON.stringify({ error: 'Failed to close the task in Todoist' }))
        return
      }
    }

    await deleteOwnedTask(sql, id, email)
    res.statusCode = 200
    res.end(JSON.stringify({ ok: true, closedInTodoist }))
  } catch (err) {
    console.error('POST /api/tasks failed:', err)
    await captureApiError(err, { route: 'POST /api/tasks' })
    res.statusCode = 500
    res.end(JSON.stringify({ error: 'Failed to complete task' }))
  }
}

// GET /api/tasks — { tasks: [{ id, source, content, description, due_date,
// priority, url, message_id, reply_to, message_subject }] } for the AI
// dashboard. POST completes a task.
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json')

  if (req.method !== 'GET' && req.method !== 'POST') {
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

  if (req.method === 'POST') {
    return handlePost(req, res, email)
  }

  try {
    const sql = getSql()
    const tasks = await fetchTasks(sql, email)
    res.statusCode = 200
    res.end(JSON.stringify({ tasks }))
  } catch (err) {
    console.error('GET /api/tasks failed:', err)
    await captureApiError(err, { route: 'GET /api/tasks' })
    res.statusCode = 500
    res.end(JSON.stringify({ error: 'Failed to load tasks' }))
  }
}
