// Pure helpers behind the task panel's schedule picker: reading and writing
// YYYY-MM-DD dates as local calendar days, the quick choices it offers, the
// month grids it draws and the text a typed date is read from. No DOM.
//
// Fixed en-GB formatters: the test box runs en-US, and the panel reads the
// same way everywhere ("Sat 24 Oct").

const WEEKDAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short' })
const DAY_MONTH = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' })
const MONTH_YEAR = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric' })
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

// A YYYY-MM-DD string as a local Date at midnight; null when malformed or
// not a real day (2026-02-30 rolls over, so it is refused).
export function dateFromIso(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''))
  if (!match) return null
  const [year, month, day] = match.slice(1).map(Number)
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day)
    return null
  return date
}

// The local calendar day of a Date as YYYY-MM-DD, built from local parts so
// an evening in a zone behind UTC does not read as tomorrow.
export function toIso(date) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function addDays(iso, days) {
  const date = dateFromIso(iso)
  if (!date) return null
  date.setDate(date.getDate() + days)
  return toIso(date)
}

// "Sat 24 Oct", with the year when it is not this one.
export function formatDay(iso, today) {
  const date = dateFromIso(iso)
  if (!date) return ''
  const sameYear = String(iso).slice(0, 4) === String(today ?? '').slice(0, 4)
  return `${WEEKDAY.format(date)} ${DAY_MONTH.format(date)}${sameYear ? '' : ` ${date.getFullYear()}`}`
}

// What a due date reads as on the chip: Today, Tomorrow, Yesterday, or the day.
export function describeDueDate(iso, today) {
  if (!iso) return 'No date'
  if (iso === today) return 'Today'
  if (iso === addDays(today, 1)) return 'Tomorrow'
  if (iso === addDays(today, -1)) return 'Yesterday'
  return formatDay(iso, today) || 'No date'
}

// The chip's whole text: the day, then the time when there is one.
export function scheduleSummary({ dueDate, dueTime } = {}, today) {
  const day = describeDueDate(dueDate, today)
  return dueDate && dueTime ? `${day} · ${dueTime}` : day
}

// Monday of the week after this one.
function nextMonday(today) {
  const date = dateFromIso(today)
  const weekday = (date.getDay() + 6) % 7 // Monday = 0
  return addDays(today, 7 - weekday)
}

// The quick choices above the calendar, as Todoist offers them: tomorrow,
// the start of next week, and next week's Saturday.
export function scheduleShortcuts(today) {
  const tomorrow = addDays(today, 1)
  const monday = nextMonday(today)
  const saturday = addDays(monday, 5)
  return [
    {
      id: 'tomorrow',
      label: 'Tomorrow',
      iso: tomorrow,
      hint: WEEKDAY.format(dateFromIso(tomorrow)),
      icon: 'light_mode',
    },
    {
      id: 'next-week',
      label: 'Next week',
      iso: monday,
      hint: formatDay(monday, today),
      icon: 'arrow_forward',
    },
    {
      id: 'next-weekend',
      label: 'Next weekend',
      iso: saturday,
      hint: formatDay(saturday, today),
      icon: 'event_available',
    },
  ]
}

// One month as Monday-first weeks of YYYY-MM-DD (null outside the month).
export function monthGrid(year, month) {
  const first = new Date(year, month - 1, 1)
  const label = MONTH_YEAR.format(first)
  const lead = (first.getDay() + 6) % 7
  const days = new Date(year, month, 0).getDate()
  const cells = [...Array(lead).fill(null)]
  for (let day = 1; day <= days; day++) cells.push(toIso(new Date(year, month - 1, day)))
  while (cells.length % 7) cells.push(null)
  const weeks = []
  for (let at = 0; at < cells.length; at += 7) weeks.push(cells.slice(at, at + 7))
  return { year, month, label, weeks }
}

// `count` months starting with the month of `iso`.
export function monthsFrom(iso, count) {
  const start = dateFromIso(iso) ?? new Date()
  const months = []
  for (let offset = 0; offset < count; offset++) {
    const date = new Date(start.getFullYear(), start.getMonth() + offset, 1)
    months.push(monthGrid(date.getFullYear(), date.getMonth() + 1))
  }
  return months
}

// A typed date: empty clears, then today / tomorrow / next week, YYYY-MM-DD,
// "24 Oct", "Oct 24" or "24 Oct 2027". A day without a year is the next one
// on or after today. Returns { iso } (null iso for a clear) or null when the
// text cannot be read.
export function parseDateInput(text, today) {
  const value = String(text ?? '')
    .trim()
    .toLowerCase()
  if (!value) return { iso: null }
  if (value === 'today') return { iso: today }
  if (value === 'tomorrow') return { iso: addDays(today, 1) }
  if (value === 'next week') return { iso: nextMonday(today) }
  if (dateFromIso(value)) return { iso: value }
  const parts = value.replace(/,/g, ' ').split(/\s+/)
  const dayAt = parts.findIndex((part) => /^\d{1,2}$/.test(part))
  const monthAt = parts.findIndex(
    (part) => MONTHS.includes(part.slice(0, 3)) && /^[a-z]+$/.test(part),
  )
  if (dayAt === -1 || monthAt === -1 || parts.length > 3) return null
  const year = parts.find((part, index) => index !== dayAt && index !== monthAt)
  if (year !== undefined && !/^\d{4}$/.test(year)) return null
  const day = Number(parts[dayAt])
  const month = MONTHS.indexOf(parts[monthAt].slice(0, 3)) + 1
  const pad = (number) => String(number).padStart(2, '0')
  if (year) {
    const iso = `${year}-${pad(month)}-${pad(day)}`
    return dateFromIso(iso) ? { iso } : null
  }
  // Eight years covers a whole leap cycle, including a skipped century leap
  // year, so 29 Feb finds its next real day.
  const thisYear = Number(String(today).slice(0, 4))
  for (let candidate = thisYear; candidate <= thisYear + 8; candidate++) {
    const iso = `${candidate}-${pad(month)}-${pad(day)}`
    if (dateFromIso(iso) && iso >= today) return { iso }
  }
  return null
}
