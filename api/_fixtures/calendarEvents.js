// Fixture rows in the same shape as GET /api/calendar-events. Served by the
// local Vite middleware in e2e mode (and in dev when DATABASE_URL is unset)
// so the Calendar view works without a database.
const rows = [
  {
    id: 'team-sync',
    title: 'Team sync',
    date: '2026-07-20',
    start: '09:00',
    duration: 30,
    calendar: 'work',
  },
  {
    id: 'priya',
    title: '1:1 with Priya',
    date: '2026-07-21',
    start: '10:00',
    duration: 30,
    calendar: 'work',
  },
  {
    id: 'focus',
    title: 'Focus — Q3 planning',
    date: '2026-07-22',
    start: '13:00',
    duration: 120,
    tone: 'dark',
    calendar: 'focus',
  },
  {
    id: 'design',
    title: 'Design review',
    date: '2026-07-23',
    start: '11:00',
    duration: 60,
    calendar: 'work',
  },
  {
    id: 'client-call',
    title: 'Client call — Meridian',
    date: '2026-07-23',
    start: '11:30',
    duration: 60,
    tone: 'conflict',
    calendar: 'work',
  },
  {
    id: 'standup',
    title: 'Standup',
    date: '2026-07-24',
    start: '09:00',
    duration: 30,
    calendar: 'work',
  },
  {
    id: 'coffee',
    title: 'Coffee with Sam',
    date: '2026-07-24',
    start: '14:30',
    duration: 30,
    tone: 'accepted',
    calendar: 'personal',
  },
  {
    id: 'holiday',
    title: 'Company Holiday',
    date: '2026-07-24',
    start: '00:00',
    duration: 1440,
    // Exercises the compatibility path for rows created before all_day was
    // added to the calendar schema.
    calendar: 'holidays',
  },
]

export function fixtureCalendarEvents() {
  return rows.map((row) => ({ ...row }))
}

// Stands in for the events a real ICS subscription would pull in — the local
// middleware serves this instead of making an outbound fetch. Dated to the day
// the Calendar view opens on (REFERENCE_DATE in src/views/CalendarView.vue,
// which the seed rows above also sit around) rather than the real today, so a
// synced event is actually visible where the fixture calendar starts.
export function fixtureSubscribedEvent(calendarId) {
  return {
    id: `subscribed-${calendarId}`,
    title: 'Synced from subscription (dev stub)',
    date: '2026-07-24',
    start: '16:00',
    duration: 30,
    calendar: calendarId,
  }
}
