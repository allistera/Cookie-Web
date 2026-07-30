import { describe, it, expect, beforeEach } from 'vitest'

import { getStoredSignature, saveStoredSignature } from '../signature.js'

describe('signature storage', () => {
  beforeEach(() => localStorage.clear())

  it('returns an empty string when nothing is stored', () => {
    expect(getStoredSignature()).toBe('')
  })

  it('round-trips a saved signature', () => {
    saveStoredSignature('<p>Best, <strong>Allister</strong></p>')
    expect(getStoredSignature()).toBe('<p>Best, <strong>Allister</strong></p>')
    expect(localStorage.getItem('cookie-signature-html')).toBe('<p>Best, <strong>Allister</strong></p>')
  })

  it('coerces null/undefined to an empty string', () => {
    saveStoredSignature(null)
    expect(getStoredSignature()).toBe('')
  })

  it('returns the sanitized value it stored, stripping active markup', () => {
    const stored = saveStoredSignature('<p>Best<script>alert(1)</script></p>')

    expect(stored).toBe('<p>Best</p>')
    expect(localStorage.getItem('cookie-signature-html')).toBe('<p>Best</p>')
  })

  it('sanitizes on read, so a value planted directly in localStorage stays inert', () => {
    localStorage.setItem('cookie-signature-html', '<img src=x onerror="alert(1)"><p>Hi</p>')

    const signature = getStoredSignature()

    expect(signature).not.toContain('onerror')
    expect(signature).toContain('<p>Hi</p>')
  })

  it('pins signature links to a disowned new tab', () => {
    const stored = saveStoredSignature('<a href="https://example.com">site</a>')

    expect(stored).toContain('target="_blank"')
    expect(stored).toContain('rel="noopener noreferrer"')
  })
})
