import { describe, expect, it } from 'vitest'

import { FEED_ROUTE, isFeedQuery, isFromToday } from '../theFeed'

describe('The Feed', () => {
  it('is the Newsletters label folder with the today flag', () => {
    expect(isFeedQuery(FEED_ROUTE.query)).toBe(true)
    expect(isFeedQuery({ filter: 'label', label: 'Newsletters' })).toBe(false)
    expect(isFeedQuery({ filter: 'label', label: 'Work', received: 'today' })).toBe(false)
    expect(isFeedQuery({})).toBe(false)
  })

  it("counts mail from the viewer's calendar day only", () => {
    const now = new Date(2026, 10, 16, 14, 30)
    const at = (...parts) => ({ sentAt: new Date(...parts).toISOString() })
    expect(isFromToday(at(2026, 10, 16, 0, 0), now)).toBe(true)
    expect(isFromToday(at(2026, 10, 16, 14, 29), now)).toBe(true)
    expect(isFromToday(at(2026, 10, 15, 23, 59), now)).toBe(false)
    expect(isFromToday(undefined, now)).toBe(false)
  })
})
