import process from 'node:process'

import { createServices } from './_lib/services.js'
import { readJsonBody } from './_lib/body.js'
import { handleRefresh } from './_lib/enricher.js'
import { handleInterests } from './_lib/interests.js'
import { handleDocuments } from './_lib/documents.js'
import { handleDailyNoteSeed } from './_lib/dailyNoteSeed.js'

const RESULTS = 25
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// The authenticated user's gathered tasks (Todoist tasks + AI-extracted email
// action items), most-pressing first: soonest due, then highest priority.
// Scoped to due today or overdue - AI Today is a daily view, so anything due
// later would just be backlog noise here. A task with no due date at all has
// no "today" claim to make either way, but is shown anyway since there is no
// future date to defer it by.
export function fetchTasks(sql, userId) {
  return sql`
    SELECT t.id, t.source, t.content, t.description, t.due_date,
           t.priority, t.url, t.message_id, t.gathered_at,
           m.from_address AS reply_to, m.subject AS message_subject
    FROM tasks t
    LEFT JOIN messages m ON m.id = t.message_id AND m.user_id = t.user_id
    WHERE t.user_id = ${userId}
      AND (t.due_date IS NULL OR t.due_date <= CURRENT_DATE)
    ORDER BY t.due_date ASC NULLS LAST, t.priority DESC NULLS LAST, t.created_at DESC
    LIMIT ${RESULTS}
  `
}

// The newest whole-mailbox summary of a given kind, written by the
// data-enricher Worker: the legacy 'daily_digest' kind now carries three-tier
// inbox triage, while 'daily_news' carries the news round-up. These are the
// rows carrying no message_id.
export function fetchLatestSummary(sql, userId, kind) {
  return sql`
    SELECT s.summary, s.raw, s.created_at
    FROM summaries s
    WHERE s.user_id = ${userId}
      AND s.kind = ${kind}
      AND s.message_id IS NULL
    ORDER BY s.created_at DESC
    LIMIT 1
  `
}

// Only ever hand the browser a real web link. The Worker already discards
// picks whose url was not among the candidates it fetched, but these links
// leave the app, so the render path does not take that on trust.
function safeLink(url) {
  try {
    const { protocol } = new URL(url)
    return protocol === 'https:' || protocol === 'http:' ? url : null
  } catch {
    return null
  }
}

// Shape the stored news round-up for the client, dropping anything that is not
// a usable link.
export function buildNews(row) {
  if (!row) return null
  const sections = []
  for (const section of Array.isArray(row.raw?.sections) ? row.raw.sections : []) {
    const items = (Array.isArray(section?.items) ? section.items : [])
      .filter((item) => safeLink(item?.url))
      .map((item) => ({
        title: String(item.title ?? ''),
        url: item.url,
        description: String(item.description ?? ''),
        note: String(item.note ?? ''),
        meta: String(item.meta ?? ''),
      }))
    if (items.length > 0) {
      sections.push({ emoji: String(section.emoji ?? ''), title: String(section.title ?? ''), items })
    }
  }
  return { created_at: row.created_at, sections }
}

// Live state for the messages inbox triage cites. Triage is a snapshot from
// the overnight run, so by the time it is read some of its mail may have been
// read, archived or deleted. Archived mail stays included - archiving is how
// a topic gets dealt with, not a reason to hide it until tomorrow's digest;
// only deletion actually removes the message the topic is about.
export function fetchMessageStates(sql, userId, ids) {
  return sql`
    SELECT m.id, m.is_unread, m.scheduled_for
    FROM messages m
    WHERE m.user_id = ${userId}
      AND m.id = ANY(${ids}::uuid[])
      AND NOT m.is_deleted
  `
}

// Message ids the stored triage cites, in citation order. Written by a model,
// so anything that is not a plain uuid is discarded rather than reaching a
// ::uuid[] cast.
export function digestMessageIds(row) {
  const topics = Array.isArray(row?.raw?.topics) ? row.raw.topics : []
  const ids = topics.flatMap((topic) =>
    (Array.isArray(topic?.items) ? topic.items : []).map((item) => item?.message_id),
  )
  return [...new Set(ids.filter((id) => UUID_RE.test(String(id))))]
}

// Fold live message state into stored triage: drop items whose message is
// deleted from the mailbox or has since been rescheduled to a later day, drop
// priority groups that empty, and mark what is still unread. Noise is already
// category-only, but is sanitized again before it reaches the browser because
// summaries.raw ultimately contains model data.
export function buildDigest(row, states) {
  if (!row) return null
  const stateById = new Map(states.map((state) => [state.id, state]))
  const topics = []
  for (const topic of Array.isArray(row.raw?.topics) ? row.raw.topics : []) {
    const items = (Array.isArray(topic?.items) ? topic.items : [])
      .filter((item) => {
        const state = stateById.get(item?.message_id)
        if (!state) return false
        if (state.scheduled_for && new Date(state.scheduled_for) > new Date()) return false
        return true
      })
      .map((item) => ({
        message_id: item.message_id,
        headline: String(item.headline ?? ''),
        note: String(item.note ?? ''),
        unread: stateById.get(item.message_id).is_unread,
      }))
    if (items.length > 0) {
      topics.push({ emoji: String(topic.emoji ?? ''), title: String(topic.title ?? ''), items })
    }
  }
  const categories = (Array.isArray(row.raw?.noise?.categories) ? row.raw.noise.categories : [])
    .map((item) => ({ category: item?.category?.trim?.() ?? '', count: item?.count }))
    .filter((item) => item.category && Number.isInteger(item.count) && item.count > 0)
  return {
    overview: row.summary ?? '',
    created_at: row.created_at,
    topics,
    noise: {
      count: categories.reduce((total, item) => total + item.count, 0),
      categories,
    },
  }
}

// One gathered task owned by the caller, returning what completion needs.
export function fetchOwnedTask(sql, id, userId) {
  return sql`
    SELECT t.id, t.source, t.external_id
    FROM tasks t
    WHERE t.id = ${id} AND t.user_id = ${userId}
  `
}

// Completing a task removes it from the gathered set; there is no done column.
// A closed Todoist task is no longer "due today", so the daily enricher will
// not re-add it.
export function deleteOwnedTask(sql, id, userId) {
  return sql`
    DELETE FROM tasks t
    WHERE t.id = ${id} AND t.user_id = ${userId}
  `
}

// Moves a gathered task's due date, taking it off today's list until then.
export function updateTaskDueDate(sql, id, userId, dueDate) {
  return sql`
    UPDATE tasks t SET due_date = ${dueDate}
    WHERE t.id = ${id} AND t.user_id = ${userId}
    RETURNING t.id, t.due_date
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

// Reschedule a task in Todoist via the unified API (api.todoist.com/api/v1).
// dueDate is a plain YYYY-MM-DD date, matching this codebase's `date` column.
// Throws on any non-2xx response.
export async function rescheduleTodoistTask(externalId, token, dueDate) {
  const response = await fetch(
    `https://api.todoist.com/api/v1/tasks/${encodeURIComponent(externalId)}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ due_date: dueDate }),
      signal: AbortSignal.timeout(10000),
    },
  )
  if (!response.ok) {
    throw new Error(`Todoist reschedule responded ${response.status}`)
  }
}

// Completes a task: the real Todoist task is closed before dropping our copy,
// so a failed close leaves the task visible instead of silently vanishing.
// Without a token configured we fall back to clearing it from Cookie only.
async function completeTask(sql, res, userId, task) {
  const token = process.env.TODOIST_API_TOKEN
  const closedInTodoist = task.source === 'todoist' && Boolean(token)
  if (closedInTodoist) {
    try {
      await closeTodoistTask(task.external_id, token)
    } catch (err) {
      console.error('Todoist close failed:', err.message)
      res.statusCode = 502
      res.end(JSON.stringify({ error: 'Failed to close the task in Todoist' }))
      return
    }
  }

  await deleteOwnedTask(sql, task.id, userId)
  res.statusCode = 200
  res.end(JSON.stringify({ ok: true, closedInTodoist }))
}

// Reschedules a task to another day. A Todoist-sourced task is rescheduled in
// Todoist first (when a TODOIST_API_TOKEN is configured) - the daily sync
// otherwise clobbers a local-only due_date change back to whatever Todoist
// still reports the next time it runs. A failed Todoist call leaves the task
// on its original day instead of drifting out of sync with Todoist.
async function rescheduleTask(sql, res, userId, task, dueDate) {
  const token = process.env.TODOIST_API_TOKEN
  if (task.source === 'todoist' && token) {
    try {
      await rescheduleTodoistTask(task.external_id, token, dueDate)
    } catch (err) {
      console.error('Todoist reschedule failed:', err.message)
      res.statusCode = 502
      res.end(JSON.stringify({ error: 'Failed to reschedule the task in Todoist' }))
      return
    }
  }

  const [updated] = await updateTaskDueDate(sql, task.id, userId, dueDate)
  res.statusCode = 200
  res.end(JSON.stringify({ ok: true, task: updated }))
}

// POST /api/tasks — { id, action: 'complete' } marks a gathered task done;
// { id, action: 'reschedule', due_date } moves it to another day.
async function handlePost(req, res, userId, services) {
  let body
  try {
    body = await readJsonBody(req)
  } catch {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'Invalid JSON body' }))
    return
  }

  const id = String(body.id ?? '')
  const { action } = body
  if (!UUID_RE.test(id)) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'A valid task id is required' }))
    return
  }
  if (action !== 'complete' && action !== 'reschedule') {
    res.statusCode = 400
    res.end(JSON.stringify({ error: "action must be 'complete' or 'reschedule'" }))
    return
  }

  let dueDate = null
  if (action === 'reschedule') {
    dueDate = DATE_RE.test(String(body.due_date ?? '')) ? String(body.due_date) : null
    if (!dueDate) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'A valid due_date (YYYY-MM-DD) is required' }))
      return
    }
  }

  try {
    const sql = services.getSql()
    const [task] = await fetchOwnedTask(sql, id, userId)
    if (!task) {
      res.statusCode = 404
      res.end(JSON.stringify({ error: 'Task not found' }))
      return
    }

    if (action === 'complete') {
      await completeTask(sql, res, userId, task)
    } else {
      await rescheduleTask(sql, res, userId, task, dueDate)
    }
  } catch (err) {
    console.error('POST /api/tasks failed:', err)
    res.statusCode = 500
    res.end(JSON.stringify({ error: 'Failed to update task' }))
  }
}

// GET /api/tasks — { tasks: [{ id, source, content, description, due_date,
// priority, url, message_id, gathered_at, reply_to, message_subject }],
// digest: { overview, created_at, topics, noise } | null,
// news: { created_at, sections } | null } for the AI dashboard. All three are
// returned together because AI Today always renders all of them.
// POST completes or reschedules a task.
export function createHandler(overrides = {}) {
  const services = createServices(overrides)
  return async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json')

    const resource = new URL(req.url, 'http://localhost').searchParams.get('resource')

    // PUT is only meaningful for ?resource=interests, and PATCH/DELETE only for
    // ?resource=documents; each resource handler rejects the methods it does
    // not serve, so the gate here only screens out what nothing serves.
    const methods =
      resource === 'documents'
        ? ['GET', 'POST', 'PATCH', 'DELETE']
        : ['GET', 'POST', 'PUT']
    if (!methods.includes(req.method)) {
      res.statusCode = 405
      res.end(JSON.stringify({ error: 'Method not allowed' }))
      return
    }

    let userId
    try {
      ;({ userId } = await services.verifyAccessToken(req))
    } catch {
      res.statusCode = 401
      res.end(JSON.stringify({ error: 'Unauthorized' }))
      return
    }

    if (resource === 'refresh') {
      return handleRefresh(req, res, userId, services)
    }
    if (resource === 'interests') {
      return handleInterests(req, res, userId)
    }
    if (resource === 'documents') {
      return handleDocuments(req, res, userId, services)
    }
    if (resource === 'daily-note-seed') {
      return handleDailyNoteSeed(req, res, userId)
    }

    if (req.method === 'POST') {
      return handlePost(req, res, userId, services)
    }

    try {
      const sql = services.getSql()
      const [tasks, [digestRow], [newsRow]] = await Promise.all([
        fetchTasks(sql, userId),
        fetchLatestSummary(sql, userId, 'daily_digest'),
        fetchLatestSummary(sql, userId, 'daily_news'),
      ])
      const ids = digestMessageIds(digestRow)
      const states = ids.length ? await fetchMessageStates(sql, userId, ids) : []
      res.statusCode = 200
      res.end(
        JSON.stringify({
          tasks,
          digest: buildDigest(digestRow, states),
          news: buildNews(newsRow),
        }),
      )
    } catch (err) {
      console.error('GET /api/tasks failed:', err)
      res.statusCode = 500
      res.end(JSON.stringify({ error: 'Failed to load tasks' }))
    }
  }
}

export default createHandler()
