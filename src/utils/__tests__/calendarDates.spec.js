import { describe, expect, it } from 'vitest'
import { meetingLink, monthGrid } from '../calendarDates'

describe('monthGrid', () => {
  it('returns six Monday-first weeks covering the month', () => {
    const days = monthGrid(new Date(2026, 10, 17))
    expect(days).toHaveLength(42)
    expect(days[0].key).toBe('2026-10-26')
    expect(days[6].key).toBe('2026-11-01')
    expect(days.filter((day) => day.inMonth)).toHaveLength(30)
  })
})

describe('meetingLink', () => {
  it('finds a video-call link in the location or description', () => {
    expect(
      meetingLink({ location: 'Room 4', description: 'Join https://meet.google.com/abc-defg-hij' }),
    ).toBe('https://meet.google.com/abc-defg-hij')
    expect(meetingLink({ location: 'https://acme.zoom.us/j/99?pwd=x' })).toBe(
      'https://acme.zoom.us/j/99?pwd=x',
    )
  })

  it('ignores other hosts, look-alikes and non-https links', () => {
    expect(meetingLink({ location: 'https://example.com/zoom.us' })).toBeNull()
    expect(meetingLink({ location: 'https://zoom.us.evil.example/j/1' })).toBeNull()
    expect(meetingLink({ location: 'http://zoom.us/j/1' })).toBeNull()
    expect(meetingLink({ location: 'javascript:alert(1)' })).toBeNull()
    expect(meetingLink({})).toBeNull()
  })
})
