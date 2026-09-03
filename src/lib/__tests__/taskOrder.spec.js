import { describe, expect, it } from 'vitest'

import { compareByPosition, neighboursFor, positionBetween, sortByPosition } from '../taskOrder'

describe('positionBetween', () => {
  it('halves the gap between two neighbours', () => {
    expect(positionBetween({ position: 1 }, { position: 2 })).toBe(1.5)
  })

  it('steps past the last row and before the first', () => {
    expect(positionBetween({ position: 7 }, undefined)).toBe(8)
    expect(positionBetween(undefined, { position: 7 })).toBe(6)
  })

  it('starts an empty list at zero', () => {
    expect(positionBetween(undefined, undefined)).toBe(0)
  })
})

describe('sortByPosition', () => {
  it('orders by position, then creation time, then id, without mutating', () => {
    const items = [
      { id: 'c', position: 2, createdAt: '2026-01-01' },
      { id: 'b', position: 1, createdAt: '2026-01-02' },
      { id: 'a', position: 1, createdAt: '2026-01-01' },
      { id: 'd', position: 1, createdAt: '2026-01-01' },
    ]
    expect(sortByPosition(items).map((row) => row.id)).toEqual(['a', 'd', 'b', 'c'])
    expect(items.map((row) => row.id)).toEqual(['c', 'b', 'a', 'd'])
  })

  it('treats a missing position as zero', () => {
    expect(compareByPosition({ id: 'x' }, { id: 'y', position: 1 })).toBeLessThan(0)
  })
})

describe('neighboursFor', () => {
  const order = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

  it('excludes the dragged row from the neighbours', () => {
    expect(neighboursFor(order, 'a', 'c', 'before')).toEqual({
      prev: { id: 'b' },
      next: { id: 'c' },
    })
    expect(neighboursFor(order, 'c', 'a', 'after')).toEqual({
      prev: { id: 'a' },
      next: { id: 'b' },
    })
  })

  it('has no neighbour past either end', () => {
    expect(neighboursFor(order, 'c', 'a', 'before')).toEqual({ prev: undefined, next: { id: 'a' } })
    expect(neighboursFor(order, 'a', 'c', 'after')).toEqual({ prev: { id: 'c' }, next: undefined })
  })

  it('returns null when the target is not in the list', () => {
    expect(neighboursFor(order, 'a', 'zzz', 'after')).toBe(null)
  })
})
