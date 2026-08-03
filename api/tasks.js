import process from 'node:process'

import { getSql } from './_lib/db.js'
import { verifyAccessToken } from './_lib/auth.js'
import { captureApiError } from './_lib/sentry.js'
import { readJsonBody } from './_lib/body.js'
import { handleRefresh } from './_lib/enricher.js'

const RESULTS = 25
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// The authenticated user's gathered tasks (Todoist tasks + AI-extracted email
// action items), most-pressing first: soonest due, then highest priority.
export function fetchTasks(sql, email) {
  return sql`
    SELECT t.id, t.source, t.content, t.description, t.due_date,
           t.priority, t.url, t.message_id, t.gathered_at,
           m.from_address AS reply_to, m.subject AS message_subject
    FROM tasks t
    JOIN users u ON u.id = t.user_id
    LEFT JOIN messages m ON m.id = t.message_id AND m.user_id = t.user_id
    WHERE lower(u.email) = ${email}
    ORDER BY t.due_date ASC NULLS LAST, t.priority DESC NULLS LAST, t.created_at DESC
    LIMIT ${RESULTS}
  `
}

// The newest daily digest ("topics to catch up on"), written by the
// data-enricher Worker. Digest rows are the ones carrying no message_id.
export function fetchDigest(sql, email) {
  return sql`
    SELECT s.summary, s.raw, s.created_at
    FROM summaries s
    JOIN users u ON u.id = s.user_id
    WHERE lower(u.email) = ${email}
      AND s.kind = 'daily_digest'
      AND s.message_id IS NULL
    ORDER BY s.created_at DESC
    LIMIT 1
  `
}

// Live state for the messages a digest cites. The digest is a snapshot from
// the overnight run, so by the time it is read some of its mail may have been
// read, archived or deleted.
export function fetchMessageStates(sql, email, ids) {
  return sql`
    SELECT m.id, m.is_unread
    FROM messages m
    JOIN users u ON u.id = m.user_id
    WHERE lower(u.email) = ${email}
      AND m.id = ANY(${ids}::uuid[])
      AND NOT m.is_deleted
      AND NOT m.is_archived
  `
}

// Message ids the stored digest cites, in citation order. Written by a model,
// so anything that is not a plain uuid is discarded rather than reaching a
// ::uuid[] cast.
export function digestMessageIds(row) {
  const topics = Array.isArray(row?.raw?.topics) ? row.raw.topics : []
  const ids = topics.flatMap((topic) =>
    (Array.isArray(topic?.items) ? topic.items : []).map((item) => item?.message_id),
  )
  return [...new Set(ids.filter((id) => typeof id === 'string' && UUID_RE.test(id)))]
}

// Fold live message state into the stored digest: drop items whose message is
// gone from the mailbox, drop topics that empties, and mark what is still
// unread so the card never shows a dot for mail already read.
export function buildDigest(row, states) {
  if (!row) return null
  const unreadById = new Map(states.map((state) => [state.id, state.is_unread]))
  const topics = []
  for (const topic of Array.isArray(row.raw?.topics) ? row.raw.topics : []) {
    const items = (Array.isArray(topic?.items) ? topic.items : [])
      .filter((item) => unreadById.has(item?.message_id))
      .map((item) => ({
        message_id: item.message_id,
        headline: String(item.headline ?? ''),
        note: String(item.note ?? ''),
        unread: unreadById.get(item.message_id),
      }))
    if (items.length > 0) {
      topics.push({ emoji: String(topic.emoji ?? ''), title: String(topic.title ?? ''), items })
    }
  }
  return { overview: row.summary ?? '', created_at: row.created_at, topics }
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
// priority, url, message_id, gathered_at, reply_to, message_subject }],
// digest: { overview, created_at, topics } | null } for the AI dashboard.
// Both halves are returned together because AI Today always renders both.
// POST completes a task.
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

  if (new URL(req.url, 'http://localhost').searchParams.get('resource') === 'refresh') {
    return handleRefresh(req, res, email)
  }

  if (req.method === 'POST') {
    return handlePost(req, res, email)
  }

  try {
    const sql = getSql()
    const [tasks, [digestRow]] = await Promise.all([
      fetchTasks(sql, email),
      fetchDigest(sql, email),
    ])
    const ids = digestMessageIds(digestRow)
    const states = ids.length ? await fetchMessageStates(sql, email, ids) : []
    res.statusCode = 200
    res.end(JSON.stringify({ tasks, digest: buildDigest(digestRow, states) }))
  } catch (err) {
    console.error('GET /api/tasks failed:', err)
    await captureApiError(err, { route: 'GET /api/tasks' })
    res.statusCode = 500
    res.end(JSON.stringify({ error: 'Failed to load tasks' }))
  }
}
