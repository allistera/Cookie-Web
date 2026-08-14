import { createServices } from './_lib/services.js'
import { readJsonBody } from './_lib/body.js'
import { createHandler as createCalendarsHandler } from './_lib/calendars.js'

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
// RFC5545-style two-letter weekday codes, in week order (index doubles as the
// Date#getUTCDay() value for that weekday).
const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

// The UI only offers a fixed set of frequencies with an optional end date and,
// for weekly series, an optional set of specific weekdays — so the stored
// rule is a small custom format rather than full RFC5545 — see migrations
// 0025 and 0031.
export function buildRecurrenceRule(repeat, repeatUntil, repeatDays) {
  if (repeat === 'none') return null
  const freq = repeat.toUpperCase()
  const byday = repeat === 'weekly' && repeatDays?.length ? `;BYDAY=${repeatDays.join(',')}` : ''
  return repeatUntil ? `${freq}${byday};UNTIL=${repeatUntil}` : `${freq}${byday}`
}

function validEventFields(body) {
  const title = String(body.title ?? '').trim()
  const description = String(body.description ?? '').trim() || null
  const location = String(body.location ?? '').trim() || null
  const date = String(body.date ?? '')
  const start = String(body.start ?? '')
  const duration = Number.isFinite(body.duration) ? Math.trunc(body.duration) : 0
  const calendar = String(body.calendar ?? '')
  const tone = body.tone == null ? null : String(body.tone)
  const repeat = String(body.repeat ?? 'none')
  const repeatUntil = String(body.repeatUntil ?? '') || null
  const repeatDaysRaw = Array.isArray(body.repeatDays) ? body.repeatDays : null

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
    (repeatUntil && !DATE_RE.test(repeatUntil)) ||
    (repeatDaysRaw &&
      (repeat !== 'weekly' ||
        repeatDaysRaw.length === 0 ||
        repeatDaysRaw.some((day) => !WEEKDAY_CODES.includes(day))))
  ) {
    return null
  }
  // Stored in a fixed week order regardless of the order the client sent, so
  // the recurrence_rule string stays stable/comparable across edits.
  const repeatDays = repeatDaysRaw ? WEEKDAY_CODES.filter((code) => repeatDaysRaw.includes(code)) : null
  const recurrenceRule = buildRecurrenceRule(repeat, repeat === 'none' ? null : repeatUntil, repeatDays)
  return { title, description, location, date, start, duration, calendar, tone, recurrenceRule }
}

// A calendar id in the request body must actually belong to the caller —
// otherwise any authenticated user could file events under another user's
// calendar id (or a nonexistent one). Migration 0024 installs the composite FK
// that makes this ownership check authoritative in the database and closes
// resolve-then-write races.
async function resolveCalendarId(sql, userId, calendarId) {
  const legacyName = LEGACY_CALENDAR_NAMES.get(calendarId) ?? null
  try {
    const [row] = await sql`
      SELECT c.id, c.subscription_url AS "subscriptionUrl"
      FROM calendars c
      WHERE c.user_id = ${userId}
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
        WHERE c.user_id = ${userId}
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

// The range filter keeps recurring masters unconditionally: a series row's
// event_date is its start, not its span, so a years-old weekly series must
// still reach expandEvents, which clips its occurrences to the range. A
// missing range binds the full date domain, preserving return-everything
// behavior for callers that don't window (the pre-range wire contract).
const RANGE_MIN = '0001-01-01'
const RANGE_MAX = '9999-12-31'

async function fetchNormalizedEvents(sql, userId, range) {
  return sql`
    SELECT ce.id, ce.title, ce.description, ce.location, ce.event_date AS date,
           ce.start_time AS start, ce.duration_minutes AS duration,
           COALESCE(c.id::text, ce.calendar::text) AS calendar, ce.tone,
           ce.recurrence_rule AS "recurrenceRule", ce.all_day AS "allDay",
           ce.is_auto_scheduled AS "autoScheduled"
    FROM calendar_events ce
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
    WHERE ce.user_id = ${userId}
      AND (ce.recurrence_rule IS NOT NULL
           OR ce.event_date BETWEEN ${range?.from ?? RANGE_MIN} AND ${range?.to ?? RANGE_MAX})
    ORDER BY ce.event_date, ce.start_time
  `
}

// Same as fetchNormalizedEvents, minus recurrence_rule and all_day — used
// while migrations 0025/0027 haven't landed yet on a database this deploy is
// already talking to.
async function fetchNormalizedEventsWithoutRecurrence(sql, userId, range) {
  return sql`
    SELECT ce.id, ce.title, ce.description, ce.location, ce.event_date AS date,
           ce.start_time AS start, ce.duration_minutes AS duration,
           COALESCE(c.id::text, ce.calendar::text) AS calendar, ce.tone
    FROM calendar_events ce
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
    WHERE ce.user_id = ${userId}
      AND ce.event_date BETWEEN ${range?.from ?? RANGE_MIN} AND ${range?.to ?? RANGE_MAX}
    ORDER BY ce.event_date, ce.start_time
  `
}

export async function fetchEvents(sql, userId, range = null) {
  try {
    return await fetchNormalizedEvents(sql, userId, range)
  } catch (error) {
    if (error?.code === '42703') return fetchNormalizedEventsWithoutRecurrence(sql, userId, range)
    if (error?.code !== '42P01') throw error
    return sql`
      SELECT ce.id, ce.title, ce.description, ce.location, ce.event_date AS date,
             ce.start_time AS start, ce.duration_minutes AS duration, ce.calendar, ce.tone
      FROM calendar_events ce
      WHERE ce.user_id = ${userId}
        AND ce.event_date BETWEEN ${range?.from ?? RANGE_MIN} AND ${range?.to ?? RANGE_MAX}
      ORDER BY ce.event_date, ce.start_time
    `
  }
}

const MS_PER_DAY = 24 * 60 * 60 * 1000
const EXPAND_PAST_DAYS = 365
const EXPAND_FUTURE_DAYS = 730
const MAX_OCCURRENCES_PER_SERIES = 366
// Occurrences before the window are stepped over without being emitted, so the
// occurrence cap alone does not bound the work: a DAILY series dated 0001-01-01
// (which both DATE_RE and migration 0022's CHECK accept) would step ~740k times
// on every calendar load. Cap total steps too — 10k covers a daily series
// starting ~27 years back, weekly ~190 years, monthly ~830 years. A WEEKLY
// series with BYDAY steps day-by-day (see expandEvent), so it shares DAILY's
// ~27-year reach rather than WEEKLY's.
const MAX_STEPS_PER_SERIES = 10_000
const WEEKDAY_RE = '(?:SU|MO|TU|WE|TH|FR|SA)'
const RECURRENCE_RE = new RegExp(
  `^(DAILY|WEEKLY|MONTHLY|YEARLY)(?:;BYDAY=(${WEEKDAY_RE}(?:,${WEEKDAY_RE}){0,6}))?(?:;UNTIL=(\\d{4}-\\d{2}-\\d{2}))?$`,
)

function parseRecurrenceRule(rule) {
  const match = String(rule ?? '').match(RECURRENCE_RE)
  if (!match) return null
  return { freq: match[1], byday: match[2] ? match[2].split(',') : null, until: match[3] ?? null }
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
  // BYDAY (e.g. "Monday to Friday") only makes sense for WEEKLY, and needs
  // day-by-day stepping to land on each selected weekday rather than jumping
  // 7 days from the series' own start-date weekday.
  const weekdays = rule.byday ? new Set(rule.byday.map((code) => WEEKDAY_CODES.indexOf(code))) : null
  const stepFreq = weekdays ? 'DAILY' : rule.freq
  const occurrences = []
  let cursor = dtstart
  let index = 0
  while (
    cursor <= windowEnd &&
    (!until || cursor <= until) &&
    occurrences.length < MAX_OCCURRENCES_PER_SERIES &&
    index < MAX_STEPS_PER_SERIES
  ) {
    if (cursor >= windowStart && (!weekdays || weekdays.has(cursor.getUTCDay()))) {
      occurrences.push({ ...event, id: `${event.id}:${index}`, seriesId: event.id, date: toDateKey(cursor) })
    }
    cursor = stepDate(cursor, stepFreq)
    index += 1
  }
  return occurrences
}

// With a range, recurring series expand only into [from, to] instead of the
// default now-relative window — the SQL range filter keeps series masters
// unconditionally, so this clip is what actually bounds their payload.
// Non-recurring events still pass through untouched; the SQL filter already
// windowed them.
export function expandEvents(events, now = new Date(), range = null) {
  const windowStart = range
    ? new Date(`${range.from}T00:00:00Z`)
    : new Date(now.getTime() - EXPAND_PAST_DAYS * MS_PER_DAY)
  const windowEnd = range
    ? new Date(`${range.to}T23:59:59Z`)
    : new Date(now.getTime() + EXPAND_FUTURE_DAYS * MS_PER_DAY)
  return events.flatMap((event) => expandEvent(event, windowStart, windowEnd))
}

const READ_ONLY_ERROR = 'This calendar is read-only — its events sync automatically.'

async function isEventInSubscribedCalendar(sql, userId, eventId) {
  try {
    const [row] = await sql`
      SELECT c.subscription_url IS NOT NULL AS "isSubscribed"
      FROM calendar_events ce
      LEFT JOIN calendars c ON c.id = ce.calendar
      WHERE ce.id = ${eventId} AND ce.user_id = ${userId}
    `
    return row?.isSubscribed ?? false
  } catch (error) {
    if (error?.code === '42703') return false // migration 0026 hasn't landed yet
    throw error
  }
}

async function listEvents(sql, userId, range, res) {
  const events = await fetchEvents(sql, userId, range)
  res.statusCode = 200
  res.end(JSON.stringify({ events: expandEvents(events, new Date(), range) }))
}

// from/to are optional but must come as a valid pair: omitting both keeps the
// original return-everything contract, anything else is a client bug worth a
// 400 rather than a silently unbounded payload.
function parseRangeParams(searchParams) {
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  if (from === null && to === null) return { range: null }
  if (!DATE_RE.test(from ?? '') || !DATE_RE.test(to ?? '') || from > to) return { error: true }
  return { range: { from, to } }
}

async function createEvent(sql, userId, body, res) {
  const fields = validEventFields(body)
  if (!fields) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'Invalid event fields' }))
    return
  }
  const calendar = await resolveCalendarId(sql, userId, fields.calendar)
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

  // WHERE EXISTS keeps the graceful 404 (rather than an FK-violation error)
  // for the theoretical race where the user row is deleted between
  // verifyAccessToken and this insert, without re-deriving userId via email.
  const [event] = await sql`
    INSERT INTO calendar_events
      (user_id, title, description, location, event_date, start_time, duration_minutes, calendar, tone, recurrence_rule, all_day)
    SELECT ${userId}, ${fields.title}, ${fields.description}, ${fields.location}, ${fields.date},
           ${fields.start}, ${fields.duration}, ${calendar.id}, ${fields.tone}, ${fields.recurrenceRule}, false
    WHERE EXISTS (SELECT 1 FROM users WHERE id = ${userId})
    RETURNING id, title, description, location, event_date AS date, start_time AS start,
              duration_minutes AS duration, calendar, tone, recurrence_rule AS "recurrenceRule", all_day AS "allDay",
              is_auto_scheduled AS "autoScheduled"
  `
  if (!event) {
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'User not found' }))
    return
  }
  res.statusCode = 201
  res.end(JSON.stringify({ event }))
}

async function updateEvent(sql, userId, body, res) {
  const id = UUID_RE.test(body.id) ? String(body.id) : null
  const fields = id ? validEventFields(body) : null
  if (!fields) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'id and valid event fields are required' }))
    return
  }
  // Independent lookups — the target calendar (from fields.calendar) and the
  // event's current calendar (from id) — so they run concurrently instead of
  // as two sequential round trips.
  const [calendar, eventInSubscribedCalendar] = await Promise.all([
    resolveCalendarId(sql, userId, fields.calendar),
    isEventInSubscribedCalendar(sql, userId, id),
  ])
  if (!calendar) {
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'Calendar not found' }))
    return
  }
  if (calendar.subscriptionUrl || eventInSubscribedCalendar) {
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
    WHERE ce.id = ${id} AND ce.user_id = ${userId}
    RETURNING ce.id, ce.title, ce.description, ce.location, ce.event_date AS date,
              ce.start_time AS start, ce.duration_minutes AS duration, ce.calendar, ce.tone,
              ce.recurrence_rule AS "recurrenceRule", ce.all_day AS "allDay",
              ce.is_auto_scheduled AS "autoScheduled"
  `
  if (!event) {
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'Event not found' }))
    return
  }
  res.statusCode = 200
  res.end(JSON.stringify({ event }))
}

async function deleteEvent(sql, userId, body, res) {
  const id = UUID_RE.test(body.id) ? String(body.id) : null
  if (!id) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'id is required' }))
    return
  }
  if (await isEventInSubscribedCalendar(sql, userId, id)) {
    res.statusCode = 403
    res.end(JSON.stringify({ error: READ_ONLY_ERROR }))
    return
  }
  const rows = await sql`
    DELETE FROM calendar_events ce
    WHERE ce.id = ${id} AND ce.user_id = ${userId}
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
export function createHandler(overrides = {}) {
  const services = createServices({
    // The ?resource=calendars sub-handler shares this handler's overrides so
    // injected fakes flow through the dispatch too.
    calendarsHandler: createCalendarsHandler(overrides),
    ...overrides,
  })
  return async function handler(req, res) {
    const { searchParams } = new URL(req.url, 'http://localhost')
    if (searchParams.get('resource') === 'calendars') {
      await services.calendarsHandler(req, res)
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
        const { range, error } = parseRangeParams(searchParams)
        if (error) {
          res.statusCode = 400
          res.end(JSON.stringify({ error: 'from and to must be a valid YYYY-MM-DD pair' }))
          return
        }
        await listEvents(sql, userId, range, res)
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
        if (req.method === 'POST') await createEvent(sql, userId, body, res)
        else if (req.method === 'PATCH') await updateEvent(sql, userId, body, res)
        else await deleteEvent(sql, userId, body, res)
        return
      }
      res.statusCode = 405
      res.end(JSON.stringify({ error: 'Method not allowed' }))
    } catch (err) {
      console.error(`${req.method} /api/calendar-events failed:`, err)
      res.statusCode = 500
      res.end(JSON.stringify({ error: 'Calendar events request failed' }))
    }
  }
}

export default createHandler()
