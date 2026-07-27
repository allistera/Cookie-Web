// Fixture rows in the same shape as the calendar-management API. Served by the local
// Vite middleware in e2e mode (and in dev when DATABASE_URL is unset) so the
// Calendar view works without a database. Ids match the `calendar` field on
// the seed rows in api/_fixtures/calendarEvents.js.
const rows = [
  { id: 'work', name: 'Work', color: '#4f7c6b' },
  { id: 'personal', name: 'Personal', color: '#2db985' },
  { id: 'focus', name: 'Focus time', color: '#795da8' },
  { id: 'birthdays', name: 'Birthdays', color: '#d8953b' },
  { id: 'holidays', name: 'Holidays', color: '#d15c4e' },
]

export function fixtureCalendars() {
  return rows.map((row) => ({ ...row }))
}
