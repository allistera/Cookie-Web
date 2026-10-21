import { describe, expect, it } from 'vitest'
import { expandEventsPage } from '../localApi/recurrence.js'
import { parseFederatedSearchQuery } from '../localApi/query-parse.js'
import { fixtureCalendarEvents } from '../localApi/fixtures/calendarEvents.js'

describe('review fixture parity', () => {
  it('expands a long daily series throughout the requested window', () => {
    const range = { from: '2028-01-01', to: '2030-12-31' }
    const page = expandEventsPage(
      [{ id: 'daily', date: '2020-01-01', start: '09:00', recurrenceRule: 'DAILY' }],
      new Date('2026-01-01'),
      range,
    )
    expect(page.events).toHaveLength(1096)
    expect(page.events.at(-1).date).toBe(range.to)
    expect(page.truncated).toBe(false)
  })
  it('reports the aggregate expansion cap', () => {
    const page = expandEventsPage(
      Array.from({ length: 5 }, (_, id) => ({
        id: String(id),
        date: '2020-01-01',
        start: '09:00',
        recurrenceRule: 'DAILY',
      })),
      new Date('2026-01-01'),
      { from: '2028-01-01', to: '2030-12-31' },
    )
    expect(page.events).toHaveLength(5000)
    expect(page.truncated).toBe(true)
  })
  it('recognizes federated starred search along with mail operators', () => {
    expect(parseFederatedSearchQuery('is:starred from:alice meeting')).toEqual({
      text: 'meeting',
      filters: { starred: true, from: 'alice' },
    })
    expect(parseFederatedSearchQuery('is:unknown')).toEqual({ text: 'is:unknown', filters: {} })
  })
  it('does not advertise automatic scheduling absent from production', () => {
    expect(fixtureCalendarEvents().some((event) => event.autoScheduled)).toBe(false)
  })
})
