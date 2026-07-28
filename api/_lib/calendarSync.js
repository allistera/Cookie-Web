import { Buffer } from 'node:buffer'
import dns from 'node:dns/promises'
import { isIPv4, isIPv6 } from 'node:net'

import ical from 'node-ical'

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

// Fetching a user-supplied URL from the server is a classic SSRF vector (the
// "calendar URL" field becomes a way to probe internal services or cloud
// metadata endpoints). This blocks the well-known private/reserved ranges by
// resolving the hostname up front and refusing to fetch if it lands there,
// disables redirect-following (each hop would need the same check), and caps
// both the fetch time and response size. It does not close a DNS-rebinding
// race between this lookup and the fetch() call's own resolution — doing so
// would require pinning the connection to the resolved IP via a custom
// undici dispatcher, which is more machinery than this feature currently
// warrants.
function ipv4ToInt(ip) {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0
}

const PRIVATE_IPV4_RANGES = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]

function isPrivateIPv4(ip) {
  const int = ipv4ToInt(ip)
  return PRIVATE_IPV4_RANGES.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
    return (int & mask) === (ipv4ToInt(base) & mask)
  })
}

function isPrivateIPv6(ip) {
  const normalized = ip.toLowerCase()
  if (normalized === '::1' || normalized === '::') return true
  if (/^fe[89ab]/.test(normalized)) return true // link-local fe80::/10
  if (/^f[cd]/.test(normalized)) return true // unique local fc00::/7
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  return mapped ? isPrivateIPv4(mapped[1]) : false
}

function isDisallowedIp(ip) {
  if (isIPv4(ip)) return isPrivateIPv4(ip)
  if (isIPv6(ip)) return isPrivateIPv6(ip)
  return true // unrecognized format — fail closed
}

export function validSubscriptionUrl(value) {
  if (typeof value !== 'string' || value.length > 2000) return null
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    return null
  }
  return parsed.protocol === 'https:' ? parsed.toString() : null
}

async function fetchIcs(url) {
  const parsed = new URL(url)
  let address
  try {
    ;({ address } = await dns.lookup(parsed.hostname))
  } catch {
    throw new Error('Could not resolve the calendar URL')
  }
  if (isDisallowedIp(address)) throw new Error('The calendar URL points to a disallowed address')

  const response = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { Accept: 'text/calendar, text/plain, */*' },
  })
  if (response.status >= 300 && response.status < 400) {
    throw new Error('The calendar URL redirected; redirects are not followed')
  }
  if (!response.ok) throw new Error(`The calendar URL responded with status ${response.status}`)

  const reader = response.body?.getReader()
  if (!reader) return response.text()
  const chunks = []
  let bytes = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value.byteLength
    if (bytes > MAX_RESPONSE_BYTES) {
      await reader.cancel()
      throw new Error('The calendar feed is too large')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8')
}

const toDateKey = (date) =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
const toTimeKey = (date) => `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`

// Occurrences are materialized as plain rows rather than stored as our own
// recurrence_rule: an arbitrary ICS RRULE (BYDAY, BYSETPOS, exceptions, ...)
// doesn't map onto the app's own small daily/weekly/monthly/yearly model, and
// these events are sync-managed and never hand-edited, so there's no need to
// keep them re-expandable.
function eventOccurrences(event, windowStart, windowEnd) {
  const starts = event.rrule
    ? event.rrule.between(windowStart, windowEnd, true).slice(0, MAX_OCCURRENCES_PER_EVENT)
    : event.start >= windowStart && event.start <= windowEnd
      ? [event.start]
      : []

  const durationMs = Math.max(new Date(event.end).getTime() - new Date(event.start).getTime(), 60_000)
  return starts.map((start) => ({ start: new Date(start), durationMinutes: Math.round(durationMs / 60_000) }))
}

function parseEvents(icsText, windowStart, windowEnd) {
  const parsed = ical.parseICS(icsText)
  const rows = []
  for (const value of Object.values(parsed)) {
    if (value.type !== 'VEVENT' || !value.start) continue
    const title = String(value.summary || 'Untitled event').trim().slice(0, MAX_TITLE) || 'Untitled event'
    const description = value.description ? String(value.description).slice(0, MAX_DESCRIPTION) : null
    const location = value.location ? String(value.location).slice(0, MAX_LOCATION) : null

    for (const { start, durationMinutes } of eventOccurrences(value, windowStart, windowEnd)) {
      rows.push({
        title,
        description,
        location,
        date: toDateKey(start),
        start: toTimeKey(start),
        duration: durationMinutes,
      })
      if (rows.length >= MAX_EVENTS_PER_SYNC) return rows
    }
  }
  return rows
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
    const message = error instanceof Error ? error.message : 'Sync failed'
    await sql`UPDATE calendars SET subscription_error = ${message} WHERE id = ${calendarId}`
    return { ok: false, error: message }
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
          INSERT INTO calendar_events (user_id, title, description, location, event_date, start_time, duration_minutes, calendar, tone)
          SELECT ${userId}, row.title, row.description, row.location, row.date, row.start, row.duration::int, ${calendarId}, 'default'
          FROM json_to_recordset(${rows}::json) AS row(title text, description text, location text, date text, start text, duration int)
        `
      }
      await tx`UPDATE calendars SET subscription_synced_at = now(), subscription_error = null WHERE id = ${calendarId}`
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sync failed'
    await sql`UPDATE calendars SET subscription_error = ${message} WHERE id = ${calendarId}`
    return { ok: false, error: message }
  }
  return { ok: true, count: rows.length }
}
