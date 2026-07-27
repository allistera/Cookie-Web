import { describe, expect, it } from 'vitest'

import { fetchEvents } from '../calendar-events.js'

describe('fetchEvents', () => {
  it('reads the calendar_events table scoped to the user, ordered by date and time', () => {
    let query = ''
    const values = []
    const sql = (strings, ...vals) => {
      query = strings.join('?')
      values.push(...vals)
      return []
    }

    fetchEvents(sql, 'owner@example.com')

    expect(query).toContain('FROM calendar_events ce')
    expect(query).toContain('JOIN users u ON u.id = ce.user_id')
    expect(query).toContain('WHERE lower(u.email) =')
    expect(query).toContain('ce.event_date AS date')
    expect(query).toContain('ce.start_time AS start')
    expect(query).toContain('ce.duration_minutes AS duration')
    expect(query).toContain('ORDER BY ce.event_date, ce.start_time')
    expect(values).toEqual(['owner@example.com'])
  })
})
