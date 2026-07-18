import { describe, expect, it } from 'vitest'

import { parseRecipients } from '../send.js'

describe('parseRecipients', () => {
  it('parses a comma-separated to field into trimmed addresses', () => {
    expect(parseRecipients('a@b.com, c@d.com')).toEqual(['a@b.com', 'c@d.com'])
    expect(parseRecipients(' a@b.com ')).toEqual(['a@b.com'])
    expect(parseRecipients('a@b.com,,c@d.com,')).toEqual(['a@b.com', 'c@d.com'])
  })

  it('returns an empty list for non-strings or blank input', () => {
    expect(parseRecipients('')).toEqual([])
    expect(parseRecipients(undefined)).toEqual([])
    expect(parseRecipients(null)).toEqual([])
    expect(parseRecipients(42)).toEqual([])
  })
})
