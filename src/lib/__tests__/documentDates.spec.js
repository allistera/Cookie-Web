import { describe, expect, it } from 'vitest'

import { formatDailyNoteTitle, formatInsertedDate, ordinalDay } from '../documentDates'

describe('ordinalDay', () => {
  it('uses st/nd/rd for 1/2/3 and their tens, th elsewhere', () => {
    expect(ordinalDay(1)).toBe('1st')
    expect(ordinalDay(2)).toBe('2nd')
    expect(ordinalDay(3)).toBe('3rd')
    expect(ordinalDay(4)).toBe('4th')
    expect(ordinalDay(21)).toBe('21st')
    expect(ordinalDay(22)).toBe('22nd')
    expect(ordinalDay(23)).toBe('23rd')
    expect(ordinalDay(31)).toBe('31st')
  })

  it('keeps th for the teens', () => {
    expect(ordinalDay(11)).toBe('11th')
    expect(ordinalDay(12)).toBe('12th')
    expect(ordinalDay(13)).toBe('13th')
  })
})

describe('formatInsertedDate', () => {
  it('renders weekday - ordinal month', () => {
    expect(formatInsertedDate(new Date(2026, 8, 4))).toBe('Friday - 4th September')
    expect(formatInsertedDate(new Date(2026, 0, 1))).toBe('Thursday - 1st January')
    expect(formatInsertedDate(new Date(2026, 7, 13))).toBe('Thursday - 13th August')
  })
})

describe('formatDailyNoteTitle', () => {
  it('renders DD-MM-YY, zero-padded', () => {
    expect(formatDailyNoteTitle(new Date(2026, 7, 13))).toBe('13-08-26')
    expect(formatDailyNoteTitle(new Date(2026, 0, 1))).toBe('01-01-26')
  })
})
