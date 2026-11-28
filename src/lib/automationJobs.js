// The automations that can be set up on Create Automation, and how a schedule
// is written and read. Each job's `handler` is a built-in job of the
// cookie-web-automations Worker (its src/handlers.js); a schedule is that
// Worker's trigger: { type: 'schedule', time: 'HH:MM', days, timeZone }.

export const AUTOMATION_JOBS = [
  {
    handler: 'reschedule_overdue',
    title: 'Reschedule Overdue Tasks to Today',
    description:
      'Moves every overdue task to today. Repeating schedules and times stay as they are, and tasks synced from Todoist are not moved.',
    icon: 'task_alt',
    defaultTime: '00:00',
  },
]

export function automationJob(handler) {
  return AUTOMATION_JOBS.find((job) => job.handler === handler) ?? null
}

// Monday first, as the calendar shows a week.
export const SCHEDULE_DAYS = [
  { id: 'mon', label: 'Mon' },
  { id: 'tue', label: 'Tue' },
  { id: 'wed', label: 'Wed' },
  { id: 'thu', label: 'Thu' },
  { id: 'fri', label: 'Fri' },
  { id: 'sat', label: 'Sat' },
  { id: 'sun', label: 'Sun' },
]

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri']
const WEEKEND = ['sat', 'sun']

// The zone the person is in, which is the one a new schedule keeps time in.
export function localTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

export function scheduleTrigger({ time, days, timeZone = localTimeZone() }) {
  return {
    type: 'schedule',
    time,
    days: SCHEDULE_DAYS.map((day) => day.id).filter((id) => days.includes(id)),
    timeZone,
  }
}

function sameDays(days, expected) {
  return days.length === expected.length && expected.every((id) => days.includes(id))
}

// "Every day at 00:00", "Weekdays at 07:30", "Mon, Wed at 09:00".
export function scheduleLabel(trigger) {
  const days = SCHEDULE_DAYS.filter((day) => (trigger?.days ?? []).includes(day.id))
  const ids = days.map((day) => day.id)
  let when = days.map((day) => day.label).join(', ')
  if (ids.length === SCHEDULE_DAYS.length) when = 'Every day'
  else if (sameDays(ids, WEEKDAYS)) when = 'Weekdays'
  else if (sameDays(ids, WEEKEND)) when = 'Weekends'
  return `${when} at ${trigger?.time ?? ''}`
}

const momentFormat = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

// "Sun 29 Nov, 00:00" in the person's own zone; '' for no time or a bad one.
export function formatMoment(value) {
  const date = new Date(value ?? NaN)
  return Number.isNaN(date.getTime()) ? '' : momentFormat.format(date)
}
