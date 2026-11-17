import { describe, expect, it } from 'vitest'
import {
  invitationAnswer,
  invitationBlockedReason,
  invitationHeading,
  invitationWhen,
  parseCalendarInvitation,
} from '../calendarInvitation'

const payload = (overrides = {}) => ({
  id: 'invitation-1',
  status: 'active',
  current: true,
  latest_message_id: 'message-1',
  title: 'Team sync',
  location: 'Room 4',
  start_at: '2026-12-01T10:00:00.000Z',
  end_at: '2026-12-01T11:00:00.000Z',
  all_day: false,
  recurring: false,
  occurrence: false,
  organizer: { name: 'Olive Organiser', address: 'olive@example.com' },
  attendee: 'me@cookie.test',
  sender: 'me@cookie.test',
  can_reply: true,
  reply_blocked: null,
  response: null,
  responded_at: null,
  event: null,
  ...overrides,
})

const invitation = (overrides) => parseCalendarInvitation(payload(overrides))
// The suite runs wherever the machine's clock is set; build instants from
// local wall-clock times so the expected words do not depend on it.
const local = (...parts) => new Date(...parts).toISOString()

describe('parseCalendarInvitation', () => {
  it('reads the Worker payload into the card’s fields', () => {
    expect(invitation()).toEqual({
      id: 'invitation-1',
      cancelled: false,
      current: true,
      title: 'Team sync',
      location: 'Room 4',
      startAt: '2026-12-01T10:00:00.000Z',
      endAt: '2026-12-01T11:00:00.000Z',
      allDay: false,
      recurring: false,
      occurrence: false,
      organizerName: 'Olive Organiser',
      organizerAddress: 'olive@example.com',
      attendee: 'me@cookie.test',
      sender: 'me@cookie.test',
      canReply: true,
      replyBlocked: '',
      response: null,
      respondedAt: null,
      event: null,
    })
  })

  it('keeps an answer and its calendar entry, and drops ones it does not know', () => {
    const answered = invitation({
      response: 'tentative',
      responded_at: '2026-11-17T12:00:00.000Z',
      event: { id: 'event-1', date: '2026-12-01' },
    })
    expect(answered).toMatchObject({
      response: 'tentative',
      respondedAt: '2026-11-17T12:00:00.000Z',
      event: { id: 'event-1', date: '2026-12-01' },
    })
    expect(
      invitation({ response: 'delegated', event: { id: 'event-1', date: 'soon' } }),
    ).toMatchObject({ response: null, event: null })
  })

  it('falls back for a missing title and treats only an explicit false as not current', () => {
    expect(invitation({ title: '  ', current: undefined })).toMatchObject({
      title: 'Untitled event',
      current: true,
    })
    expect(invitation({ current: false, status: 'cancelled' })).toMatchObject({
      current: false,
      cancelled: true,
    })
  })

  it.each([
    ['nothing', null],
    ['no id', payload({ id: '' })],
    ['a start that is not an instant', payload({ start_at: '2026-12-01' })],
    ['no end', payload({ end_at: null })],
    ['no organiser', payload({ organizer: null })],
    ['a list', [payload()]],
  ])('returns null for %s', (_label, value) => {
    expect(parseCalendarInvitation(value)).toBeNull()
  })
})

describe('invitationWhen', () => {
  it('gives a timed event its day and both times on the reader’s clock', () => {
    const when = invitationWhen(
      invitation({ start_at: local(2026, 11, 1, 10, 0), end_at: local(2026, 11, 1, 11, 30) }),
    )
    expect(when).toBe('Tue 1 Dec 2026, 10:00 to 11:30')
  })

  it('names both days of an event that runs past midnight', () => {
    const when = invitationWhen(
      invitation({ start_at: local(2026, 11, 1, 22, 0), end_at: local(2026, 11, 2, 1, 0) }),
    )
    expect(when).toBe('Tue 1 Dec, 22:00 to Wed 2 Dec 2026, 01:00')
  })

  it('reads all-day bounds as whole days with an exclusive end', () => {
    const oneDay = invitation({
      all_day: true,
      start_at: '2026-12-24T00:00:00.000Z',
      end_at: '2026-12-25T00:00:00.000Z',
    })
    expect(invitationWhen(oneDay)).toBe('Thu 24 Dec 2026, all day')
    const twoDays = invitation({
      all_day: true,
      start_at: '2026-12-24T00:00:00.000Z',
      end_at: '2026-12-26T00:00:00.000Z',
    })
    expect(invitationWhen(twoDays)).toBe('Thu 24 Dec to Fri 25 Dec 2026, all day')
  })
})

describe('invitationHeading', () => {
  it('names the organiser, by address when they gave no name', () => {
    expect(invitationHeading(invitation())).toBe('Olive Organiser invited you')
    expect(
      invitationHeading(invitation({ organizer: { name: null, address: 'olive@example.com' } })),
    ).toBe('olive@example.com invited you')
  })

  it('says when the invitation is for one date of a series, or was cancelled', () => {
    expect(invitationHeading(invitation({ occurrence: true }))).toBe(
      'Olive Organiser invited you to one date of a repeating event',
    )
    expect(invitationHeading(invitation({ status: 'cancelled' }))).toBe(
      'Olive Organiser cancelled this event',
    )
  })
})

describe('invitationAnswer', () => {
  it('is empty until the invitation is answered', () => {
    expect(invitationAnswer(invitation())).toBe('')
  })

  it.each([
    ['accepted', 'You accepted. Olive Organiser was told on 17 Nov.'],
    ['tentative', 'You answered maybe. Olive Organiser was told on 17 Nov.'],
    ['declined', 'You declined. Olive Organiser was told on 17 Nov.'],
  ])('states a %s answer and when the organiser was told', (response, expected) => {
    const answered = invitation({ response, responded_at: local(2026, 10, 17, 12, 0) })
    expect(invitationAnswer(answered)).toBe(expected)
  })

  it('states the answer alone when its time is unknown', () => {
    expect(invitationAnswer(invitation({ response: 'accepted' }))).toBe('You accepted.')
  })
})

describe('invitationBlockedReason', () => {
  it('is empty for an invitation that can be answered', () => {
    expect(invitationBlockedReason(invitation())).toBe('')
  })

  it('explains an invitation sent to another address instead of answering for it', () => {
    const reason = invitationBlockedReason(
      invitation({
        can_reply: false,
        reply_blocked: 'alias',
        attendee: 'alex@personal.example',
      }),
    )
    expect(reason).toBe(
      'This invitation was sent to alex@personal.example. Cookie sends mail as me@cookie.test, ' +
        'and an answer from that address would not count for alex@personal.example. ' +
        'Answer from the calendar that alex@personal.example belongs to.',
    )
  })

  it('explains an invitation whose guest list has none of the person’s addresses', () => {
    const blocked = { can_reply: false, reply_blocked: 'not_invited', attendee: null }
    expect(invitationBlockedReason(invitation(blocked))).toBe(
      'me@cookie.test, the address Cookie sends mail as, is not on the guest list, so Cookie cannot answer this invitation.',
    )
    expect(invitationBlockedReason(invitation({ ...blocked, sender: null }))).toContain(
      'None of your addresses is on the guest list',
    )
  })

  it('explains a cancelled invitation and a mailbox that cannot send', () => {
    expect(invitationBlockedReason(invitation({ status: 'cancelled', can_reply: false }))).toBe(
      'There is nothing to answer, and it is off your calendar.',
    )
    expect(
      invitationBlockedReason(invitation({ can_reply: false, reply_blocked: 'not_configured' })),
    ).toBe('Cookie cannot send mail at the moment, so it cannot answer this invitation.')
  })
})
