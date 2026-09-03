// List order for the Tasks app. Each task carries a `position` (migration
// 0062); a drop sends the whole visible order to the server, which numbers
// the rows 1..n in one statement. Sending the full order rather than a
// midpoint between neighbours costs one small request per drop and can never
// run out of precision.

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
