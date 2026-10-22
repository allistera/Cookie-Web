import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearGoogleAuthorization,
  pendingGoogleAuthorization,
  rememberGoogleAuthorization,
} from '../googleCalendarAuth'

describe('Google authorization browser transaction', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-20T12:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('needs a locally started verifier and retains completion across a login reload', () => {
    expect(pendingGoogleAuthorization('c'.repeat(43))).toBeNull()
    rememberGoogleAuthorization('v'.repeat(43))
    expect(pendingGoogleAuthorization()).toBeNull()
    const pending = pendingGoogleAuthorization('c'.repeat(43))
    expect(pending).toMatchObject({ verifier: 'v'.repeat(43), completion: 'c'.repeat(43) })
    expect(pendingGoogleAuthorization()).toEqual(pending)
  })

  it('expires after ten minutes and is cleared on logout', () => {
    rememberGoogleAuthorization('v'.repeat(43))
    vi.advanceTimersByTime(10 * 60 * 1000)
    expect(pendingGoogleAuthorization('c'.repeat(43))).toBeNull()
    rememberGoogleAuthorization('v'.repeat(43))
    clearGoogleAuthorization()
    expect(pendingGoogleAuthorization('c'.repeat(43))).toBeNull()
  })

  it('refuses malformed server values and unavailable browser storage', () => {
    expect(() => rememberGoogleAuthorization('short')).toThrow('Invalid sign-in verifier')
    const blocked = {
      getItem() {
        throw new Error('blocked')
      },
      setItem() {
        throw new Error('blocked')
      },
      removeItem() {
        throw new Error('blocked')
      },
    }
    expect(pendingGoogleAuthorization('c'.repeat(43), blocked)).toBeNull()
    expect(() => rememberGoogleAuthorization('v'.repeat(43), blocked)).toThrow('blocked')
    expect(() => clearGoogleAuthorization(blocked)).not.toThrow()
  })

  it.each([
    { verifier: 'short', startedAt: Date.parse('2026-10-20T12:00:00Z') },
    { verifier: 'v'.repeat(43), startedAt: 'not a timestamp' },
    { verifier: 'v'.repeat(43), startedAt: Date.parse('2026-10-20T12:00:01Z') },
  ])('clears an invalid stored transaction: %j', (pending) => {
    sessionStorage.setItem('cookie.google-authorization', JSON.stringify(pending))
    expect(pendingGoogleAuthorization('c'.repeat(43))).toBeNull()
    expect(sessionStorage.getItem('cookie.google-authorization')).toBeNull()
  })

  it('ignores malformed JSON in stored transactions', () => {
    sessionStorage.setItem('cookie.google-authorization', '{broken')
    expect(pendingGoogleAuthorization('c'.repeat(43))).toBeNull()
  })

  it('rejects a malformed completion without replacing an existing valid completion', () => {
    rememberGoogleAuthorization('v'.repeat(43))
    const pending = pendingGoogleAuthorization('c'.repeat(43))
    expect(pendingGoogleAuthorization('short')).toBeNull()
    expect(pendingGoogleAuthorization()).toEqual(pending)
  })

  it('accepts a completion immediately before expiry', () => {
    rememberGoogleAuthorization('v'.repeat(43))
    vi.advanceTimersByTime(10 * 60 * 1000 - 1)
    expect(pendingGoogleAuthorization('c'.repeat(43))).toMatchObject({
      verifier: 'v'.repeat(43),
      completion: 'c'.repeat(43),
    })
  })
})
