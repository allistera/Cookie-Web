import { describe, expect, it } from 'vitest'

import { compareByPosition, orderAfterDrop, sortByPosition } from '../taskOrder'

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

describe('orderAfterDrop', () => {
  const ids = ['a', 'b', 'c']

  it('places the dragged id before or after the target', () => {
    expect(orderAfterDrop(ids, 'c', 'a', 'before')).toEqual(['c', 'a', 'b'])
    expect(orderAfterDrop(ids, 'a', 'c', 'after')).toEqual(['b', 'c', 'a'])
    expect(orderAfterDrop(ids, 'a', 'b', 'after')).toEqual(['b', 'a', 'c'])
  })

  it('returns null for a drop onto itself or an unknown target', () => {
    expect(orderAfterDrop(ids, 'a', 'a', 'before')).toBe(null)
    expect(orderAfterDrop(ids, 'a', 'zzz', 'after')).toBe(null)
  })
})
