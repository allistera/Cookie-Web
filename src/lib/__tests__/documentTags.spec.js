import { describe, expect, it } from 'vitest'

import { normalizeDocumentTag } from '../documentTags'

describe('document tags', () => {
  it('normalizes a leading hash, case and whitespace', () => {
    expect(normalizeDocumentTag('  #Project-One  ')).toBe('project-one')
    expect(normalizeDocumentTag('HOME_notes')).toBe('home_notes')
  })

  it('rejects invalid tag characters and non-strings', () => {
    expect(normalizeDocumentTag('two words')).toBeNull()
    expect(normalizeDocumentTag('#')).toBeNull()
    expect(normalizeDocumentTag(['foo'])).toBeNull()
  })
})
