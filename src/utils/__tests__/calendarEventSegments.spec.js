import { describe, expect, it } from 'vitest'
import { eventDaySegments, isContinuationSegment } from '../calendarEventSegments'

const event = (fields) => ({ id: 'e', title: 'Event', date: '2026-07-24', ...fields })

describe('eventDaySegments', () => {
  it('leaves an event that ends by midnight, and a one-day all-day one, whole', () => {
    const evening = event({ start: '21:00', duration: 180 })
    const holiday = event({ start: '00:00', duration: 1440, allDay: true })
    expect(eventDaySegments(evening)).toEqual([evening])
    expect(eventDaySegments(holiday)).toEqual([holiday])
  })

  it('gives a multi-day all-day event a whole-day piece on each day', () => {
    const trip = event({ start: '00:00', duration: 2880, allDay: true })
    const segments = eventDaySegments(trip)
    expect(segments.map(({ id, date, allDay, duration }) => [id, date, allDay, duration])).toEqual([
      ['e', '2026-07-24', true, 1440],
      ['e:2026-07-25', '2026-07-25', true, 1440],
    ])
    expect(segments[1].segmentOf).toBe(trip)
  })

  it('splits an overnight event at midnight', () => {
    const late = event({ start: '22:00', duration: 180 })
    const [first, second] = eventDaySegments(late)
    expect(first).toMatchObject({ id: 'e', date: '2026-07-24', start: '22:00', duration: 120 })
    expect(second).toMatchObject({
      id: 'e:2026-07-25',
      date: '2026-07-25',
      start: '00:00',
      duration: 60,
    })
    expect(first.segmentOf).toBe(late)
    expect(second.segmentOf).toBe(late)
    expect(isContinuationSegment(first)).toBe(false)
    expect(isContinuationSegment(second)).toBe(true)
    expect(isContinuationSegment(late)).toBe(false)
  })

  it('gives a multi-day event a piece on every day, across a month end', () => {
    const segments = eventDaySegments(event({ date: '2026-07-30', start: '09:00', duration: 3420 }))
    expect(segments.map(({ date, start, duration }) => [date, start, duration])).toEqual([
      ['2026-07-30', '09:00', 900],
      ['2026-07-31', '00:00', 1440],
      ['2026-08-01', '00:00', 1080],
    ])
  })

  it('leaves an event with an unreadable time whole', () => {
    const odd = event({ start: null, duration: 3000 })
    expect(eventDaySegments(odd)).toEqual([odd])
  })
})
