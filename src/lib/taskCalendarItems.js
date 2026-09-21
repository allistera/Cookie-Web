// Tasks with a due date appear on Cookie Calendar next to that day's events.
// They are laid out through the same event pipeline (date buckets, all-day
// banner, timed lanes) but stay distinguishable: their own pseudo-calendar,
// their own colour, and `kind: 'task'` so the view never treats one as an
// editable event.

export const TASKS_CALENDAR_ID = 'tasks'
export const TASKS_CALENDAR_NAME = 'Tasks'
export const TASKS_CALENDAR_COLOR = '#5e6ad2'

// A timed task takes a short slot so it reads as "at 14:30" rather than
// blocking the afternoon.
const TIMED_TASK_MINUTES = 30
const WHOLE_DAY_MINUTES = 24 * 60

/**
 * @param {{ id: string, projectId?: string | null, content: string, dueDate: string, dueTime?: string | null, priority?: number | null }} task
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
    duration: timed ? TIMED_TASK_MINUTES : WHOLE_DAY_MINUTES,
    allDay: !timed,
    calendar: TASKS_CALENDAR_ID,
    priority: task.priority ?? null,
  }
}
