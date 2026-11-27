import { isSomeday } from './taskSomeday'

// Pure helpers for the tasks rail (components/TasksRail.vue). Dates are
// plain YYYY-MM-DD strings and are named from their own parts, never through
// Intl: short month and weekday names differ between ICU versions.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function dayAndMonth(iso) {
  const [, month, day] = iso.split('-')
  return `${Number(day)} ${MONTHS[Number(month) - 1]}`
}

// '2026-11-27' reads 'Fri 27 Nov'.
export function railDayLabel(iso) {
  const [year, month, day] = iso.split('-').map(Number)
  return `${WEEKDAYS[new Date(year, month - 1, day).getDay()]} ${dayAndMonth(iso)}`
}

// The rows the rail lists: open top-level tasks. A page of the Today list
// also carries sub-tasks and a project's dividers, which belong to the Tasks
// view.
const isListed = (item) => item.kind !== 'divider' && !item.parentId && !item.completedAt

export function todayRailTasks(items) {
  return items.filter(isListed)
}

// Inbox tasks already due sit under Today, so Inbox leaves them out.
export function inboxRailTasks(items, today) {
  return items.filter((item) => isListed(item) && !(item.dueDate && item.dueDate <= today))
}

// What a row says about when it is due. A task due today names only its
// time, a late one says so with its day, a later one names its day, and
// Someday names nothing.
export function railDue(item, today) {
  const date = item.dueDate && !isSomeday(item.dueDate) ? item.dueDate : null
  const overdue = Boolean(date) && date < today
  const parts = []
  if (overdue) parts.push('Overdue')
  if (date && date !== today) parts.push(dayAndMonth(date))
  if (item.dueTime) parts.push(item.dueTime)
  return { text: parts.join(' · '), overdue }
}
