import { describe, it, expect, beforeEach } from 'vitest'

import { clearLegacySignature, getLegacySignature } from '../signature.js'

describe('signature storage', () => {
  beforeEach(() => localStorage.clear())

  it('returns an empty string when nothing is stored', () => {
    expect(getLegacySignature()).toBe('')
  })

  it('reads old browser data without changing it and removes it only after import', () => {
    localStorage.setItem('cookie-signature-html', '<p>Best<script>alert(1)</script></p>')
    expect(getLegacySignature()).toBe('<p>Best</p>')
    expect(localStorage.getItem('cookie-signature-html')).toContain('<script>')
    clearLegacySignature()
    expect(localStorage.getItem('cookie-signature-html')).toBeNull()
  })

  it('sanitizes on read, so a value planted directly in localStorage stays inert', () => {
    localStorage.setItem('cookie-signature-html', '<img src=x onerror="alert(1)"><p>Hi</p>')

    const signature = getLegacySignature()

    expect(signature).not.toContain('onerror')
    expect(signature).toContain('<p>Hi</p>')
  })

  it('pins signature links to a disowned new tab', () => {
    localStorage.setItem('cookie-signature-html', '<a href="https://example.com">site</a>')
    const stored = getLegacySignature()

    expect(stored).toContain('target="_blank"')
    expect(stored).toContain('rel="noopener noreferrer"')
  })
})
