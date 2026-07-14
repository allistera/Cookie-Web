import { describe, expect, it } from 'vitest'

import { nextWeekMorning, scheduleChoices, tomorrowMorning } from '../schedule'

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

  it('exposes only the two requested choices', () => {
    expect(scheduleChoices(tuesday).map(({ label }) => label)).toEqual(['Tomorrow', 'Next Week'])
  })
})
