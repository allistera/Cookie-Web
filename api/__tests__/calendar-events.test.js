import { describe, expect, it } from 'vitest'

import { fetchEvents } from '../calendar-events.js'

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
})
