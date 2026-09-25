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

  it('offers no Later today in the final minute of the day', () => {
    expect(laterToday(new Date(2026, 6, 14, 23, 58))).toEqual(new Date(2026, 6, 14, 23, 59))
    expect(laterToday(new Date(2026, 6, 14, 23, 59))).toBeNull()
    expect(laterToday(new Date(2026, 6, 14, 23, 59, 30))).toBeNull()
    expect(scheduleChoices(new Date(2026, 6, 14, 23, 59, 30)).map(({ id }) => id)).toEqual([
      'tomorrow',
      'this-weekend',
      'next-week',
    ])
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

// The relative labels collapse onto each other near the weekend, and offering
// the same day twice is what let a reminder be set on top of the send it was
// meant to follow — which the app then refuses with a confusing error.
describe('choices never offer the same day twice', () => {
  const at = (day, hour = 10) => new Date(2026, 7, day, hour, 0)

  it.each([
    ['Sunday', 30],
    ['Monday', 31],
    ['Tuesday', 32],
    ['Wednesday', 33],
    ['Thursday', 34],
    ['Friday', 35],
    ['Saturday', 36],
  ])('gives %s only distinct days', (_name, day) => {
    const days = scheduleChoices(at(day)).map((choice) => choice.date.toDateString())

    expect(new Set(days).size).toBe(days.length)
  })

  // Sunday: "Next Week" is the coming Monday, which is also "Tomorrow".
  it('drops Next Week on a Sunday, where Tomorrow is already that Monday', () => {
    const choices = scheduleChoices(at(30))

    expect(choices.map((c) => c.label)).toEqual(['Later today', 'Tomorrow', 'This weekend'])
    expect(choices.find((c) => c.label === 'Tomorrow').date.getDay()).toBe(1)
  })

  // Friday: "This weekend" is Saturday, which is also "Tomorrow".
  it('drops This weekend on a Friday, where Tomorrow is already Saturday', () => {
    const choices = scheduleChoices(at(35))

    expect(choices.map((c) => c.label)).toEqual(['Later today', 'Tomorrow', 'Next Week'])
    expect(choices.find((c) => c.label === 'Tomorrow').date.getDay()).toBe(6)
  })

  // Saturday after the morning slot: "This weekend" rolls to Sunday, which is
  // also "Tomorrow".
  it('drops This weekend on a Saturday afternoon', () => {
    const choices = scheduleChoices(at(36, 14))

    expect(choices.map((c) => c.label)).toEqual(['Later today', 'Tomorrow', 'Next Week'])
  })

  it('keeps all four on a midweek day', () => {
    expect(scheduleChoices(at(33)).map((c) => c.label)).toEqual([
      'Later today',
      'Tomorrow',
      'This weekend',
      'Next Week',
    ])
  })
})
