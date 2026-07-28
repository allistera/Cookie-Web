import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:dns/promises', () => ({
  default: { lookup: vi.fn() },
}))

import dns from 'node:dns/promises'
import { syncCalendarSubscription, validSubscriptionUrl } from '../_lib/calendarSync.js'

describe('validSubscriptionUrl', () => {
  it('accepts a well-formed https URL', () => {
    expect(validSubscriptionUrl('https://example.com/feed.ics')).toBe('https://example.com/feed.ics')
  })

  it('rejects non-https URLs', () => {
    expect(validSubscriptionUrl('http://example.com/feed.ics')).toBeNull()
    expect(validSubscriptionUrl('file:///etc/passwd')).toBeNull()
    expect(validSubscriptionUrl('gopher://example.com')).toBeNull()
  })

  it('rejects malformed input', () => {
    expect(validSubscriptionUrl('not a url')).toBeNull()
    expect(validSubscriptionUrl('')).toBeNull()
    expect(validSubscriptionUrl(null)).toBeNull()
    expect(validSubscriptionUrl(123)).toBeNull()
    expect(validSubscriptionUrl('https://example.com/' + 'a'.repeat(2000))).toBeNull()
  })
})

// A minimal stand-in for the postgres.js sql tagged-template + sql.begin,
// scripted with queued results the same way the other _lib tests are.
function makeSql(queue) {
  const run = () => Promise.resolve(queue.shift() ?? [])
  run.begin = async (fn) => fn(run)
  return run
}

describe('syncCalendarSubscription', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('BEGIN:VCALENDAR\nEND:VCALENDAR', { status: 200 })),
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.mocked(dns.lookup).mockReset()
  })

  it('refuses to fetch a URL that resolves to a private IP (SSRF guard)', async () => {
    vi.mocked(dns.lookup).mockResolvedValue({ address: '127.0.0.1' })
    const sql = makeSql([])

    const result = await syncCalendarSubscription(sql, 'cal-1', 'user-1', 'https://internal.example.com/feed.ics')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('disallowed address')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('refuses link-local and cloud-metadata-range addresses', async () => {
    vi.mocked(dns.lookup).mockResolvedValue({ address: '169.254.169.254' })
    const sql = makeSql([])

    const result = await syncCalendarSubscription(sql, 'cal-1', 'user-1', 'https://metadata.example.com/feed.ics')

    expect(result.ok).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not follow redirects', async () => {
    vi.mocked(dns.lookup).mockResolvedValue({ address: '93.184.216.34' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 302, headers: { Location: '/other' } })))
    const sql = makeSql([])

    const result = await syncCalendarSubscription(sql, 'cal-1', 'user-1', 'https://example.com/feed.ics')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('redirect')
  })

  it('records the error on the calendar row without touching events when fetch fails', async () => {
    vi.mocked(dns.lookup).mockResolvedValue({ address: '93.184.216.34' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 500 })))
    const queue = [[]]
    const sql = makeSql(queue)

    const result = await syncCalendarSubscription(sql, 'cal-1', 'user-1', 'https://example.com/feed.ics')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('500')
  })

  it('parses events (including an expanded RRULE series) and replaces the calendar contents', async () => {
    vi.mocked(dns.lookup).mockResolvedValue({ address: '93.184.216.34' })
    const now = new Date()
    const soon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    const dtstamp = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}T000000Z`
    const dtstart = `${soon.getUTCFullYear()}${String(soon.getUTCMonth() + 1).padStart(2, '0')}${String(soon.getUTCDate()).padStart(2, '0')}T140000Z`
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:1@example.com',
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${dtstart}`,
      `DTEND:${dtstart}`,
      'SUMMARY:Standup',
      'RRULE:FREQ=DAILY;COUNT=3',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(ics, { status: 200 })))

    const inserted = []
    const queue = []
    const sql = (strings, ...values) => {
      const text = strings.join('?')
      if (text.includes('json_to_recordset')) {
        // Regression guard: the ::json parameter must be the raw JS array,
        // not a pre-stringified string — see the comment above this query in
        // calendarSync.js for why postgres.js double-encodes the latter into
        // a scalar that json_to_recordset then rejects (COOKIE-WEB-C).
        const jsonValue = values.find((value) => Array.isArray(value))
        inserted.push(jsonValue)
      }
      return Promise.resolve(queue.shift() ?? [])
    }
    sql.begin = async (fn) => fn(sql)

    const result = await syncCalendarSubscription(sql, 'cal-1', 'user-1', 'https://example.com/feed.ics')

    expect(result.ok).toBe(true)
    expect(result.count).toBe(3)
    expect(inserted[0]).toHaveLength(3)
    expect(inserted[0][0].title).toBe('Standup')
  })

  it('catches a failure inside the replace transaction and records it as a sync error', async () => {
    vi.mocked(dns.lookup).mockResolvedValue({ address: '93.184.216.34' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('BEGIN:VCALENDAR\nEND:VCALENDAR', { status: 200 })))
    const updates = []
    const sql = (strings, ...values) => {
      updates.push({ text: strings.join('?'), values })
      return Promise.resolve([])
    }
    sql.begin = async () => {
      throw new Error('cannot call json_to_recordset on a scalar')
    }

    const result = await syncCalendarSubscription(sql, 'cal-1', 'user-1', 'https://example.com/feed.ics')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('json_to_recordset')
    expect(updates.some((update) => update.text.includes('subscription_error'))).toBe(true)
  })
})
