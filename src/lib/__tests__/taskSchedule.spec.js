import { describe, expect, it } from 'vitest'

import {
  addDays,
  dateFromIso,
  describeDueDate,
  formatDay,
  monthGrid,
  monthsFrom,
  parseDateInput,
  scheduleShortcuts,
  scheduleSummary,
  toIso,
} from '../taskSchedule'

const TODAY = '2026-10-16' // a Friday

describe('dates', () => {
  it('reads and writes local calendar days', () => {
    expect(toIso(dateFromIso('2026-10-16'))).toBe('2026-10-16')
    expect(dateFromIso('2026-02-30')).toBeNull()
    expect(dateFromIso('16/10/2026')).toBeNull()
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(addDays('nope', 1)).toBeNull()
  })

  it('names a day with its weekday, and the year only when it differs', () => {
    expect(formatDay('2026-10-24', TODAY)).toBe('Sat 24 Oct')
    expect(formatDay('2027-01-04', TODAY)).toBe('Mon 4 Jan 2027')
    expect(formatDay('', TODAY)).toBe('')
  })

  it('reads a due date relative to today on the chip', () => {
    expect(describeDueDate(null, TODAY)).toBe('No date')
    expect(describeDueDate(TODAY, TODAY)).toBe('Today')
    expect(describeDueDate('2026-10-17', TODAY)).toBe('Tomorrow')
    expect(describeDueDate('2026-10-15', TODAY)).toBe('Yesterday')
    expect(describeDueDate('2026-10-24', TODAY)).toBe('Sat 24 Oct')
    expect(scheduleSummary({ dueDate: TODAY, dueTime: '15:00' }, TODAY)).toBe('Today · 15:00')
    expect(scheduleSummary({ dueDate: null, dueTime: '15:00' }, TODAY)).toBe('No date')
  })
})

describe('scheduleShortcuts', () => {
  it('offers today, tomorrow, next Monday and next Saturday', () => {
    expect(scheduleShortcuts(TODAY)).toEqual([
      { id: 'today', label: 'Today', iso: TODAY, hint: 'Fri', icon: 'today' },
      { id: 'tomorrow', label: 'Tomorrow', iso: '2026-10-17', hint: 'Sat', icon: 'light_mode' },
      {
        id: 'next-week',
        label: 'Next week',
        iso: '2026-10-19',
        hint: 'Mon 19 Oct',
        icon: 'arrow_forward',
      },
      {
        id: 'next-weekend',
        label: 'Next weekend',
        iso: '2026-10-24',
        hint: 'Sat 24 Oct',
        icon: 'event_available',
      },
    ])
  })

  it('counts next week from the coming Monday even on a Monday or Sunday', () => {
    expect(scheduleShortcuts('2026-10-19').find((item) => item.id === 'next-week').iso).toBe(
      '2026-10-26',
    )
    expect(scheduleShortcuts('2026-10-18').find((item) => item.id === 'next-week').iso).toBe(
      '2026-10-19',
    )
  })
})

describe('monthGrid', () => {
  it('lays a month out in Monday-first weeks', () => {
    const grid = monthGrid(2026, 10)

    expect(grid.label).toBe('Oct 2026')
    expect(grid.weeks).toHaveLength(5)
    expect(grid.weeks[0]).toEqual([
      null,
      null,
      null,
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ])
    expect(grid.weeks[4].slice(4)).toEqual(['2026-10-30', '2026-10-31', null])
  })

  it('runs months on from a day, across a year end', () => {
    expect(monthsFrom('2026-11-20', 3).map((month) => month.label)).toEqual([
      'Nov 2026',
      'Dec 2026',
      'Jan 2027',
    ])
  })
})

describe('parseDateInput', () => {
  it('reads the words, ISO and day-month forms', () => {
    expect(parseDateInput('', TODAY)).toEqual({ iso: null })
    expect(parseDateInput(' Today ', TODAY)).toEqual({ iso: TODAY })
    expect(parseDateInput('tomorrow', TODAY)).toEqual({ iso: '2026-10-17' })
    expect(parseDateInput('next week', TODAY)).toEqual({ iso: '2026-10-19' })
    expect(parseDateInput('2026-09-01', TODAY)).toEqual({ iso: '2026-09-01' })
    expect(parseDateInput('24 Oct', TODAY)).toEqual({ iso: '2026-10-24' })
    expect(parseDateInput('Oct 24', TODAY)).toEqual({ iso: '2026-10-24' })
    expect(parseDateInput('4 January 2027', TODAY)).toEqual({ iso: '2027-01-04' })
    expect(parseDateInput('4 Jan, 2027', TODAY)).toEqual({ iso: '2027-01-04' })
  })

  // A day already gone this year means the next one.
  it('takes a bare day-month as the next such day', () => {
    expect(parseDateInput('16 Oct', TODAY)).toEqual({ iso: TODAY })
    expect(parseDateInput('1 Oct', TODAY)).toEqual({ iso: '2027-10-01' })
    expect(parseDateInput('29 Feb', '2027-01-01')).toEqual({ iso: '2028-02-29' })
    expect(parseDateInput('29 Feb', '2028-03-01')).toEqual({ iso: '2032-02-29' })
    expect(parseDateInput('29 feb', '2029-01-01')).toEqual({ iso: '2032-02-29' })
    expect(parseDateInput('31 Feb', '2026-10-16')).toBeNull()
  })

  it('refuses what it cannot read', () => {
    expect(parseDateInput('soon', TODAY)).toBeNull()
    expect(parseDateInput('32 Oct', TODAY)).toBeNull()
    expect(parseDateInput('2026-02-30', TODAY)).toBeNull()
    expect(parseDateInput('24 Oct 26', TODAY)).toBeNull()
    expect(parseDateInput('24 Oct 2026 extra', TODAY)).toBeNull()
  })
})
