import { beforeEach, describe, expect, it } from 'vitest'
import {
  CALENDAR_RAIL_LIST_STORAGE_KEY,
  useCalendarRailCalendars,
} from '../useCalendarRailCalendars'

beforeEach(() => {
  localStorage.clear()
  useCalendarRailCalendars().reset()
})

describe('useCalendarRailCalendars', () => {
  it('keeps the calendar list open unless it was folded', () => {
    const list = useCalendarRailCalendars()
    expect(list.isListOpen.value).toBe(true)

    list.toggleList()
    expect(list.isListOpen.value).toBe(false)
    expect(localStorage.getItem(CALENDAR_RAIL_LIST_STORAGE_KEY)).toBe('0')
    list.reset()
    expect(list.isListOpen.value).toBe(false)

    list.toggleList()
    expect(localStorage.getItem(CALENDAR_RAIL_LIST_STORAGE_KEY)).toBeNull()
  })

  it('hides a calendar for this page load only', () => {
    const a = useCalendarRailCalendars()
    const b = useCalendarRailCalendars()
    a.toggleCalendar('work')

    expect(b.isCalendarShown('work')).toBe(false)
    expect(b.isCalendarShown('home')).toBe(true)
    expect(localStorage.length).toBe(0)

    b.toggleCalendar('work')
    expect(a.isCalendarShown('work')).toBe(true)
  })
})
