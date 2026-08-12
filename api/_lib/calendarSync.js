import { Buffer } from 'node:buffer'

import ical from 'node-ical'

import { requestPublicHttps } from './safe-https.js'

const MAX_TITLE = 200
const MAX_LOCATION = 200
const MAX_DESCRIPTION = 2000
const MS_PER_DAY = 24 * 60 * 60 * 1000
const EXPAND_PAST_DAYS = 365
const EXPAND_FUTURE_DAYS = 730
const MAX_OCCURRENCES_PER_EVENT = 366
const MAX_EVENTS_PER_SYNC = 1000
const FETCH_TIMEOUT_MS = 10_000
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024
// A sync failure message can quote remote-controlled feed content (node-ical
// echoes the offending line back), and the column is unbounded text that the
// sidebar renders. Bound it before it is stored.
const MAX_SYNC_ERROR_CHARS = 500

// Credential-bearing URLs are rejected here rather than only at the egress
// boundary (resolvePublicHttpsUrl), so subscribing to one fails as a 400 at
// create time instead of storing a calendar whose every sync errors out.
// webcal:// (the scheme calendar apps hand out for ICS feeds) is accepted and
// stored as its https:// equivalent, so every later sync goes through the
// same public-HTTPS egress path as a plain https subscription.
export function validSubscriptionUrl(value) {
  if (typeof value !== 'string' || value.length > 2000) return null
  const normalized = value.replace(/^webcal:\/\//i, 'https://')
  let parsed
  try {
    parsed = new URL(normalized)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null
  return parsed.toString()
}

async function fetchIcs(url) {
  const response = await requestPublicHttps(url, {
    timeoutMs: FETCH_TIMEOUT_MS,
    maxResponseBytes: MAX_RESPONSE_BYTES,
    headers: { Accept: 'text/calendar, text/plain, */*' },
  })
  if (response.status >= 300 && response.status < 400) {
    throw new Error('The calendar URL redirected; redirects are not followed')
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`The calendar URL responded with status ${response.status}`)
  }
  return Buffer.from(response.body).toString('utf8')
}

const pad2 = (n) => String(n).padStart(2, '0')
const toDateKeyUTC = (date) => `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`
const toTimeKeyUTC = (date) => `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`
// node-ical builds a date-only (VALUE=DATE) VEVENT's start/end by
// interpreting the date components as local time, so recovering the
// intended calendar date must use local getters too — UTC getters would
// shift the date by a day in any timezone that isn't UTC+0.
const toDateKeyLocal = (date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`

function addDaysLocal(date, days) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

// A timed (non-all-day) occurrence: one row, positioned by its actual
// start time and duration.
function timedOccurrences(event, windowStart, windowEnd) {
  const starts = event.rrule
    ? event.rrule.between(windowStart, windowEnd, true).slice(0, MAX_OCCURRENCES_PER_EVENT)
    : event.start >= windowStart && event.start <= windowEnd
      ? [event.start]
      : []

  const durationMs = Math.max(new Date(event.end).getTime() - new Date(event.start).getTime(), 60_000)
  const durationMinutes = Math.round(durationMs / 60_000)
  return starts.map((start) => ({
    date: toDateKeyUTC(new Date(start)),
    time: toTimeKeyUTC(new Date(start)),
    durationMinutes,
    allDay: false,
  }))
}

// An all-day occurrence is expanded into one row per calendar day it spans,
// each flagged all_day so the UI renders it as a compact banner instead of
// positioning it in the hourly grid (which is what previously made a single
// all-day event stretch across the entire visible timeline). RFC5545 all-day
// DTEND is exclusive — a "Aug 10-13" span covers the 10th, 11th, and 12th.
export function allDayOccurrences(event, windowStart, windowEnd) {
  const spanDays = Math.max(Math.round((event.end.getTime() - event.start.getTime()) / MS_PER_DAY), 1)
  const starts = event.rrule
    ? event.rrule.between(windowStart, windowEnd, true).slice(0, MAX_OCCURRENCES_PER_EVENT)
    : [event.start]

  const rows = []
  const firstWindowDay = startOfLocalDay(windowStart)
  const afterLastWindowDay = addDaysLocal(startOfLocalDay(windowEnd), 1)
  for (const occurrenceStart of starts) {
    const firstOccurrenceDay = startOfLocalDay(new Date(occurrenceStart))
    const afterLastOccurrenceDay = addDaysLocal(firstOccurrenceDay, spanDays)
    const firstDay = firstOccurrenceDay < firstWindowDay ? firstWindowDay : firstOccurrenceDay
    const afterLastDay = afterLastOccurrenceDay > afterLastWindowDay
      ? afterLastWindowDay
      : afterLastOccurrenceDay

    for (let day = firstDay; day < afterLastDay; day = addDaysLocal(day, 1)) {
      rows.push({ date: toDateKeyLocal(day), time: '00:00', durationMinutes: 1440, allDay: true })
      if (rows.length >= MAX_OCCURRENCES_PER_EVENT) return rows
    }
  }
  return rows
}

// Occurrences are materialized as plain rows rather than stored as our own
// recurrence_rule: an arbitrary ICS RRULE (BYDAY, BYSETPOS, exceptions, ...)
// doesn't map onto the app's own small daily/weekly/monthly/yearly model, and
// these events are sync-managed and never hand-edited, so there's no need to
// keep them re-expandable.
function eventOccurrences(event, windowStart, windowEnd) {
  return event.datetype === 'date'
    ? allDayOccurrences(event, windowStart, windowEnd)
    : timedOccurrences(event, windowStart, windowEnd)
}

function parseEvents(icsText, windowStart, windowEnd) {
  const parsed = ical.parseICS(icsText)
  const rows = []
  for (const value of Object.values(parsed)) {
    if (value.type !== 'VEVENT' || !value.start) continue
    const title = String(value.summary || 'Untitled event').trim().slice(0, MAX_TITLE) || 'Untitled event'
    const description = value.description ? String(value.description).slice(0, MAX_DESCRIPTION) : null
    const location = value.location ? String(value.location).slice(0, MAX_LOCATION) : null

    for (const occurrence of eventOccurrences(value, windowStart, windowEnd)) {
      rows.push({
        title,
        description,
        location,
        date: occurrence.date,
        start: occurrence.time,
        duration: occurrence.durationMinutes,
        all_day: occurrence.allDay,
      })
      if (rows.length >= MAX_EVENTS_PER_SYNC) return rows
    }
  }
  return rows
}

async function recordSyncError(sql, calendarId, error) {
  const message = (error instanceof Error ? error.message : 'Sync failed').slice(
    0,
    MAX_SYNC_ERROR_CHARS,
  )
  await sql`UPDATE calendars SET subscription_error = ${message} WHERE id = ${calendarId}`
  return { ok: false, error: message }
}

// Re-syncing replaces every event in the calendar wholesale rather than
// diffing against the previous fetch — subscribed calendars are entirely
// sync-owned, so there's no local edit state to preserve across a resync,
// and a full replace is far simpler than tracking per-occurrence identity
// against an external feed that has none.
export async function syncCalendarSubscription(sql, calendarId, userId, url) {
  const now = new Date()
  const windowStart = new Date(now.getTime() - EXPAND_PAST_DAYS * MS_PER_DAY)
  const windowEnd = new Date(now.getTime() + EXPAND_FUTURE_DAYS * MS_PER_DAY)

  let rows
  try {
    const icsText = await fetchIcs(url)
    rows = parseEvents(icsText, windowStart, windowEnd)
  } catch (error) {
    return recordSyncError(sql, calendarId, error)
  }

  try {
    await sql.begin(async (tx) => {
      await tx`DELETE FROM calendar_events WHERE calendar = ${calendarId}`
      if (rows.length > 0) {
        // Pass the array itself, not a pre-stringified JSON string: postgres.js
        // resolves the ::json cast's OID from the server and applies its own
        // JSON.stringify when binding, so stringifying here too double-encodes
        // the value into a JSON string (a scalar) instead of an array, which
        // json_to_recordset then rejects.
        await tx`
          INSERT INTO calendar_events (user_id, title, description, location, event_date, start_time, duration_minutes, calendar, tone, all_day)
          SELECT ${userId}, row.title, row.description, row.location, row.date, row.start, row.duration::int, ${calendarId}, 'default', row.all_day
          FROM json_to_recordset(${rows}::json) AS row(title text, description text, location text, date text, start text, duration int, all_day boolean)
        `
      }
      await tx`UPDATE calendars SET subscription_synced_at = now(), subscription_error = null WHERE id = ${calendarId}`
    })
  } catch (error) {
    return recordSyncError(sql, calendarId, error)
  }
  return { ok: true, count: rows.length }
}
