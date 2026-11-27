// The reader's view of a calendar invitation: the messages Worker's
// `calendar_invitation` payload, checked at the boundary, and the words the
// invitation card shows for it.

export const INVITATION_RESPONSES = [
  { value: 'accepted', label: 'Accept', answered: 'You accepted' },
  { value: 'tentative', label: 'Maybe', answered: 'You answered maybe' },
  { value: 'declined', label: 'Decline', answered: 'You declined' },
]

const RESPONSE_VALUES = INVITATION_RESPONSES.map((response) => response.value)
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/
const MS_PER_DAY = 24 * 60 * 60 * 1000

function instant(value) {
  const text = String(value ?? '')
  return ISO_INSTANT.test(text) && !Number.isNaN(Date.parse(text)) ? text : null
}

function linkedEvent(event) {
  const id = String(event?.id ?? '')
  const date = String(event?.date ?? '')
  return id && DATE_KEY.test(date) ? { id, date } : null
}

// Anything that does not read as an invitation is dropped here, so the card
// never has to second-guess a field.
export function parseCalendarInvitation(payload) {
  const id = String(payload?.id ?? '')
  const startAt = instant(payload?.start_at)
  const endAt = instant(payload?.end_at)
  const organizerAddress = String(payload?.organizer?.address ?? '')
  if (!id || !startAt || !endAt || !organizerAddress) return null
  const response = String(payload.response ?? '')
  return {
    id,
    cancelled: payload.status === 'cancelled',
    // False when the open message is an older revision than the stored one.
    current: payload.current !== false,
    title: String(payload.title ?? '').trim() || 'Untitled event',
    location: String(payload.location ?? '').trim(),
    startAt,
    endAt,
    allDay: payload.all_day === true,
    recurring: payload.recurring === true,
    occurrence: payload.occurrence === true,
    organizerName: String(payload.organizer.name ?? '').trim(),
    organizerAddress,
    attendee: String(payload.attendee ?? ''),
    sender: String(payload.sender ?? ''),
    canReply: payload.can_reply === true,
    replyBlocked: String(payload.reply_blocked ?? ''),
    response: RESPONSE_VALUES.includes(response) ? response : null,
    respondedAt: instant(payload.responded_at),
    event: linkedEvent(payload.event),
  }
}

function invitationOrganizer(invitation) {
  return invitation.organizerName || invitation.organizerAddress
}

const TIME_FMT = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' })
const RESPONDED_DAY_FMT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' })
const LOCAL_DAY_FMT = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})
const UTC_DAY_FMT = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

// "Tue 1 Dec 2026", put together from the formatter's parts: left to itself
// the formatter punctuates a date differently from one engine to the next.
function dayText(date, { year, timeZone }) {
  const formatter = timeZone === 'UTC' ? UTC_DAY_FMT : LOCAL_DAY_FMT
  const parts = formatter.formatToParts(date)
  const part = (type) => parts.find((entry) => entry.type === type)?.value ?? ''
  const day = `${part('weekday')} ${part('day')} ${part('month')}`
  return year ? `${day} ${part('year')}` : day
}

// When the event is, on the reader's own clock. All-day bounds are UTC
// midnights with an exclusive end, so they are read in UTC and the last day
// is the one before the end.
export function invitationWhen(invitation) {
  const start = new Date(invitation.startAt)
  const end = new Date(invitation.endAt)
  if (invitation.allDay) {
    const last = end.getTime() <= start.getTime() ? start : new Date(end.getTime() - MS_PER_DAY)
    const lastDay = dayText(last, { year: true, timeZone: 'UTC' })
    return last.getTime() <= start.getTime()
      ? `${lastDay}, all day`
      : `${dayText(start, { year: false, timeZone: 'UTC' })} to ${lastDay}, all day`
  }
  const startTime = TIME_FMT.format(start)
  const endTime = TIME_FMT.format(end)
  const endDay = dayText(end, { year: true })
  return dayText(start, { year: true }) === endDay
    ? `${endDay}, ${startTime} to ${endTime}`
    : `${dayText(start, { year: false })}, ${startTime} to ${endDay}, ${endTime}`
}

export function invitationHeading(invitation) {
  const organizer = invitationOrganizer(invitation)
  if (invitation.cancelled) return `${organizer} cancelled this event`
  return invitation.occurrence
    ? `${organizer} invited you to one date of a repeating event`
    : `${organizer} invited you`
}

// The answer on record and when the organiser was told, or '' before any.
export function invitationAnswer(invitation) {
  const answered = INVITATION_RESPONSES.find(
    (response) => response.value === invitation.response,
  )?.answered
  if (!answered) return ''
  const told = invitation.respondedAt
    ? RESPONDED_DAY_FMT.format(new Date(invitation.respondedAt))
    : ''
  return told
    ? `${answered}. ${invitationOrganizer(invitation)} was told on ${told}.`
    : `${answered}.`
}

// Why the card has no answer buttons, in words, or '' when it has them.
export function invitationBlockedReason(invitation) {
  if (invitation.cancelled) return 'There is nothing to answer, and it is off your calendar.'
  if (invitation.canReply) return ''
  if (invitation.replyBlocked === 'alias') {
    return (
      `This invitation was sent to ${invitation.attendee}. Cookie sends mail as ${invitation.sender}, ` +
      `and an answer from that address would not count for ${invitation.attendee}. ` +
      `Answer from the calendar that ${invitation.attendee} belongs to.`
    )
  }
  if (invitation.replyBlocked === 'not_invited') {
    return invitation.sender
      ? `${invitation.sender}, the address Cookie sends mail as, is not on the guest list, so Cookie cannot answer this invitation.`
      : 'None of your addresses is on the guest list, so Cookie cannot answer this invitation.'
  }
  return 'Cookie cannot send mail at the moment, so it cannot answer this invitation.'
}
