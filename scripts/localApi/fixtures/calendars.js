// Fixture rows in the same shape as the calendar-management API. Served by the local
// Vite middleware in e2e mode (and in dev when DATABASE_URL is unset) so the
// Calendar view works without a database. Ids match the `calendar` field on
// the seed rows in scripts/localApi/fixtures/calendarEvents.js.
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

// Mirrors the Worker's basic URL validation and webcal normalization. Fixture
// sync never fetches the network; DNS/egress checks remain Worker-only.
export function fixtureSubscriptionUrl(value) {
  const url = String(value ?? '')
  if (!url || url.length > 2000) return null
  try {
    const parsed = new URL(url.replace(/^webcal:\/\//i, 'https://'))
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null
    return parsed.toString()
  } catch {
    return null
  }
}
