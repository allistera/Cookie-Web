// Pure helpers behind the task activity views: the names an event and a
// field are shown under, and the one-line reading of each change the
// panel's Activity tab lists. No store, no DOM.

export const ACTION_LABELS = {
  created: 'Created',
  edited: 'Edited',
  completed: 'Completed',
  reopened: 'Reopened',
  deleted: 'Deleted',
}

export const FIELD_LABELS = {
  content: 'Title',
  description: 'Description',
  project_id: 'Project',
  parent_id: 'Parent task',
  due_date: 'Due date',
  due_time: 'Due time',
  duration_minutes: 'Estimated duration',
  time_zone: 'Time zone',
  labels: 'Labels',
  priority: 'Priority',
  recurrence: 'Repeat',
  position: 'Order',
  today_position: 'Today order',
}

const ORDER_FIELDS = new Set(['position', 'today_position'])

function isEmpty(value) {
  return (
    value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)
  )
}

// The text a before or after value reads as. Ids are resolved through the
// lookups the caller has (projects, loaded tasks); a row that is not there
// any more is named generically rather than by its id.
export function displayValue(value, field, { projectName, taskTitle } = {}) {
  if (field === 'project_id') return value ? projectName?.(value) || 'Another project' : 'Inbox'
  if (field === 'parent_id') return value ? taskTitle?.(value) || 'Another task' : 'None'
  if (isEmpty(value)) return 'None'
  if (Array.isArray(value)) return value.join(', ')
  if (field === 'duration_minutes') return `${value} min`
  if (field === 'priority') return `P${value}`
  return String(value)
}

function quoted(text) {
  return `“${text}”`
}

// One sentence for one changed field: "Title changed from “A” to “B”",
// "Due date set to 2026-10-20", "Labels cleared". A description's text is
// not repeated (it can run to pages); a reorder has no values worth reading.
export function describeChange(field, change, lookups) {
  const label = FIELD_LABELS[field] || field
  if (ORDER_FIELDS.has(field)) return 'Reordered'
  const before = change?.before
  const after = change?.after
  if (field === 'description') {
    if (isEmpty(before)) return 'Description added'
    if (isEmpty(after)) return 'Description cleared'
    return 'Description edited'
  }
  if (field === 'project_id') return `Moved to ${displayValue(after, field, lookups)}`
  const wrap = field === 'content' || field === 'parent_id' ? quoted : (text) => text
  if (isEmpty(before) && !isEmpty(after))
    return `${label} set to ${wrap(displayValue(after, field, lookups))}`
  if (!isEmpty(before) && isEmpty(after)) return `${label} cleared`
  return `${label} changed from ${wrap(displayValue(before, field, lookups))} to ${wrap(
    displayValue(after, field, lookups),
  )}`
}

// Flattens activity rows into the bullets the panel lists: one per event,
// except an edit, which gives one per changed field (a reorder that touched
// both order columns is still one bullet).
export function activityEntries(rows, lookups) {
  const entries = []
  for (const row of rows ?? []) {
    const changes = Object.entries(row.changes ?? {})
    if (row.action !== 'edited' || !changes.length) {
      entries.push({
        id: String(row.id),
        text: ACTION_LABELS[row.action] || String(row.action ?? ''),
        occurredAt: row.occurredAt,
      })
      continue
    }
    let reordered = false
    for (const [field, change] of changes) {
      if (ORDER_FIELDS.has(field)) {
        if (reordered) continue
        reordered = true
      }
      entries.push({
        id: `${row.id}:${field}`,
        text: describeChange(field, change, lookups),
        occurredAt: row.occurredAt,
      })
    }
  }
  return entries
}
