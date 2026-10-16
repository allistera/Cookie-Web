// Tasks with a due date appear on Cookie Calendar next to that day's events.
// They are laid out through the same event pipeline (date buckets, all-day
// banner, timed lanes) but stay distinguishable: their own pseudo-calendar,
// their own colour, and `kind: 'task'` so the view never treats one as an
// editable event.

import { addDays } from './taskSchedule'

export const TASKS_CALENDAR_ID = 'tasks'
export const TASKS_CALENDAR_NAME = 'Tasks'
export const TASKS_CALENDAR_COLOR = '#5e6ad2'

// Timed tasks use their estimate, or a thirty-minute slot when none is set.
const TIMED_TASK_MINUTES = 30
const WHOLE_DAY_MINUTES = 24 * 60

/**
 * @param {{ id: string, projectId?: string | null, content: string, dueDate: string, dueTime?: string | null, durationMinutes?: number | null, priority?: number | null }} task
 */
export function taskToCalendarItem(task) {
  const timed = Boolean(task.dueTime)
  return {
    id: `task:${task.id}`,
    kind: 'task',
    taskId: task.id,
    // The Tasks app addresses the Inbox by name rather than a null project.
    projectId: task.projectId ?? 'inbox',
    title: task.content,
    date: task.dueDate,
    start: timed ? task.dueTime : '00:00',
    duration: timed ? (task.durationMinutes ?? TIMED_TASK_MINUTES) : WHOLE_DAY_MINUTES,
    allDay: !timed,
    calendar: TASKS_CALENDAR_ID,
    priority: task.priority ?? null,
  }
}

// The calendar positions rows on a single date. Split overnight estimates so
// the next day's lanes show the remaining time, while both pieces open the task.
export function taskToCalendarItems(task) {
  const item = taskToCalendarItem(task)
  if (item.allDay) return [item]
  const [hour, minute] = item.start.split(':').map(Number)
  const untilMidnight = WHOLE_DAY_MINUTES - hour * 60 - minute
  if (item.duration <= untilMidnight) return [item]
  return [
    { ...item, duration: untilMidnight },
    {
      ...item,
      id: `${item.id}:continuation`,
      date: addDays(item.date, 1),
      start: '00:00',
      duration: item.duration - untilMidnight,
    },
  ]
}

// The event cache covers more than the task API's 100-day maximum. Fetch
// adjacent inclusive windows without repeating tasks on their boundaries.
export function taskCalendarWindows(from, to) {
  const windows = []
  for (let start = from; start <= to;) {
    const limit = addDays(start, 100)
    const end = limit < to ? limit : to
    windows.push({ from: start, to: end })
    start = addDays(end, 1)
  }
  return windows
}
