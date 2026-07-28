import { getSql } from './_lib/db.js'
import { verifyAccessToken } from './_lib/auth.js'
import { captureApiError } from './_lib/sentry.js'
import { readJsonBody } from './_lib/body.js'
import calendarsHandler from './_lib/calendars.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^\d{2}:\d{2}$/
const MAX_TITLE = 200
const MAX_LOCATION = 200
const MAX_DESCRIPTION = 2000
const LEGACY_CALENDAR_NAMES = new Map([
  ['work', 'Work'],
  ['personal', 'Personal'],
  ['focus', 'Focus time'],
  ['birthdays', 'Birthdays'],
  ['holidays', 'Holidays'],
])
const ALLOWED_TONES = new Set(['default', 'dark', 'conflict', 'accepted', 'suggested'])
const REPEAT_FREQUENCIES = new Set(['none', 'daily', 'weekly', 'monthly', 'yearly'])

// The UI only offers a fixed set of frequencies with an optional end date, so
// the stored rule is a small custom format rather than full RFC5545 — see
// migration 0025.
export function buildRecurrenceRule(repeat, repeatUntil) {
  if (repeat === 'none') return null
  const freq = repeat.toUpperCase()
  return repeatUntil ? `${freq};UNTIL=${repeatUntil}` : freq
}

function validEventFields(body) {
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const description = typeof body.description === 'string' ? body.description.trim() || null : null
  const location = typeof body.location === 'string' ? body.location.trim() || null : null
  const date = typeof body.date === 'string' ? body.date : ''
  const start = typeof body.start === 'string' ? body.start : ''
  const duration = Number.isFinite(body.duration) ? Math.trunc(body.duration) : 0
  const calendar = typeof body.calendar === 'string' ? body.calendar : ''
  const tone = typeof body.tone === 'string' ? body.tone : null
  const repeat = typeof body.repeat === 'string' ? body.repeat : 'none'
  const repeatUntil = typeof body.repeatUntil === 'string' && body.repeatUntil ? body.repeatUntil : null

  if (
    !title ||
    title.length > MAX_TITLE ||
    !DATE_RE.test(date) ||
    !TIME_RE.test(start) ||
    duration <= 0 ||
    !(UUID_RE.test(calendar) || LEGACY_CALENDAR_NAMES.has(calendar)) ||
    (tone !== null && !ALLOWED_TONES.has(tone)) ||
    (location && location.length > MAX_LOCATION) ||
    (description && description.length > MAX_DESCRIPTION) ||
    !REPEAT_FREQUENCIES.has(repeat) ||
    (repeatUntil && !DATE_RE.test(repeatUntil))
  ) {
    return null
  }
  const recurrenceRule = buildRecurrenceRule(repeat, repeat === 'none' ? null : repeatUntil)
  return { title, description, location, date, start, duration, calendar, tone, recurrenceRule }
}

// A calendar id in the request body must actually belong to the caller —
// otherwise any authenticated user could file events under another user's
// calendar id (or a nonexistent one).
async function resolveCalendarId(sql, email, calendarId) {
  const legacyName = LEGACY_CALENDAR_NAMES.get(calendarId) ?? null
  try {
    const [row] = await sql`
      SELECT c.id, c.subscription_url AS "subscriptionUrl"
      FROM calendars c
      JOIN users u ON u.id = c.user_id
      WHERE lower(u.email) = ${email}
        AND (c.id::text = ${calendarId} OR c.name = ${legacyName})
      LIMIT 1
    `
    return row ? { id: row.id, subscriptionUrl: row.subscriptionUrl } : null
  } catch (error) {
    if (error?.code === '42703') {
      // Migration 0026 (subscription columns) hasn't landed yet; the table
      // itself is fine, so retry without referencing them.
      const [row] = await sql`
        SELECT c.id
        FROM calendars c
        JOIN users u ON u.id = c.user_id
        WHERE lower(u.email) = ${email}
          AND (c.id::text = ${calendarId} OR c.name = ${legacyName})
        LIMIT 1
      `
      return row ? { id: row.id, subscriptionUrl: null } : null
    }
    // During the expand rollout, the new API may be live briefly before the
    // calendars table exists. Legacy slugs remain valid until migration 0024.
    if (error?.code === '42P01') return legacyName ? { id: calendarId, subscriptionUrl: null } : null
    throw error
  }
}

async function fetchNormalizedEvents(sql, email) {
  return sql`
    SELECT ce.id, ce.title, ce.description, ce.location, ce.event_date AS date,
           ce.start_time AS start, ce.duration_minutes AS duration,
           COALESCE(c.id::text, ce.calendar::text) AS calendar, ce.tone,
           ce.recurrence_rule AS "recurrenceRule", ce.all_day AS "allDay"
    FROM calendar_events ce
    JOIN users u ON u.id = ce.user_id
    LEFT JOIN calendars c
      ON c.user_id = ce.user_id
     AND (
       c.id::text = ce.calendar::text
       OR c.name = CASE ce.calendar::text
         WHEN 'work' THEN 'Work'
         WHEN 'personal' THEN 'Personal'
         WHEN 'focus' THEN 'Focus time'
         WHEN 'birthdays' THEN 'Birthdays'
         WHEN 'holidays' THEN 'Holidays'
       END
     )
    WHERE lower(u.email) = ${email}
    ORDER BY ce.event_date, ce.start_time
  `
}

// Same as fetchNormalizedEvents, minus recurrence_rule and all_day — used
// while migrations 0025/0027 haven't landed yet on a database this deploy is
// already talking to.
async function fetchNormalizedEventsWithoutRecurrence(sql, email) {
  return sql`
    SELECT ce.id, ce.title, ce.description, ce.location, ce.event_date AS date,
           ce.start_time AS start, ce.duration_minutes AS duration,
           COALESCE(c.id::text, ce.calendar::text) AS calendar, ce.tone
    FROM calendar_events ce
    JOIN users u ON u.id = ce.user_id
    LEFT JOIN calendars c
      ON c.user_id = ce.user_id
     AND (
       c.id::text = ce.calendar::text
       OR c.name = CASE ce.calendar::text
         WHEN 'work' THEN 'Work'
         WHEN 'personal' THEN 'Personal'
         WHEN 'focus' THEN 'Focus time'
         WHEN 'birthdays' THEN 'Birthdays'
         WHEN 'holidays' THEN 'Holidays'
       END
     )
    WHERE lower(u.email) = ${email}
    ORDER BY ce.event_date, ce.start_time
  `
}

export async function fetchEvents(sql, email) {
  try {
    return await fetchNormalizedEvents(sql, email)
  } catch (error) {
    if (error?.code === '42703') return fetchNormalizedEventsWithoutRecurrence(sql, email)
    if (error?.code !== '42P01') throw error
    return sql`
      SELECT ce.id, ce.title, ce.description, ce.location, ce.event_date AS date,
             ce.start_time AS start, ce.duration_minutes AS duration, ce.calendar, ce.tone
      FROM calendar_events ce
      JOIN users u ON u.id = ce.user_id
      WHERE lower(u.email) = ${email}
      ORDER BY ce.event_date, ce.start_time
    `
  }
}

const MS_PER_DAY = 24 * 60 * 60 * 1000
const EXPAND_PAST_DAYS = 365
const EXPAND_FUTURE_DAYS = 730
const MAX_OCCURRENCES_PER_SERIES = 366
const RECURRENCE_RE = /^(DAILY|WEEKLY|MONTHLY|YEARLY)(?:;UNTIL=(\d{4}-\d{2}-\d{2}))?$/

function parseRecurrenceRule(rule) {
  const match = typeof rule === 'string' ? rule.match(RECURRENCE_RE) : null
  if (!match) return null
  return { freq: match[1], until: match[2] ?? null }
}

// Clamps day-of-month so e.g. "31st of every month" lands on the last day of
// short months instead of overflowing into the next one.
function stepDate(date, freq) {
  const next = new Date(date)
  if (freq === 'DAILY') {
    next.setUTCDate(next.getUTCDate() + 1)
    return next
  }
  if (freq === 'WEEKLY') {
    next.setUTCDate(next.getUTCDate() + 7)
    return next
  }
  const day = next.getUTCDate()
  const month = freq === 'YEARLY' ? next.getUTCMonth() : next.getUTCMonth() + 1
  const yearsAhead = freq === 'YEARLY' ? 1 : 0
  next.setUTCDate(1)
  next.setUTCFullYear(next.getUTCFullYear() + yearsAhead)
  next.setUTCMonth(month)
  const daysInTargetMonth = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate()
  next.setUTCDate(Math.min(day, daysInTargetMonth))
  return next
}

const toDateKey = (date) => date.toISOString().slice(0, 10)

// Expands one series-master row into its occurrences within [windowStart,
// windowEnd]. Non-recurring events pass through unchanged. There's no
// support for per-occurrence exceptions: editing or deleting any occurrence
// acts on the whole series.
function expandEvent(event, windowStart, windowEnd) {
  const rule = parseRecurrenceRule(event.recurrenceRule)
  if (!rule) return [{ ...event, seriesId: event.id }]

  const dtstart = new Date(`${event.date}T${event.start}:00Z`)
  const until = rule.until ? new Date(`${rule.until}T23:59:59Z`) : null
  const occurrences = []
  let cursor = dtstart
  let index = 0
  while (cursor <= windowEnd && (!until || cursor <= until) && occurrences.length < MAX_OCCURRENCES_PER_SERIES) {
    if (cursor >= windowStart) {
      occurrences.push({ ...event, id: `${event.id}:${index}`, seriesId: event.id, date: toDateKey(cursor) })
    }
    cursor = stepDate(cursor, rule.freq)
    index += 1
  }
  return occurrences
}

export function expandEvents(events, now = new Date()) {
  const windowStart = new Date(now.getTime() - EXPAND_PAST_DAYS * MS_PER_DAY)
  const windowEnd = new Date(now.getTime() + EXPAND_FUTURE_DAYS * MS_PER_DAY)
  return events.flatMap((event) => expandEvent(event, windowStart, windowEnd))
}

// Migration 0024 installs the composite FK that makes this ownership check
// authoritative in the database and closes resolve-then-write races.
async function ownsCalendar(sql, email, calendarId) {
  return resolveCalendarId(sql, email, calendarId)
}

const READ_ONLY_ERROR = 'This calendar is read-only — its events sync automatically.'

async function isEventInSubscribedCalendar(sql, email, eventId) {
  try {
    const [row] = await sql`
      SELECT c.subscription_url IS NOT NULL AS "isSubscribed"
      FROM calendar_events ce
      JOIN users u ON u.id = ce.user_id
      LEFT JOIN calendars c ON c.id = ce.calendar
      WHERE ce.id = ${eventId} AND lower(u.email) = ${email}
    `
    return row?.isSubscribed ?? false
  } catch (error) {
    if (error?.code === '42703') return false // migration 0026 hasn't landed yet
    throw error
  }
}

async function listEvents(sql, email, res) {
  const events = await fetchEvents(sql, email)
  res.statusCode = 200
  res.end(JSON.stringify({ events: expandEvents(events) }))
}

async function createEvent(sql, email, body, res) {
  const fields = validEventFields(body)
  if (!fields) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'Invalid event fields' }))
    return
  }
  const calendar = await ownsCalendar(sql, email, fields.calendar)
  if (!calendar) {
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'Calendar not found' }))
    return
  }
  if (calendar.subscriptionUrl) {
    res.statusCode = 403
    res.end(JSON.stringify({ error: READ_ONLY_ERROR }))
    return
  }

  const [event] = await sql`
    INSERT INTO calendar_events
      (user_id, title, description, location, event_date, start_time, duration_minutes, calendar, tone, recurrence_rule, all_day)
    SELECT u.id, ${fields.title}, ${fields.description}, ${fields.location}, ${fields.date},
           ${fields.start}, ${fields.duration}, ${calendar.id}, ${fields.tone}, ${fields.recurrenceRule}, false
    FROM users u
    WHERE lower(u.email) = ${email}
    RETURNING id, title, description, location, event_date AS date, start_time AS start,
              duration_minutes AS duration, calendar, tone, recurrence_rule AS "recurrenceRule", all_day AS "allDay"
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
  const calendar = await ownsCalendar(sql, email, fields.calendar)
  if (!calendar) {
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'Calendar not found' }))
    return
  }
  if (calendar.subscriptionUrl || (await isEventInSubscribedCalendar(sql, email, id))) {
    res.statusCode = 403
    res.end(JSON.stringify({ error: READ_ONLY_ERROR }))
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
        calendar = ${calendar.id},
        tone = ${fields.tone},
        recurrence_rule = ${fields.recurrenceRule},
        all_day = false,
        updated_at = now()
    FROM users u
    WHERE ce.id = ${id} AND ce.user_id = u.id AND lower(u.email) = ${email}
    RETURNING ce.id, ce.title, ce.description, ce.location, ce.event_date AS date,
              ce.start_time AS start, ce.duration_minutes AS duration, ce.calendar, ce.tone,
              ce.recurrence_rule AS "recurrenceRule", ce.all_day AS "allDay"
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
  if (await isEventInSubscribedCalendar(sql, email, id)) {
    res.statusCode = 403
    res.end(JSON.stringify({ error: READ_ONLY_ERROR }))
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
  const resource = new URL(req.url, 'http://localhost').searchParams.get('resource')
  if (resource === 'calendars') {
    await calendarsHandler(req, res)
    return
  }

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
