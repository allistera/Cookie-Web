import { describe, expect, it } from 'vitest'

import { DEFAULT_LABEL_COLOR, LABEL_PALETTE } from '../labelPalette'
import { labelChipStyle, normalizeLabelName } from '../taskLabels'

describe('normalizeLabelName', () => {
  it('lowercases, trims and drops a leading @', () => {
    expect(normalizeLabelName('  @Home ')).toBe('home')
  })

  it('returns an empty string for anything the server would refuse', () => {
    expect(normalizeLabelName('two words')).toBe('')
    expect(normalizeLabelName('#tag')).toBe('')
    expect(normalizeLabelName('a@b')).toBe('')
    expect(normalizeLabelName('')).toBe('')
    expect(normalizeLabelName(null)).toBe('')
    expect(normalizeLabelName('x'.repeat(41))).toBe('')
  })
})

describe('labelChipStyle', () => {
  it('tints the background from the text colour', () => {
    expect(labelChipStyle('#1a73e8')).toEqual({ color: '#1a73e8', backgroundColor: '#1a73e81f' })
  })

  it('falls back to the default colour', () => {
    expect(labelChipStyle(undefined).color).toBe(DEFAULT_LABEL_COLOR)
  })
})

describe('LABEL_PALETTE', () => {
  it('ends with the default colour so a new label always has a swatch', () => {
    expect(LABEL_PALETTE.at(-1)).toBe(DEFAULT_LABEL_COLOR)
    expect(LABEL_PALETTE).toHaveLength(8)
  })
})
