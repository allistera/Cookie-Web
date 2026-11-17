// A calendar invitation for e2e and database-free dev: Sarah Miller's Block
// Party mail (scripts/localApi/fixtures/emails.js) carries an invitation to
// the fixture mailbox, in the shape the messages Worker's
// GET /messages/calendar-invite returns. Answers are kept per fixture
// session by the caller, like the Worker keeps them per user.
export const FIXTURE_INVITATION_MESSAGE_ID = 'fixture-7'
export const FIXTURE_INVITATION_ID = 'fixture-invitation-block-party'

const HOUR = 60 * 60 * 1000
const MAILBOX = 'allister@cookie.example'

// Six days out at 15:00 UTC, so the invitation is always upcoming.
function invitationStart() {
  const start = new Date(Date.now() + 6 * 24 * HOUR)
  start.setUTCHours(15, 0, 0, 0)
  return start
}

export function fixtureInvitation(messageId, answers) {
  if (messageId !== FIXTURE_INVITATION_MESSAGE_ID) {
    return { calendar_invite: null, calendar_invitation: null }
  }
  const start = invitationStart()
  const end = new Date(start.getTime() + 2 * HOUR)
  const answer = answers.get(FIXTURE_INVITATION_ID)
  const details = {
    title: 'Neighborhood Block Party',
    location: 'Maple Street',
    start_at: start.toISOString(),
    end_at: end.toISOString(),
  }
  return {
    calendar_invite: { ...details, description: 'Bring a dish to share.' },
    calendar_invitation: {
      id: FIXTURE_INVITATION_ID,
      status: 'active',
      current: true,
      latest_message_id: FIXTURE_INVITATION_MESSAGE_ID,
      ...details,
      all_day: false,
      recurring: false,
      occurrence: false,
      organizer: { name: 'Sarah Miller', address: 'sarah.miller@gmail.com' },
      attendee: MAILBOX,
      sender: MAILBOX,
      can_reply: true,
      reply_blocked: null,
      response: answer?.response ?? null,
      responded_at: answer?.responded_at ?? null,
      event: answer?.event ?? null,
    },
  }
}

// The calendar entry an accepted or tentative answer files, placed on the
// clock of the zone the browser reported, as the send Worker does.
export function fixtureInvitationEvent(response, timeZone) {
  const start = invitationStart()
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(start)
  const value = (type) => parts.find((part) => part.type === type)?.value
  return {
    id: `stub-event-${FIXTURE_INVITATION_ID}`,
    title: 'Neighborhood Block Party',
    description: 'Bring a dish to share.',
    location: 'Maple Street',
    date: `${value('year')}-${value('month')}-${value('day')}`,
    start: `${value('hour')}:${value('minute')}`,
    duration: 120,
    calendar: 'personal',
    tone: response === 'accepted' ? 'accepted' : 'suggested',
    recurrenceRule: null,
    invitationId: FIXTURE_INVITATION_ID,
  }
}
