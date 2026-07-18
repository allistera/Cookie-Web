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
})
