import { afterEach, describe, expect, it, vi } from 'vitest'
import { appBadgeSupported, clearAppBadge, setAppBadge } from '../appBadge'

function makeNav(overrides = {}) {
  return {
    setAppBadge: vi.fn().mockResolvedValue(undefined),
    clearAppBadge: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('appBadgeSupported', () => {
  it('is true when the Badging API is present', () => {
    expect(appBadgeSupported(makeNav())).toBe(true)
  })

  it('is false without setAppBadge/clearAppBadge', () => {
    expect(appBadgeSupported({})).toBe(false)
    expect(appBadgeSupported({ setAppBadge: vi.fn() })).toBe(false)
  })

  it('is false without a navigator', () => {
    expect(appBadgeSupported(null)).toBe(false)
  })
})

describe('setAppBadge', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sets a positive count', () => {
    const nav = makeNav()
    setAppBadge(3, nav)
    expect(nav.setAppBadge).toHaveBeenCalledWith(3)
    expect(nav.clearAppBadge).not.toHaveBeenCalled()
  })

  it('truncates fractional counts', () => {
    const nav = makeNav()
    setAppBadge(3.7, nav)
    expect(nav.setAppBadge).toHaveBeenCalledWith(3)
  })

  it('clears the badge for zero or negative counts', () => {
    const nav = makeNav()
    setAppBadge(0, nav)
    expect(nav.clearAppBadge).toHaveBeenCalled()
    expect(nav.setAppBadge).not.toHaveBeenCalled()

    setAppBadge(-1, nav)
    expect(nav.clearAppBadge).toHaveBeenCalledTimes(2)
  })

  it('is a no-op when unsupported', () => {
    expect(() => setAppBadge(3, {})).not.toThrow()
  })

  it('logs without throwing when the Badging API rejects', async () => {
    const nav = makeNav({ setAppBadge: vi.fn().mockRejectedValue(new Error('nope')) })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    setAppBadge(3, nav)

    await vi.waitFor(() =>
      expect(console.error).toHaveBeenCalledWith('Failed to update app badge:', expect.any(Error)),
    )
  })
})

describe('clearAppBadge', () => {
  it('clears the badge', () => {
    const nav = makeNav()
    clearAppBadge(nav)
    expect(nav.clearAppBadge).toHaveBeenCalled()
  })

  it('is a no-op when unsupported', () => {
    expect(() => clearAppBadge({})).not.toThrow()
  })
})
