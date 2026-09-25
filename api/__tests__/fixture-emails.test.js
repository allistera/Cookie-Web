import { afterEach, describe, expect, it, vi } from 'vitest'

import { fixtureEmails, fixtureSentEmails, fixtureTourDateText } from '../_fixtures/emails.js'

const DAY = 24 * 60 * 60 * 1000

// Calendar days between the email and "today", the way the inbox groups them.
function daysBack(sentAt, now) {
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const sent = new Date(sentAt)
  sent.setHours(0, 0, 0, 0)
  return Math.round((startOfToday - sent) / DAY)
}

function dayGroups(now) {
  vi.setSystemTime(now)
  return [...fixtureEmails(), ...fixtureSentEmails()].map((row) => daysBack(row.sent_at, now))
}

describe('email fixtures', () => {
  afterEach(() => vi.useRealTimers())

  it('keeps every email in the same calendar-day group at any hour', () => {
    vi.useFakeTimers()
    const midday = dayGroups(new Date(2026, 8, 25, 12, 0))
    expect(dayGroups(new Date(2026, 8, 25, 0, 30))).toEqual(midday)
    expect(dayGroups(new Date(2026, 8, 25, 23, 45))).toEqual(midday)
  })

  it('keeps the tour email in Yesterday just after midnight', () => {
    vi.useFakeTimers()
    const now = new Date(2026, 8, 25, 0, 30)
    vi.setSystemTime(now)
    const tour = fixtureEmails().find((row) => row.subject.includes('guided tour'))
    expect(daysBack(tour.sent_at, now)).toBe(1)
  })

  it('names the tour date current at request time, not at import', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 26, 0, 30))
    const tour = fixtureEmails().find((row) => row.subject.includes('guided tour'))
    expect(tour.subject).toBe(`Confirmation: ${fixtureTourDateText()} guided tour`)
    expect(tour.body_text).toContain(`the ${fixtureTourDateText()} guided tour`)
    expect(fixtureTourDateText()).toBe('October 17th')
  })
})
