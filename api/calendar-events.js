import { getSql } from './_lib/db.js'
import { verifyAccessToken } from './_lib/auth.js'
import { captureApiError } from './_lib/sentry.js'
import { readJsonBody } from './_lib/body.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^\d{2}:\d{2}$/
const MAX_TITLE = 200
const MAX_LOCATION = 200
const MAX_DESCRIPTION = 2000
const ALLOWED_CALENDARS = new Set(['work', 'personal', 'focus', 'birthdays', 'holidays'])
const ALLOWED_TONES = new Set(['default', 'dark', 'conflict', 'accepted', 'suggested'])

function validEventFields(body) {
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const description = typeof body.description === 'string' ? body.description.trim() || null : null
  const location = typeof body.location === 'string' ? body.location.trim() || null : null
  const date = typeof body.date === 'string' ? body.date : ''
  const start = typeof body.start === 'string' ? body.start : ''
  const duration = Number.isFinite(body.duration) ? Math.trunc(body.duration) : 0
  const calendar = typeof body.calendar === 'string' ? body.calendar : 'personal'
  const tone = typeof body.tone === 'string' ? body.tone : null

  if (
    !title ||
    title.length > MAX_TITLE ||
    !DATE_RE.test(date) ||
    !TIME_RE.test(start) ||
    duration <= 0 ||
    !ALLOWED_CALENDARS.has(calendar) ||
    (tone !== null && !ALLOWED_TONES.has(tone)) ||
    (location && location.length > MAX_LOCATION) ||
    (description && description.length > MAX_DESCRIPTION)
  ) {
    return null
  }
  return { title, description, location, date, start, duration, calendar, tone }
}

export function fetchEvents(sql, email) {
  return sql`
    SELECT ce.id, ce.title, ce.description, ce.location, ce.event_date AS date,
           ce.start_time AS start, ce.duration_minutes AS duration, ce.calendar, ce.tone
    FROM calendar_events ce
    JOIN users u ON u.id = ce.user_id
    WHERE lower(u.email) = ${email}
    ORDER BY ce.event_date, ce.start_time
  `
}

async function listEvents(sql, email, res) {
  const events = await fetchEvents(sql, email)
  res.statusCode = 200
  res.end(JSON.stringify({ events }))
}

async function createEvent(sql, email, body, res) {
  const fields = validEventFields(body)
  if (!fields) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'Invalid event fields' }))
    return
  }

  const [event] = await sql`
    INSERT INTO calendar_events
      (user_id, title, description, location, event_date, start_time, duration_minutes, calendar, tone)
    SELECT u.id, ${fields.title}, ${fields.description}, ${fields.location}, ${fields.date},
           ${fields.start}, ${fields.duration}, ${fields.calendar}, ${fields.tone}
    FROM users u
    WHERE lower(u.email) = ${email}
    RETURNING id, title, description, location, event_date AS date, start_time AS start,
              duration_minutes AS duration, calendar, tone
  `
  if (!event) {
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'User not found' }))
    return
  }
  res.statusCode = 201
  res.end(JSON.stringify({ event }))
}

async function updateEvent(sql, email, body, res) {
  const id = typeof body.id === 'string' && UUID_RE.test(body.id) ? body.id : null
  const fields = id ? validEventFields(body) : null
  if (!fields) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'id and valid event fields are required' }))
    return
  }

  const [event] = await sql`
    UPDATE calendar_events ce
    SET title = ${fields.title},
        description = ${fields.description},
        location = ${fields.location},
        event_date = ${fields.date},
        start_time = ${fields.start},
        duration_minutes = ${fields.duration},
        calendar = ${fields.calendar},
        tone = ${fields.tone},
        updated_at = now()
    FROM users u
    WHERE ce.id = ${id} AND ce.user_id = u.id AND lower(u.email) = ${email}
    RETURNING ce.id, ce.title, ce.description, ce.location, ce.event_date AS date,
              ce.start_time AS start, ce.duration_minutes AS duration, ce.calendar, ce.tone
  `
  if (!event) {
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'Event not found' }))
    return
  }
  res.statusCode = 200
  res.end(JSON.stringify({ event }))
}

async function deleteEvent(sql, email, body, res) {
  const id = typeof body.id === 'string' && UUID_RE.test(body.id) ? body.id : null
  if (!id) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'id is required' }))
    return
  }
  const rows = await sql`
    DELETE FROM calendar_events ce
    USING users u
    WHERE ce.id = ${id} AND ce.user_id = u.id AND lower(u.email) = ${email}
    RETURNING ce.id
  `
  if (rows.length === 0) {
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'Event not found' }))
    return
  }
  res.statusCode = 200
  res.end(JSON.stringify({ ok: true }))
}

// /api/calendar-events — GET lists the user's events, POST creates one,
// PATCH replaces one (full update, keyed by id), DELETE removes one.
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
      await listEvents(sql, email, res)
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
      if (req.method === 'POST') await createEvent(sql, email, body, res)
      else if (req.method === 'PATCH') await updateEvent(sql, email, body, res)
      else await deleteEvent(sql, email, body, res)
      return
    }
    res.statusCode = 405
    res.end(JSON.stringify({ error: 'Method not allowed' }))
  } catch (err) {
    console.error(`${req.method} /api/calendar-events failed:`, err)
    await captureApiError(err, { route: `${req.method} /api/calendar-events` })
    res.statusCode = 500
    res.end(JSON.stringify({ error: 'Calendar events request failed' }))
  }
}
