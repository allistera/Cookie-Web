// Date text for the document editor's "/" Date block: "Monday - 4th September".

export function ordinalDay(day) {
  if (day % 100 >= 11 && day % 100 <= 13) return `${day}th`
  return `${day}${['th', 'st', 'nd', 'rd'][day % 10] ?? 'th'}`
}

export function formatInsertedDate(date = new Date()) {
  const weekday = date.toLocaleDateString('en-GB', { weekday: 'long' })
  const month = date.toLocaleDateString('en-GB', { month: 'long' })
  return `${weekday} - ${ordinalDay(date.getDate())} ${month}`
}

// Daily note title, e.g. "13-08-26".
export function formatDailyNoteTitle(date = new Date()) {
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = String(date.getFullYear() % 100).padStart(2, '0')
  return `${day}-${month}-${year}`
}

// Daily note year/month folder names, e.g. "2026" / "Aug".
export function formatDailyYearFolder(date = new Date()) {
  return String(date.getFullYear())
}

export function formatDailyMonthFolder(date = new Date()) {
  return date.toLocaleDateString('en-GB', { month: 'short' })
}

const DAILY_NOTE_TITLE_RE = /^(\d{2})-(\d{2})-(\d{2})$/

// Inverse of formatDailyNoteTitle: "13-08-26" -> Date(2026, 7, 13). Returns
// null for anything that isn't that exact shape, including a title that
// looks close but names a calendar date that doesn't exist (e.g. "31-02-26").
export function parseDailyNoteDate(title) {
  const match = DAILY_NOTE_TITLE_RE.exec(title ?? '')
  if (!match) return null
  const [, day, month, year] = match
  const date = new Date(2000 + Number(year), Number(month) - 1, Number(day))
  if (date.getDate() !== Number(day) || date.getMonth() !== Number(month) - 1) return null
  return date
}
