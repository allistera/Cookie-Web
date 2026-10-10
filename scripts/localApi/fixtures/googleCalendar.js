// A connected Google account for the local Vite middleware (e2e mode, and dev
// without DATABASE_URL). Google itself is never contacted: "signing in" is a
// round trip to the fixture's own /google-calendar/callback, and these rows
// stand in for what cookie-web-calendar would read from the Google Calendar
// API. Shapes match the Worker's googleCalendar.js — a `google:<calendar>`
// calendar id, `google:<calendar>:<event>` event ids — and the dates sit on
// the e2e specs' frozen clock (2026-07-24).

export const FIXTURE_GOOGLE_EMAIL = 'person@example.com'

const calendars = [
  {
    id: 'person@example.com',
    name: 'person@example.com',
    color: '#9fe1e7',
    primary: true,
    readOnly: false,
  },
  {
    id: 'team@group.calendar.google.com',
    name: 'Team',
    color: '#f6bf26',
    primary: false,
    readOnly: true,
  },
]

export function fixtureGoogleCalendars() {
  return calendars.map((calendar) => ({ ...calendar }))
}

/**
 * The /calendar-events row shape for a Google event (googleCalendar.js's
 * mapGoogleEvent).
 */
export function googleEventRow(calendarId, eventId, fields) {
  const id = `google:${calendarId}:${eventId}`
  return {
    id,
    seriesId: id,
    description: null,
    location: null,
    tone: null,
    recurrenceRule: null,
    allDay: false,
    autoScheduled: false,
    source: 'google',
    googleCalendarId: calendarId,
    googleEventId: eventId,
    recurring: false,
    readOnly: calendars.find((calendar) => calendar.id === calendarId)?.readOnly ?? false,
    htmlLink: `https://calendar.google.com/calendar/event?eid=${eventId}`,
    calendar: `google:${calendarId}`,
    ...fields,
  }
}

export function fixtureGoogleEvents() {
  return [
    googleEventRow('person@example.com', 'dentist', {
      title: 'Dentist',
      location: 'High Street',
      date: '2026-07-24',
      start: '15:00',
      duration: 60,
      recurring: true,
    }),
    googleEventRow('team@group.calendar.google.com', 'offsite', {
      title: 'Team offsite',
      date: '2026-07-24',
      start: '00:00',
      duration: 1440,
      allDay: true,
    }),
  ]
}
