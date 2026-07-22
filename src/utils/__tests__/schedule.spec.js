import { describe, expect, it } from 'vitest'

import {
  laterToday,
  nextWeekMorning,
  scheduleChoices,
  thisWeekendMorning,
  tomorrowMorning,
} from '../schedule'

describe('schedule choices', () => {
  const tuesday = new Date(2026, 6, 14, 16, 30)

  it('schedules Tomorrow for 8am on the next local day', () => {
    const result = tomorrowMorning(tuesday)

    expect(result.getFullYear()).toBe(2026)
    expect(result.getMonth()).toBe(6)
    expect(result.getDate()).toBe(15)
    expect(result.getHours()).toBe(8)
    expect(result.getMinutes()).toBe(0)
  })

  it('schedules Next Week for 8am on the next Monday', () => {
    const result = nextWeekMorning(tuesday)

    expect(result.getDay()).toBe(1)
    expect(result.getDate()).toBe(20)
    expect(result.getHours()).toBe(8)
  })

  it('schedules Later today three hours from now', () => {
    expect(laterToday(tuesday)).toEqual(new Date(2026, 6, 14, 19, 0))
  })

  it('keeps Later today on the current date late at night', () => {
    expect(laterToday(new Date(2026, 6, 14, 22, 30))).toEqual(new Date(2026, 6, 14, 23, 59))
  })

  it('schedules This weekend for Saturday at 8am', () => {
    expect(thisWeekendMorning(tuesday)).toEqual(new Date(2026, 6, 18, 8, 0))
  })

  it('exposes the richer preset choices', () => {
    expect(scheduleChoices(tuesday).map(({ label }) => label)).toEqual([
      'Later today',
      'Tomorrow',
      'This weekend',
      'Next Week',
    ])
  })
})
