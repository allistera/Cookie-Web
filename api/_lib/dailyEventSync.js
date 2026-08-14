import { parseDailyNoteDate } from '../../src/lib/documentDates.js'

// A line typed into a Daily note (a plain paragraph, or an item in a
// bulleted/numbered/checklist list, at any nesting depth) auto-creates/
// updates/deletes a linked calendar_events row, keyed by where it lives in
// the document (source_document_id/source_block_id, migration 0047; see
// extractTimeLines for how that key is built for a list item, which has no
// id of its own the way a block does). Two shapes match, checked in this
// order so "10:00 - 11:00 - Title" isn't swallowed by the single-time
// pattern (its greedy title group would otherwise eat "11:00 - Title" whole):
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

// Editor.js paragraph text is HTML (inline bold/italic/link markup from the
// toolbar) — strip tags before matching or extracting a title so formatting
// can't break the pattern or leak markup into the event title.
function plainText(html) {
  return String(html ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
}

// @param {string} text
// @returns {{start: string, durationMinutes: number, title: string} | null}
export function parseTimeLine(text) {
  const line = plainText(text)

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
    return { start: `${pad2(startHour)}:${pad2(startMinute)}`, durationMinutes: DEFAULT_DURATION_MINUTES, title }
  }

  return null
}

// @editorjs/list (bullet/numbered/checklist - one tool, one block type,
// covering all three styles) gives the *block* an id but never its
// individual items: data.items is a plain (recursively nestable) array with
// no per-item identity of its own. A positional path (block id + each
// nesting level's index) is the closest thing to a stable key available -
// stable across an edit in place or an append at the end, but not across
// reordering or inserting/deleting a bullet above an existing one, which
// reads as that item's old key disappearing and a new one appearing at the
// shifted position (delete the old event, create a new one - never silently
// wrong, just loses the old row's identity across the edit).
function collectListItemLines(items, keyPrefix, lines) {
  items.forEach((item, index) => {
    const key = `${keyPrefix}:${index}`
    const line = parseTimeLine(item?.content)
    if (line) lines.set(key, line)
    if (Array.isArray(item?.items) && item.items.length > 0) {
      collectListItemLines(item.items, key, lines)
    }
  })
}

// @param {any[]} blocks
// @returns {Map<string, {start: string, durationMinutes: number, title: string}>}
export function extractTimeLines(blocks) {
  const lines = new Map()
  for (const block of blocks ?? []) {
    const id = block?.id
    // Identity check (not just a truthy value) keeps a non-string id that
    // coerces into a plausible key, e.g. a number, out of the Map.
    if (!id || id !== String(id)) continue
    if (block.type === 'paragraph') {
      const line = parseTimeLine(block.data?.text)
      if (line) lines.set(id, line)
    } else if (block.type === 'list' && Array.isArray(block.data?.items)) {
      collectListItemLines(block.data.items, id, lines)
    }
  }
  return lines
}

// Local (not UTC) date key — parseDailyNoteDate returns a local Date, and
// event_date must name the calendar day the note is actually about.
export function dateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

// The date a Daily note (Daily/<year>/<month>/DD-MM-YY) represents, as an
// event_date-ready string, or null for any other document — mirrors
// src/stores/documents.js's openDocDailyDate getter, server-side.
export async function resolveDailyNoteEventDate(sql, userId, folderId, title) {
  const date = parseDailyNoteDate(title)
  if (!date || folderId === null || folderId === undefined) return null
  const [root] = await sql`
    WITH RECURSIVE ancestry AS (
      SELECT id, parent_id, title FROM document_folders WHERE id = ${folderId} AND user_id = ${userId}
      UNION ALL
      SELECT f.id, f.parent_id, f.title FROM document_folders f
      JOIN ancestry a ON f.id = a.parent_id
    )
    SELECT title FROM ancestry WHERE parent_id IS NULL
  `
  return root?.title === 'Daily' ? dateKey(date) : null
}

// Prefers a calendar named "Personal" (the app's seeded default, migration
// 0023); falls back to the user's oldest non-subscription calendar. Returns
// null only if the user somehow has no writable calendar at all, in which
// case syncDailyNoteEvents skips creating anything rather than erroring the
// whole document save over it.
export async function resolveDefaultCalendarId(sql, userId) {
  const [calendar] = await sql`
    SELECT id FROM calendars
    WHERE user_id = ${userId} AND subscription_url IS NULL
    ORDER BY (name = 'Personal') DESC, created_at ASC
    LIMIT 1
  `
  return calendar?.id ?? null
}

// Diffs the time-range lines in a Daily note's old vs. new blocks and
// applies the difference to calendar_events within the caller's transaction.
// eventDate: the note's own date (resolveDailyNoteEventDate), not "today".
export async function syncDailyNoteEvents(sql, userId, documentId, eventDate, oldBlocks, newBlocks) {
  const oldLines = extractTimeLines(oldBlocks)
  const newLines = extractTimeLines(newBlocks)

  for (const blockId of oldLines.keys()) {
    if (!newLines.has(blockId)) {
      await sql`
        DELETE FROM calendar_events
        WHERE source_document_id = ${documentId} AND source_block_id = ${blockId}
      `
    }
  }

  if (newLines.size === 0) return

  const calendarId = await resolveDefaultCalendarId(sql, userId)
  if (!calendarId) return

  for (const [blockId, line] of newLines) {
    await sql`
      INSERT INTO calendar_events (
        user_id, title, event_date, start_time, duration_minutes, calendar,
        source_document_id, source_block_id
      )
      VALUES (
        ${userId}, ${line.title}, ${eventDate}, ${line.start}, ${line.durationMinutes}, ${calendarId},
        ${documentId}, ${blockId}
      )
      ON CONFLICT (source_document_id, source_block_id) WHERE source_document_id IS NOT NULL
      DO UPDATE SET
        title = EXCLUDED.title,
        event_date = EXCLUDED.event_date,
        start_time = EXCLUDED.start_time,
        duration_minutes = EXCLUDED.duration_minutes,
        updated_at = now()
    `
  }
}
