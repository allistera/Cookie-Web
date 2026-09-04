import { describe, expect, it } from 'vitest'

import {
  compareByPosition,
  dealPositions,
  orderAfterDrop,
  sortByPosition,
  sortForList,
} from '../taskOrder'

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

describe('dealPositions', () => {
  const items = [
    { id: 'a', position: 10 },
    { id: 'b', position: 20 },
    { id: 'c', position: 30 },
    { id: 'z', position: 5 },
  ]

  it('deals the rows’ own position values out in the new order', () => {
    expect(dealPositions(items, ['c', 'a', 'b'])).toEqual(
      new Map([
        ['c', 10],
        ['a', 20],
        ['b', 30],
      ]),
    )
  })

  it('touches only the rows given, so the rest keep their place', () => {
    const dealt = dealPositions(items, ['b', 'a'])
    expect(dealt).toEqual(
      new Map([
        ['b', 10],
        ['a', 20],
      ]),
    )
    expect(dealt.has('z')).toBe(false)
  })

  it('pushes tied positions apart so every row gets its own', () => {
    const tied = [
      { id: 'a', position: 3, createdAt: '2026-01-01' },
      { id: 'b', position: 3, createdAt: '2026-01-02' },
    ]
    expect(dealPositions(tied, ['b', 'a'])).toEqual(
      new Map([
        ['b', 3],
        ['a', 3.001],
      ]),
    )
  })

  it('skips ids that are not loaded', () => {
    expect(dealPositions(items, ['zzz', 'a'])).toEqual(new Map([['a', 10]]))
  })
})

describe('sortForList', () => {
  const items = [
    { id: 'late', dueDate: '2026-09-05', position: 1 },
    { id: 'early2', dueDate: '2026-09-01', position: 3 },
    { id: 'early1', dueDate: '2026-09-01', position: 2 },
    { id: 'undated', dueDate: null, position: 0 },
  ]

  it('orders Today by due date and then position', () => {
    expect(sortForList(items, 'today').map((row) => row.id)).toEqual([
      'early1',
      'early2',
      'late',
      'undated',
    ])
  })

  it('orders a project by position alone', () => {
    expect(sortForList(items, 'p1').map((row) => row.id)).toEqual([
      'undated',
      'late',
      'early1',
      'early2',
    ])
  })
})
