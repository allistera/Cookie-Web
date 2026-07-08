import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { allowRequest } from '../rate-limit.js'

describe('allowRequest', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows up to the limit inside a window, then rejects', () => {
    vi.setSystemTime(1_000_000)
    const opts = { limit: 3, windowMs: 60_000 }
    expect(allowRequest('u1-window', opts)).toBe(true)
    expect(allowRequest('u1-window', opts)).toBe(true)
    expect(allowRequest('u1-window', opts)).toBe(true)
    expect(allowRequest('u1-window', opts)).toBe(false)
  })

  it('resets after the window elapses', () => {
    vi.setSystemTime(2_000_000)
    const opts = { limit: 1, windowMs: 60_000 }
    expect(allowRequest('u1-reset', opts)).toBe(true)
    expect(allowRequest('u1-reset', opts)).toBe(false)
    vi.setSystemTime(2_000_000 + 60_000)
    expect(allowRequest('u1-reset', opts)).toBe(true)
  })

  it('tracks keys independently', () => {
    vi.setSystemTime(3_000_000)
    const opts = { limit: 1, windowMs: 60_000 }
    expect(allowRequest('u1-keys', opts)).toBe(true)
    expect(allowRequest('u2-keys', opts)).toBe(true)
    expect(allowRequest('u1-keys', opts)).toBe(false)
  })
})
