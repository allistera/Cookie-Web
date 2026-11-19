import { beforeEach, describe, expect, it } from 'vitest'
import {
  CALENDAR_RAIL_LIST_STORAGE_KEY,
  CALENDAR_RAIL_STORAGE_KEY,
  useCalendarRail,
} from '../useCalendarRail'

beforeEach(() => {
  localStorage.clear()
  useCalendarRail().reset()
})

describe('useCalendarRail', () => {
  it('is closed by default', () => {
    expect(useCalendarRail().isOpen.value).toBe(false)
  })

  it('shares one state and remembers it in this browser', () => {
    const a = useCalendarRail()
    const b = useCalendarRail()
    a.toggle()

    expect(b.isOpen.value).toBe(true)
    expect(localStorage.getItem(CALENDAR_RAIL_STORAGE_KEY)).toBe('1')

    b.setOpen(false)
    expect(a.isOpen.value).toBe(false)
    expect(localStorage.getItem(CALENDAR_RAIL_STORAGE_KEY)).toBeNull()
  })

  it('restores an open rail on the next load', () => {
    localStorage.setItem(CALENDAR_RAIL_STORAGE_KEY, '1')
    const rail = useCalendarRail()
    rail.reset()
    expect(rail.isOpen.value).toBe(true)
  })

  it('keeps the calendar list open unless it was folded', () => {
    const rail = useCalendarRail()
    expect(rail.isListOpen.value).toBe(true)

    rail.toggleList()
    expect(rail.isListOpen.value).toBe(false)
    expect(localStorage.getItem(CALENDAR_RAIL_LIST_STORAGE_KEY)).toBe('0')
    rail.reset()
    expect(rail.isListOpen.value).toBe(false)

    rail.toggleList()
    expect(localStorage.getItem(CALENDAR_RAIL_LIST_STORAGE_KEY)).toBeNull()
  })

  it('hides a calendar for this page load only', () => {
    const a = useCalendarRail()
    const b = useCalendarRail()
    a.toggleCalendar('work')

    expect(b.isCalendarShown('work')).toBe(false)
    expect(b.isCalendarShown('home')).toBe(true)
    expect(localStorage.length).toBe(0)

    b.toggleCalendar('work')
    expect(a.isCalendarShown('work')).toBe(true)
  })
})
