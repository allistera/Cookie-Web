export const dateKey = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

export function normalizeCalendarEvent(event) {
  return {
    ...event,
    allDay:
      event.allDay === true ||
      (String(event.start).startsWith('00:00') && Number(event.duration) >= 24 * 60),
  }
}

// 6 fixed Monday-first weeks for a mini month grid, so its height never jumps
// between months. `month` is any date inside the month to show.
export function monthGrid(month) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const mondayOffset = (first.getDay() + 6) % 7
  const days = []
  for (let index = 0; index < 42; index += 1) {
    const date = new Date(first.getFullYear(), first.getMonth(), 1 - mondayOffset + index)
    days.push({
      date,
      key: dateKey(date),
      label: date.getDate(),
      inMonth: date.getMonth() === first.getMonth(),
    })
  }
  return days
}

// Video-call hosts whose links are worth a one-click Join.
const MEETING_HOSTS =
  /^(?:[a-z0-9-]+\.)*(?:meet\.google\.com|zoom\.us|teams\.microsoft\.com|teams\.live\.com|whereby\.com|webex\.com|facetime\.apple\.com)$/i

// The first https video-call link in an event's location or description, or
// null. Only https links on known hosts are returned, so the Join button can
// never open a javascript: or look-alike URL.
export function meetingLink(event) {
  const text = `${event?.location ?? ''}\n${event?.description ?? ''}`
  for (const match of text.matchAll(/https:\/\/[^\s<>"')\]]+/gi)) {
    try {
      const url = new URL(match[0])
      if (url.protocol === 'https:' && MEETING_HOSTS.test(url.hostname)) return url.href
    } catch {
      // Not a parseable URL; keep looking.
    }
  }
  return null
}
