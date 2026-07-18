import { getSql } from './_lib/db.js'
import { verifyAccessToken } from './_lib/auth.js'
import { captureApiError } from './_lib/sentry.js'

const RESULTS = 25

// The authenticated user's gathered tasks (Todoist tasks + AI-extracted email
// action items), most-pressing first: soonest due, then highest priority.
export function fetchTasks(sql, email) {
  return sql`
    SELECT t.id, t.source, t.content, t.description, t.due_date,
           t.priority, t.url, t.message_id
    FROM tasks t
    JOIN users u ON u.id = t.user_id
    WHERE lower(u.email) = ${email}
    ORDER BY t.due_date ASC NULLS LAST, t.priority DESC NULLS LAST, t.created_at DESC
    LIMIT ${RESULTS}
  `
}

// GET /api/tasks — { tasks: [{ id, source, content, description, due_date,
// priority, url, message_id }] } for the AI dashboard's "Needs attention".
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json')

  if (req.method !== 'GET') {
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
