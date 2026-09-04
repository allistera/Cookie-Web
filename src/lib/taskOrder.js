// List order for the Tasks app. Each task carries a `position` (migration
// 0062) for its project or Inbox list, and a `todayPosition` (0063) for the
// Today list, which spans every project and so needs an order of its own —
// re-arranging a day there must not move a task among its siblings in its
// own project. A drop sends the rows in their new order to the server: a
// list's rows get the position values they already held dealt back out in
// that order, a day's rows are numbered afresh in todayPosition. Sending an
// order rather than a midpoint between neighbours costs one small request
// per drop and can never run out of precision.

// Position first, then creation time and id as stable tiebreaks, the same
// order the server lists a project in.
export function compareByPosition(a, b) {
  const byPosition = (a.position ?? 0) - (b.position ?? 0)
  if (byPosition) return byPosition
  const byCreated = String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''))
  if (byCreated) return byCreated
  return String(a.id).localeCompare(String(b.id))
}

export function sortByPosition(items) {
  return [...items].sort(compareByPosition)
}

// The ids in their new order after `draggedId` is dropped `place` ('before'
// or 'after') the `targetId` row. Null when the target is not in the list.
export function orderAfterDrop(ids, draggedId, targetId, place) {
  if (draggedId === targetId) return null
  const rest = ids.filter((id) => id !== draggedId)
  const index = rest.indexOf(targetId)
  if (index === -1) return null
  const at = place === 'before' ? index : index + 1
  return [...rest.slice(0, at), draggedId, ...rest.slice(at)]
}

// Today's order: due date, then the day's own arrangement (rows never
// arranged there come after those that were), then position.
export function compareByDueThenPosition(a, b) {
  const byDue = String(a.dueDate ?? '9999-12-31').localeCompare(String(b.dueDate ?? '9999-12-31'))
  if (byDue) return byDue
  const aToday = a.todayPosition ?? Number.POSITIVE_INFINITY
  const bToday = b.todayPosition ?? Number.POSITIVE_INFINITY
  if (aToday !== bToday) return aToday < bToday ? -1 : 1
  return compareByPosition(a, b)
}

export function sortForList(items, loadedProject) {
  return [...items].sort(loadedProject === 'today' ? compareByDueThenPosition : compareByPosition)
}

// How far apart two rows that shared a position are pushed; the same step
// the server uses.
export const POSITION_TIE_STEP = 0.001

// The positions `ids` carry after a reorder, keyed by id: the values those
// rows hold now, sorted, any ties pushed apart, dealt out in the new order —
// exactly what the server does, so the optimistic list already shows the
// final state.
export function dealPositions(items, ids) {
  const byId = new Map(items.map((row) => [row.id, row]))
  const rows = ids.map((id) => byId.get(id)).filter(Boolean)
  const slots = [...rows].sort(compareByPosition).map((row) => row.position ?? 0)
  for (let i = 1; i < slots.length; i += 1) {
    if (slots[i] <= slots[i - 1]) slots[i] = slots[i - 1] + POSITION_TIE_STEP
  }
  return new Map(rows.map((row, index) => [row.id, slots[index]]))
}
