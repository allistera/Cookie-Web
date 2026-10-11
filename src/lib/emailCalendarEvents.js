// Ties an email's detected event to the calendar entry made from it, so the
// reader keeps saying "already on your calendar" after that entry is renamed
// or moved.
//
// Two signals, checked in this order:
// 1. A remembered link. When Calendar creates an event from a Mail
//    suggestion it records message id -> event id here (localStorage; the
//    calendar_events schema has no source-message column). This browser only.
// 2. A content match on the suggested day's events (utils/calendarSuggestion
//    .js): covers entries made elsewhere, such as an invite Google Calendar
//    added by itself, and other devices.
import { findCalendarSuggestionEvent } from '../utils/calendarSuggestion'

const STORAGE_KEY = 'cookie.emailCalendarEvents'
// Oldest links fall off first; a few hundred emails back is plenty.
const MAX_LINKS = 200
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

// Stored as [messageId, { id, date }] entries, oldest first. Anything that
// does not read as one is dropped at this boundary.
function parsedLink(messageId, link) {
  const id = String(link?.id ?? '')
  const date = String(link?.date ?? '')
  return messageId && id && DATE_KEY.test(date) ? { id, date } : null
}

function readLinks() {
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? '[]')
    const links = new Map()
    for (const entry of Array.isArray(parsed) ? parsed : []) {
      const [rawId, rawLink] = Array.isArray(entry) ? entry : []
      const messageId = String(rawId ?? '')
      const link = parsedLink(messageId, rawLink)
      if (link) links.set(messageId, link)
    }
    return links
  } catch {
    return new Map()
  }
}

function writeLinks(links) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify([...links]))
  } catch {
    // Private mode or a full quota: the content match still works.
  }
}

export function rememberEmailCalendarEvent(messageId, link) {
  const key = String(messageId ?? '')
  const parsed = parsedLink(key, link)
  if (!parsed) return
  const links = readLinks()
  // Re-insert so the newest link sits last and survives the cap longest.
  links.delete(key)
  links.set(key, parsed)
  writeLinks(new Map([...links].slice(-MAX_LINKS)))
}

export function rememberedEmailCalendarEvent(messageId) {
  return readLinks().get(String(messageId ?? '')) ?? null
}

// A Calendar edit that moves a linked event keeps the link on its new day,
// so the reader's lookup window still reaches it.
export function relinkEmailCalendarEvent(eventId, date) {
  const id = String(eventId ?? '')
  const day = String(date ?? '')
  if (!id || !DATE_KEY.test(day)) return
  const links = readLinks()
  let moved = false
  for (const [messageId, link] of links) {
    if (link.id !== id || link.date === day) continue
    links.set(messageId, { id, date: day })
    moved = true
  }
  if (moved) writeLinks(links)
}

// The events window the reader needs: the suggested day, widened to the
// remembered event's day when the two differ (the event was moved).
export function emailCalendarEventRange(suggestion, remembered) {
  const dates = [suggestion?.date, remembered?.date].filter(Boolean).sort()
  return dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null
}

// A remembered link wins; a recurring series counts through any occurrence
// on the remembered day, which is the row the Calendar link can open.
export function findEmailCalendarEvent(events, { suggestion, remembered = null } = {}) {
  const rows = Array.isArray(events) ? events : []
  if (remembered) {
    const linked = rows.find(
      (event) =>
        event?.date === remembered.date &&
        (event.id === remembered.id || event.seriesId === remembered.id),
    )
    if (linked) return linked
  }
  return findCalendarSuggestionEvent(suggestion, rows)
}
