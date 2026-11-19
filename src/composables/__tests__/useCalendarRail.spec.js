import { beforeEach, describe, expect, it } from 'vitest'
import { CALENDAR_RAIL_STORAGE_KEY, useCalendarRail } from '../useCalendarRail'

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
})
