// Calendar events, persisted locally like the other client-only preferences
// (theme, signature, snippets) so created/edited/deleted events survive a
// page reload instead of resetting to the seed demo data every time.
const CALENDAR_EVENTS_KEY = 'cookie-calendar-events'

export function sanitizeStoredCalendarEvents(value) {
  if (!Array.isArray(value)) return null
  const events = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const id = typeof raw.id === 'string' ? raw.id : ''
    const title = typeof raw.title === 'string' ? raw.title : ''
    const date = typeof raw.date === 'string' ? raw.date : ''
    const start = typeof raw.start === 'string' ? raw.start : ''
    const duration = typeof raw.duration === 'number' ? raw.duration : 0
    const calendar = typeof raw.calendar === 'string' ? raw.calendar : ''
    if (!id || !title || !date || !start || !duration || !calendar) continue

    const event = { id, title, date, start, duration, calendar }
    if (typeof raw.tone === 'string') event.tone = raw.tone
    if (typeof raw.location === 'string') event.location = raw.location
    if (typeof raw.description === 'string') event.description = raw.description
    events.push(event)
  }
  return events
}

// Returns null when nothing has been stored yet, distinct from an empty
// array (which means the user deleted every event and that should stick).
export function getStoredCalendarEvents() {
  try {
    const raw = localStorage.getItem(CALENDAR_EVENTS_KEY)
    if (raw === null) return null
    return sanitizeStoredCalendarEvents(JSON.parse(raw))
  } catch {
    return null
  }
}

export function saveStoredCalendarEvents(events) {
  try {
    localStorage.setItem(CALENDAR_EVENTS_KEY, JSON.stringify(events))
  } catch (error) {
    console.error('Failed to save calendar events:', error)
  }
}
