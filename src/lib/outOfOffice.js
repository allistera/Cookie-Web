export function outOfOfficeDefaults() {
  return {
    revision: 0,
    enabled: false,
    startDate: '',
    endDate: '',
    timeZone: 'UTC',
    subject: 'Out of office',
    text: '',
    activatedAt: null,
    review: [],
  }
}

export function localDate(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instant))
  return ['year', 'month', 'day']
    .map((type) => parts.find((part) => part.type === type)?.value)
    .join('-')
}

export function outOfOfficeStatus(settings, now = Date.now()) {
  if (!settings.enabled) return 'disabled'
  try {
    const day = localDate(now, settings.timeZone)
    if (day < settings.startDate) return 'scheduled'
    return day > settings.endDate ? 'expired' : 'active'
  } catch {
    return 'disabled'
  }
}

export function outOfOfficeError(value) {
  const hasControls = (text, multiline = false) =>
    [...text].some((character) => {
      const code = character.charCodeAt(0)
      return code === 127 || (code < 32 && !(multiline && [9, 10, 13].includes(code)))
    })
  const isDate = (date) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
    const parsed = new Date(`${date}T00:00:00Z`)
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date
  }
  if (!isDate(value.startDate) || !isDate(value.endDate)) return 'Choose real start and end dates.'
  if (value.endDate < value.startDate) return 'End date must be on or after the start date.'
  try {
    if (!value.timeZone || value.timeZone.length > 100 || /^[+-]/.test(value.timeZone))
      throw new Error()
    new Intl.DateTimeFormat('en', { timeZone: value.timeZone }).format(0)
  } catch {
    return 'Choose a valid IANA timezone.'
  }
  if (
    !value.subject?.trim() ||
    new TextEncoder().encode(value.subject).length > 998 ||
    hasControls(value.subject)
  )
    return 'Enter a subject of at most 998 bytes without control characters.'
  if (!value.text?.trim() || value.text.length > 10000 || hasControls(value.text, true))
    return 'Enter a plain-text message of at most 10,000 characters.'
  return ''
}

export function outOfOfficeDraft(document) {
  const { revision, enabled, startDate, endDate, timeZone, subject, text } = document
  return { revision, enabled, startDate, endDate, timeZone, subject, text }
}
