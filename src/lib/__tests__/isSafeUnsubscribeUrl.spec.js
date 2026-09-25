import { describe, expect, it } from 'vitest'

import { isSafeUnsubscribeUrl } from '../isSafeUnsubscribeUrl'

describe('isSafeUnsubscribeUrl', () => {
  it('accepts a public HTTPS URL', () => {
    expect(isSafeUnsubscribeUrl('https://example.com/unsubscribe?u=1')).toBe(true)
    expect(isSafeUnsubscribeUrl('https://example.com./unsubscribe')).toBe(true)
  })

  it('rejects non-HTTPS, credentials, ports and IP literals', () => {
    expect(isSafeUnsubscribeUrl('http://example.com/')).toBe(false)
    expect(isSafeUnsubscribeUrl('https://user:pw@example.com/')).toBe(false)
    expect(isSafeUnsubscribeUrl('https://example.com:8443/')).toBe(false)
    expect(isSafeUnsubscribeUrl('https://127.0.0.1/')).toBe(false)
    expect(isSafeUnsubscribeUrl('https://[::1]/')).toBe(false)
  })

  it('rejects internal hostnames', () => {
    expect(isSafeUnsubscribeUrl('https://localhost/')).toBe(false)
    expect(isSafeUnsubscribeUrl('https://printer.local/')).toBe(false)
    expect(isSafeUnsubscribeUrl('https://router.home.arpa/')).toBe(false)
  })

  // A trailing dot names the same host, so it must not slip past the checks.
  it('rejects internal hostnames written with a trailing dot', () => {
    expect(isSafeUnsubscribeUrl('https://localhost./')).toBe(false)
    expect(isSafeUnsubscribeUrl('https://printer.local./')).toBe(false)
    expect(isSafeUnsubscribeUrl('https://api.internal../')).toBe(false)
    expect(isSafeUnsubscribeUrl('https://router.home.arpa./')).toBe(false)
  })
})
