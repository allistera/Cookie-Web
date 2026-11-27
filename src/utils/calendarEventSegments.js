import { addDays } from '../lib/taskSchedule'

const DAY_MINUTES = 24 * 60
// A runaway duration must not turn into thousands of rows.
const MAX_SEGMENTS = 366

// The calendar draws an event on its start date only. One that runs past
// midnight, timed or all-day, is split into a piece per day it covers, as
// tasks are (taskToCalendarItems): the first keeps the event's id and start,
// the rest start at 00:00 under `${id}:${date}`. Every piece carries the whole
// event as `segmentOf`, so opening, moving or editing one acts on the event
// itself.
export function eventDaySegments(event) {
  const [hour, minute] = String(event.start ?? '')
    .split(':')
    .map(Number)
  const total = Number(event.duration)
  let start = event.allDay ? 0 : hour * 60 + minute
  if (!(start + total > DAY_MINUTES)) return [event]
  const segments = []
  let date = event.date
  let remaining = total
  while (remaining > 0 && date && segments.length < MAX_SEGMENTS) {
    const first = segments.length === 0
    const duration = Math.min(remaining, DAY_MINUTES - start)
    segments.push({
      ...event,
      id: first ? event.id : `${event.id}:${date}`,
      date,
      start: first ? event.start : '00:00',
      duration,
      segmentOf: event,
    })
    remaining -= duration
    start = 0
    date = addDays(date, 1)
  }
  return segments
}

// A piece after the first starts at midnight because the event was already
// running, not because it begins then.
export const isContinuationSegment = (event) =>
  Boolean(event.segmentOf) && event.segmentOf.date !== event.date
