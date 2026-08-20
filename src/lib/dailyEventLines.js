// Shared by the server (Cookie-Worker's cookie-web-tasks/src/dailyEventSync.js, which syncs a match into
// a real calendar event) and the client (documentScheduleHighlight.js, which
// just highlights matching text as the user types) so "does this line
// describe a scheduled time" has exactly one definition. Operates on already
// -plain text: the server strips Editor.js's inline HTML before calling
// this; the client already has plain text via element.textContent.
//
// Two shapes match, checked in this order so "10:00 - 11:00 - Title" isn't
// swallowed by the single-time pattern (its greedy title group would
// otherwise eat "11:00 - Title" whole):
//   "10:00 - 11:00 - Title"  -> explicit start and end
//   "10:00 - Title"          -> start only, defaults to a 30-minute event
// Title groups are (.*?), not (.+?): an empty/whitespace-only title must
// still match here (and then get rejected by the `!title` check below) so
// it can't fall through and be misparsed by the other pattern instead - e.g.
// "10:00 - 11:00 - " must be rejected outright, not reinterpreted by
// SINGLE_RE as a single-time event titled "11:00 -".
const RANGE_RE = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*-\s*(.*?)\s*$/
const SINGLE_RE = /^(\d{1,2}):(\d{2})\s*-\s*(.*?)\s*$/
const DEFAULT_DURATION_MINUTES = 30
const MAX_TITLE = 200

const pad2 = (n) => String(n).padStart(2, '0')

function validTime(hour, minute) {
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59
}

// @param {string} text - already-plain text (no HTML)
// @returns {{start: string, durationMinutes: number, title: string} | null}
export function matchTimeLine(text) {
  const line = String(text ?? '').trim()

  const range = RANGE_RE.exec(line)
  if (range) {
    const [, sh, sm, eh, em, rawTitle] = range
    const startHour = Number(sh)
    const startMinute = Number(sm)
    const endHour = Number(eh)
    const endMinute = Number(em)
    const title = rawTitle.trim().slice(0, MAX_TITLE)
    if (!validTime(startHour, startMinute) || !validTime(endHour, endMinute) || !title) return null
    const durationMinutes = endHour * 60 + endMinute - (startHour * 60 + startMinute)
    if (durationMinutes <= 0) return null
    return { start: `${pad2(startHour)}:${pad2(startMinute)}`, durationMinutes, title }
  }

  const single = SINGLE_RE.exec(line)
  if (single) {
    const [, sh, sm, rawTitle] = single
    const startHour = Number(sh)
    const startMinute = Number(sm)
    const title = rawTitle.trim().slice(0, MAX_TITLE)
    if (!validTime(startHour, startMinute) || !title) return null
    return {
      start: `${pad2(startHour)}:${pad2(startMinute)}`,
      durationMinutes: DEFAULT_DURATION_MINUTES,
      title,
    }
  }

  return null
}
