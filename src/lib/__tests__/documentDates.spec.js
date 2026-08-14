import { describe, expect, it } from 'vitest'

import {
  formatDailyMonthFolder,
  formatDailyNoteTitle,
  formatDailyYearFolder,
  formatInsertedDate,
  ordinalDay,
  parseDailyNoteDate,
} from '../documentDates'

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

describe('parseDailyNoteDate', () => {
  it('parses DD-MM-YY into the matching date', () => {
    expect(parseDailyNoteDate('13-08-26')).toEqual(new Date(2026, 7, 13))
    expect(parseDailyNoteDate('01-01-26')).toEqual(new Date(2026, 0, 1))
  })

  it('rejects titles that are not exactly that shape', () => {
    expect(parseDailyNoteDate('Project Plan')).toBeNull()
    expect(parseDailyNoteDate('13-8-26')).toBeNull()
    expect(parseDailyNoteDate('2026-08-13')).toBeNull()
    expect(parseDailyNoteDate('')).toBeNull()
    expect(parseDailyNoteDate(undefined)).toBeNull()
  })

  it('rejects a title shaped like a date that does not exist', () => {
    expect(parseDailyNoteDate('31-02-26')).toBeNull()
    expect(parseDailyNoteDate('00-01-26')).toBeNull()
  })
})

describe('formatDailyYearFolder', () => {
  it('renders the four-digit year', () => {
    expect(formatDailyYearFolder(new Date(2026, 7, 13))).toBe('2026')
  })
})

describe('formatDailyMonthFolder', () => {
  it('renders the short month name', () => {
    expect(formatDailyMonthFolder(new Date(2026, 7, 13))).toBe('Aug')
    expect(formatDailyMonthFolder(new Date(2026, 0, 1))).toBe('Jan')
  })
})
