import { describe, expect, it } from 'vitest'

import { detectCalendarSuggestion, formatCalendarSuggestion } from '../calendarSuggestion'

const NOW = new Date('2026-07-28T12:00:00')

describe('detectCalendarSuggestion', () => {
  it('extracts an explicit future event date and time from an email', () => {
    const suggestion = detectCalendarSuggestion(
      {
        subject: 'Confirmation: August 12th guided tour',
        sender: 'Univ of State Tours',
        snippet: 'Tours depart from the Visitor Center at 10:00 AM sharp.',
        sentAt: '2026-07-27T08:00:00Z',
      },
      NOW,
    )

    expect(suggestion).toEqual({
      title: 'August 12th guided tour',
      description:
        'From Univ of State Tours: Tours depart from the Visitor Center at 10:00 AM sharp.',
      location: '',
      date: '2026-08-12',
      start: '10:00',
      end: '11:00',
    })
    expect(formatCalendarSuggestion(suggestion)).toContain('Wed 12 Aug')
    expect(formatCalendarSuggestion(suggestion)).toContain('10:00')
  })

  it('supports relative event dates', () => {
    const suggestion = detectCalendarSuggestion(
      {
        subject: 'Project meeting next Thursday at 2:30 PM',
        snippet: 'Please join us for the planning session.',
        sentAt: '2026-07-28T08:00:00Z',
      },
      NOW,
    )

    expect(suggestion).toMatchObject({ date: '2026-07-30', start: '14:30', end: '15:30' })
  })

  it('does not suggest non-events, past events, or events without a concrete time', () => {
    expect(
      detectCalendarSuggestion(
        { subject: 'Your statement is ready', body: 'Payment is due August 12th at 10:00 AM.' },
        NOW,
      ),
    ).toBeNull()
    expect(
      detectCalendarSuggestion(
        { subject: 'June 12th guided tour at 10:00 AM', sentAt: '2026-05-20T08:00:00Z' },
        NOW,
      ),
    ).toBeNull()
    expect(
      detectCalendarSuggestion(
        { subject: 'August 12th guided tour', sentAt: '2026-07-27T08:00:00Z' },
        NOW,
      ),
    ).toBeNull()
  })
})
