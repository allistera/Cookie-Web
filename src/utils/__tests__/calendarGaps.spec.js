import { describe, expect, it } from 'vitest'

import { gapLabel, gapsBetween } from '../calendarGaps'

const item = (start, end) => ({ start, end })

describe('gapsBetween', () => {
  it('finds the free time between items, whatever order they come in', () => {
    expect(gapsBetween([item(840, 900), item(540, 570), item(660, 720)])).toEqual([
      { start: 570, end: 660 },
      { start: 720, end: 840 },
    ])
  })

  it('counts items that overlap or touch as one busy stretch', () => {
    expect(gapsBetween([item(540, 660), item(600, 630), item(660, 720), item(780, 840)])).toEqual([
      { start: 720, end: 780 },
    ])
  })

  it('has no gap before the first item, after the last, or on an empty day', () => {
    expect(gapsBetween([item(600, 660)])).toEqual([])
    expect(gapsBetween([])).toEqual([])
  })
})

describe('gapLabel', () => {
  it('names whole hours and any minutes left over', () => {
    expect(gapLabel(60)).toBe('1hr')
    expect(gapLabel(300)).toBe('5hrs')
    expect(gapLabel(90)).toBe('1hr 30m')
    expect(gapLabel(165)).toBe('2hrs 45m')
  })
})
