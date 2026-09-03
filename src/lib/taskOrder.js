// List order for the Tasks app. Each task carries a fractional `position`
// (migration 0062); a drop writes the one row that moved with a value between
// its new neighbours, so the server never renumbers a list.

// Where a row lands between `prev` and `next` (either may be absent at the
// ends of the list). Halving between two neighbours does eventually run out
// of precision, but only after ~50 drops into the very same gap.
export function positionBetween(prev, next) {
  if (prev && next) return (prev.position + next.position) / 2
  if (prev) return prev.position + 1
  if (next) return next.position - 1
  return 0
}

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

// The neighbours a dragged row would have if dropped `place` ('before' or
// 'after') the `target` row, in a list that no longer contains the dragged
// row itself.
export function neighboursFor(order, draggedId, targetId, place) {
  const rows = order.filter((row) => row.id !== draggedId)
  const index = rows.findIndex((row) => row.id === targetId)
  if (index === -1) return null
  return place === 'before'
    ? { prev: rows[index - 1], next: rows[index] }
    : { prev: rows[index], next: rows[index + 1] }
}
