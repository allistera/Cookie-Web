import { describe, expect, it } from 'vitest'

import { assignLanes } from '../calendarLanes'

const item = (id, start, end) => ({ id, start, end })
const lanesById = (items) =>
  Object.fromEntries(assignLanes(items).map(({ id, lane, lanes }) => [id, [lane, lanes]]))

describe('assignLanes', () => {
  it('gives items that do not overlap the whole width, in start order', () => {
    const laidOut = assignLanes([item('late', 600, 660), item('early', 480, 540)])
    expect(laidOut.map(({ id }) => id)).toEqual(['early', 'late'])
    expect(laidOut.map(({ lane, lanes }) => [lane, lanes])).toEqual([
      [0, 1],
      [0, 1],
    ])
  })

  it('treats items that only touch as not overlapping', () => {
    expect(lanesById([item('a', 480, 540), item('b', 540, 600)])).toEqual({
      a: [0, 1],
      b: [0, 1],
    })
  })

  it('puts overlapping items in separate lanes of one group', () => {
    expect(lanesById([item('a', 480, 600), item('b', 540, 660), item('c', 720, 780)])).toEqual({
      a: [0, 2],
      b: [1, 2],
      c: [0, 1],
    })
  })

  it('reuses a lane once the item in it has ended', () => {
    // b and c both overlap a but not each other, so they share the second lane.
    expect(lanesById([item('a', 480, 720), item('b', 480, 540), item('c', 600, 660)])).toEqual({
      a: [0, 2],
      b: [1, 2],
      c: [1, 2],
    })
  })
})
