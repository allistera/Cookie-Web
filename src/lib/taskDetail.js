import { priorityOf } from './taskPriority'

// Pure helpers behind the task detail panel: who the person is shown as, the
// "Added" stamp, sibling navigation, sub-task ordering and the plain-text
// copy. No store, no DOM.

// "Allister Antosik" reads as "Allister A." in the panel's footer and on
// comments; a single word, or an address an identity provider sends as the
// name, is left as the part before any "@".
export function shortUserName(name) {
  const words = String(name ?? '')
    .split('@')[0]
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (!words.length) return ''
  if (words.length === 1) return words[0]
  return `${words[0]} ${words.at(-1)[0].toUpperCase()}.`
}

export function userInitial(name) {
  const first = String(name ?? '').trim()[0]
  return first ? first.toUpperCase() : '?'
}

const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' })
const DAY_WITH_YEAR = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})
const TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' })

// "16 Oct · 14:11", with the year once the stamp is from another year; ''
// for a stamp that is missing or unreadable.
export function formatAddedStamp(iso, now = new Date()) {
  const date = new Date(iso ?? '')
  if (Number.isNaN(date.getTime())) return ''
  const day = date.getFullYear() === now.getFullYear() ? DAY : DAY_WITH_YEAR
  return `${day.format(date)} · ${TIME.format(date)}`
}

// The tasks the panel's up and down arrows step through: the rows that sit
// beside this one in the loaded list (same parent, dividers skipped), in the
// list's own order.
export function taskSiblings(items, task) {
  if (!task) return []
  const parentId = task.parentId ?? null
  return items.filter((row) => row.kind !== 'divider' && (row.parentId ?? null) === parentId)
}

export const SUBTASK_ORDERS = [
  { value: 'manual', label: 'Manual' },
  { value: 'name', label: 'Name' },
  { value: 'date', label: 'Due date' },
  { value: 'priority', label: 'Priority' },
]

// A stable reordering: rows that compare equal keep the order they came in.
export function sortSubtasks(rows, order) {
  if (order === 'name') {
    return [...rows].sort((a, b) => String(a.content ?? '').localeCompare(String(b.content ?? '')))
  }
  if (order === 'date') {
    const key = (row) => (row.dueDate ? `${row.dueDate} ${row.dueTime ?? '99:99'}` : '￿')
    return [...rows].sort((a, b) => key(a).localeCompare(key(b)))
  }
  if (order === 'priority') return [...rows].sort((a, b) => priorityOf(a) - priorityOf(b))
  return rows
}

// The task as the clipboard gets it from "Copy as text": the title, the
// description as typed, and each sub-task as a checklist line.
export function taskAsText(task, subtasks = []) {
  const lines = [String(task?.content ?? '')]
  const description = String(task?.description ?? '').trim()
  if (description) lines.push('', description)
  if (subtasks.length) {
    lines.push('')
    for (const row of subtasks) lines.push(`- [${row.completedAt ? 'x' : ' '}] ${row.content}`)
  }
  return lines.join('\n')
}
