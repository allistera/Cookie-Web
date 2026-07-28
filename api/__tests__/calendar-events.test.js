import { describe, expect, it } from 'vitest'

import { expandEvents, fetchEvents } from '../calendar-events.js'

describe('fetchEvents', () => {
  it('normalizes legacy calendar slugs to owned calendar ids', async () => {
    let query = ''
    const values = []
    const sql = (strings, ...vals) => {
      query = strings.join('?')
      values.push(...vals)
      return []
    }

    await fetchEvents(sql, 'owner@example.com')

    expect(query).toContain('FROM calendar_events ce')
    expect(query).toContain('JOIN users u ON u.id = ce.user_id')
    expect(query).toContain('LEFT JOIN calendars c')
    expect(query).toContain('COALESCE(c.id::text, ce.calendar::text) AS calendar')
    expect(query).toContain('WHERE lower(u.email) =')
    expect(query).toContain('ce.event_date AS date')
    expect(query).toContain('ce.start_time AS start')
    expect(query).toContain('ce.duration_minutes AS duration')
    expect(query).toContain('ce.recurrence_rule AS "recurrenceRule"')
    expect(query).toContain('ORDER BY ce.event_date, ce.start_time')
    expect(values).toEqual(['owner@example.com'])
  })

  it('falls back to legacy event reads before the expand migration', async () => {
    const queries = []
    let calls = 0
    const sql = (strings) => {
      queries.push(strings.join('?'))
      calls += 1
      if (calls === 1) return Promise.reject(Object.assign(new Error('missing table'), { code: '42P01' }))
      return []
    }

    await fetchEvents(sql, 'owner@example.com')

    expect(queries).toHaveLength(2)
    expect(queries[1]).not.toContain('JOIN calendars')
    expect(queries[1]).toContain('ce.calendar')
  })

  it('falls back to a recurrence-free read before migration 0025 lands', async () => {
    const queries = []
    let calls = 0
    const sql = (strings) => {
      queries.push(strings.join('?'))
      calls += 1
      if (calls === 1) return Promise.reject(Object.assign(new Error('missing column'), { code: '42703' }))
      return []
    }

    await fetchEvents(sql, 'owner@example.com')

    expect(queries).toHaveLength(2)
    expect(queries[1]).toContain('LEFT JOIN calendars')
    expect(queries[1]).not.toContain('recurrence_rule')
  })
})

describe('expandEvents', () => {
  const now = new Date('2026-07-28T00:00:00Z')

  it('passes non-recurring events through unchanged, with seriesId set to their own id', () => {
    const event = { id: 'abc', date: '2026-08-01', start: '09:00', recurrenceRule: null }

    expect(expandEvents([event], now)).toEqual([{ ...event, seriesId: 'abc' }])
  })

  it('expands a weekly series into occurrences within the window', () => {
    const event = { id: 'abc', date: '2026-07-01', start: '09:00', recurrenceRule: 'WEEKLY;UNTIL=2026-07-22' }

    const occurrences = expandEvents([event], now)

    expect(occurrences.map((occurrence) => occurrence.date)).toEqual([
      '2026-07-01',
      '2026-07-08',
      '2026-07-15',
      '2026-07-22',
    ])
    expect(occurrences.every((occurrence) => occurrence.seriesId === 'abc')).toBe(true)
    expect(new Set(occurrences.map((occurrence) => occurrence.id)).size).toBe(occurrences.length)
  })

  it('clamps monthly recurrence to the last day of short months', () => {
    const event = { id: 'abc', date: '2026-01-31', start: '09:00', recurrenceRule: 'MONTHLY;UNTIL=2026-04-01' }

    const occurrences = expandEvents([event], now)

    expect(occurrences.map((occurrence) => occurrence.date)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-28',
    ])
  })

  it('stops generating occurrences once the window ends when there is no UNTIL', () => {
    const event = { id: 'abc', date: '2026-07-27', start: '09:00', recurrenceRule: 'DAILY' }

    const occurrences = expandEvents([event], now)

    expect(occurrences.length).toBeGreaterThan(0)
    expect(occurrences.at(-1).date <= '2029-07-28').toBe(true)
  })
})
