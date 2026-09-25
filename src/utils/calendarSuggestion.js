const MONTHS = new Map([
  ['jan', 0],
  ['feb', 1],
  ['mar', 2],
  ['apr', 3],
  ['may', 4],
  ['jun', 5],
  ['jul', 6],
  ['aug', 7],
  ['sep', 8],
  ['oct', 9],
  ['nov', 10],
  ['dec', 11],
])

const WEEKDAYS = new Map([
  ['sunday', 0],
  ['monday', 1],
  ['tuesday', 2],
  ['wednesday', 3],
  ['thursday', 4],
  ['friday', 5],
  ['saturday', 6],
])

const EVENT_LANGUAGE =
  /\b(appointment|booking|call|class|conference|dinner|event|game|interview|invitation|lunch|meeting|party|reservation|scrimmage|session|tour|visit|webinar|workshop)\b/i
const MONTH_DATE =
  /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/i
const DAY_MONTH_DATE =
  /\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)(?:,?\s+(\d{4}))?\b/i
const SLASH_MONTH_DATE =
  /\b(\d{1,2})\/(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\/(\d{4})\b/i
const NUMERIC_DATE = /\b(\d{1,2})[-/](\d{1,2})[-/](\d{4})\b/
const ISO_DATE = /\b(\d{4})-(\d{2})-(\d{2})\b/
const RELATIVE_DATE =
  /\b(tomorrow|next\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday))\b/i
const TIME =
  /\b(\d{1,2}):(\d{2})(?:\s*(a\.?m\.?|p\.?m\.?))?\b|\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i

const pad2 = (value) => String(value).padStart(2, '0')
const dateKey = (date) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())

function validDate(year, month, day) {
  const date = new Date(year, month, day)
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day
    ? date
    : null
}

function detectedDate(text, sentAt) {
  const iso = text.match(ISO_DATE)
  if (iso) return validDate(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))

  const monthDate = text.match(MONTH_DATE)
  if (monthDate) {
    const month = MONTHS.get(monthDate[1].slice(0, 3).toLowerCase())
    let year = monthDate[3] ? Number(monthDate[3]) : sentAt.getFullYear()
    let date = validDate(year, month, Number(monthDate[2]))
    if (!monthDate[3] && date && date < startOfDay(sentAt)) {
      year += 1
      date = validDate(year, month, Number(monthDate[2]))
    }
    return date
  }

  const dayMonthDate = text.match(DAY_MONTH_DATE)
  if (dayMonthDate) {
    const month = MONTHS.get(dayMonthDate[2].slice(0, 3).toLowerCase())
    let year = dayMonthDate[3] ? Number(dayMonthDate[3]) : sentAt.getFullYear()
    let date = validDate(year, month, Number(dayMonthDate[1]))
    if (!dayMonthDate[3] && date && date < startOfDay(sentAt)) {
      year += 1
      date = validDate(year, month, Number(dayMonthDate[1]))
    }
    return date
  }

  const slashMonthDate = text.match(SLASH_MONTH_DATE)
  if (slashMonthDate) {
    const month = MONTHS.get(slashMonthDate[2].slice(0, 3).toLowerCase())
    return validDate(Number(slashMonthDate[3]), month, Number(slashMonthDate[1]))
  }

  const numericDate = text.match(NUMERIC_DATE)
  if (numericDate) {
    return validDate(Number(numericDate[3]), Number(numericDate[2]) - 1, Number(numericDate[1]))
  }

  const relative = text.match(RELATIVE_DATE)?.[1].toLowerCase()
  if (!relative) return null
  const date = startOfDay(sentAt)
  if (relative === 'tomorrow') {
    date.setDate(date.getDate() + 1)
    return date
  }

  const weekday = WEEKDAYS.get(relative.replace('next ', ''))
  const daysAhead = (weekday - date.getDay() + 7) % 7 || 7
  date.setDate(date.getDate() + daysAhead)
  return date
}

function detectedTime(text) {
  const match = text.match(TIME)
  if (!match) return null
  let hour = Number(match[1] ?? match[4])
  const minute = Number(match[2] ?? match[5] ?? 0)
  const meridiem = match[3] ?? match[6]
  if (minute > 59) return null
  if (!meridiem) {
    if (hour > 23) return null
    return hour * 60 + minute
  }
  if (hour < 1 || hour > 12) return null
  const normalizedMeridiem = meridiem.toLowerCase().startsWith('p') ? 'pm' : 'am'
  if (hour === 12) hour = 0
  if (normalizedMeridiem === 'pm') hour += 12
  return hour * 60 + minute
}

function cleanTitle(subject) {
  return subject.replace(/^(?:(?:re|fwd?|confirmation|invitation):\s*)+/i, '').trim()
}

function localDateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function localTime(date) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

function structuredCalendarSuggestion(email, now) {
  const invite = email?.calendarInvite
  if (!invite || Array.isArray(invite)) return null

  const title = String(invite.title ?? '').trim()
  const startValue = invite.start_at
  const endValue = invite.end_at
  if (!startValue?.match?.(ISO_INSTANT) || !endValue?.match?.(ISO_INSTANT)) {
    return null
  }
  const start = new Date(startValue)
  const end = new Date(endValue)
  if (
    !title ||
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    end <= start ||
    end <= now
  ) {
    return null
  }

  // The existing draft contract has one local date and two local clock times;
  // a midnight-spanning invite cannot be represented without changing it.
  if (localDateKey(start) !== localDateKey(end)) return null

  return {
    title,
    description: String(invite.description ?? ''),
    location: String(invite.location ?? ''),
    date: localDateKey(start),
    start: localTime(start),
    end: localTime(end),
  }
}

export function detectCalendarSuggestion(email, now = new Date()) {
  if (!email || email.isSent) return null
  const structured = structuredCalendarSuggestion(email, now)
  if (structured) return structured
  const subject = String(email.subject || '')
  const body = String(email.body || email.snippet || '')
  const text = `${subject}\n${body}`
  if (!EVENT_LANGUAGE.test(text)) return null

  const sentAt = new Date(email.sentAt || now)
  const date = detectedDate(text, Number.isNaN(sentAt.getTime()) ? now : sentAt)
  const startMinutes = detectedTime(text)
  if (!date || startMinutes === null) return null

  const endMinutes = Math.min(startMinutes + 60, 23 * 60 + 59)
  // Match the structured path: an event that has already ended is not offered,
  // including one earlier today.
  const endsAt = new Date(date)
  endsAt.setHours(0, endMinutes, 0, 0)
  if (endsAt <= now) return null
  const source = email.sender ? `From ${email.sender}: ` : ''
  return {
    title: cleanTitle(subject) || 'Event from email',
    description: `${source}${email.snippet || body}`.trim(),
    location: '',
    date: dateKey(date),
    start: `${pad2(Math.floor(startMinutes / 60))}:${pad2(startMinutes % 60)}`,
    end: `${pad2(Math.floor(endMinutes / 60))}:${pad2(endMinutes % 60)}`,
  }
}

export function formatCalendarSuggestion(suggestion) {
  if (!suggestion) return ''
  const date = new Date(`${suggestion.date}T${suggestion.start}:00`)
  return date.toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}
