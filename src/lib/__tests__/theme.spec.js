import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import {
  applyResolvedTheme,
  getStoredTheme,
  initTheme,
  resolveTheme,
  setTheme,
  THEME_OPTIONS,
} from '../theme.js'

// Stubs matchMedia so 'system' resolution is deterministic.
function stubPrefersDark(isDark) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query) => ({
      matches: query.includes('dark') ? isDark : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  )
}

describe('theme lib', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('exposes exactly the three supported preferences', () => {
    expect(THEME_OPTIONS).toEqual(['light', 'dark', 'system'])
  })

  it('defaults to system when nothing is stored or the value is invalid', () => {
    expect(getStoredTheme()).toBe('system')
    localStorage.setItem('cookie-theme', 'neon')
    expect(getStoredTheme()).toBe('system')
  })

  it('returns explicit preferences unchanged, ignoring the OS', () => {
    stubPrefersDark(true)
    expect(resolveTheme('light')).toBe('light')
    expect(resolveTheme('dark')).toBe('dark')
  })

  it('resolves system against the OS preference', () => {
    stubPrefersDark(true)
    expect(resolveTheme('system')).toBe('dark')
    stubPrefersDark(false)
    expect(resolveTheme('system')).toBe('light')
  })

  it('resolves system to light when matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(resolveTheme('system')).toBe('light')
  })

  it('setTheme persists the preference and applies the resolved theme', () => {
    stubPrefersDark(true)
    setTheme('system')
    expect(localStorage.getItem('cookie-theme')).toBe('system')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')

    setTheme('light')
    expect(localStorage.getItem('cookie-theme')).toBe('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('setTheme falls back to system for an unknown value', () => {
    setTheme('rainbow')
    expect(localStorage.getItem('cookie-theme')).toBe('system')
  })

  it('applyResolvedTheme never writes system to data-theme', () => {
    stubPrefersDark(false)
    applyResolvedTheme('system')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })
})

describe('theme startup and storage failures', () => {
  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('tracks OS changes only while the system preference is selected', () => {
    localStorage.clear()
    const media = { matches: false, addEventListener: vi.fn() }
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => media),
    )
    initTheme()
    expect(document.documentElement.dataset.theme).toBe('light')
    const [event, change] = media.addEventListener.mock.calls[0]
    expect(event).toBe('change')
    media.matches = true
    change()
    expect(document.documentElement.dataset.theme).toBe('dark')
    setTheme('light')
    change()
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('applies a theme even when storage cannot be read or written', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Blocked')
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('matchMedia', undefined)
    expect(getStoredTheme()).toBe('system')
    initTheme()
    expect(document.documentElement.dataset.theme).toBe('light')
    setTheme('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(console.error).toHaveBeenCalledWith(
      'Failed to save theme preference:',
      expect.any(Error),
    )
  })
})
