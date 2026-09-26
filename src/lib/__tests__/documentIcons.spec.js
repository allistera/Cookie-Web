import { describe, expect, it } from 'vitest'

import {
  ALL_DOCUMENT_ICONS,
  DOCUMENT_ICON_GROUPS,
  DOCUMENT_ICON_NAMES,
  filterDocumentIcons,
  parseDocumentIcon,
} from '../documentIcons'

describe('document icon catalogue', () => {
  it('parses every entry into an ms: value with a label and keywords', () => {
    expect(ALL_DOCUMENT_ICONS.length).toBeGreaterThanOrEqual(150)
    expect(ALL_DOCUMENT_ICONS.length).toBeLessThanOrEqual(250)
    for (const icon of ALL_DOCUMENT_ICONS) {
      // The Worker accepts only ms:[a-z0-9_]{1,64}.
      expect(icon.name).toMatch(/^[a-z0-9_]{1,64}$/)
      expect(icon.value).toBe(`ms:${icon.name}`)
      expect(icon.label).toBe(icon.name.replaceAll('_', ' '))
      expect(icon.keywords).toContain(icon.label)
    }
  })

  it('lists each icon once across groups', () => {
    expect(new Set(DOCUMENT_ICON_NAMES).size).toBe(DOCUMENT_ICON_NAMES.length)
  })

  it('returns every group for an empty query', () => {
    expect(filterDocumentIcons('')).toBe(DOCUMENT_ICON_GROUPS)
    expect(filterDocumentIcons('   ')).toBe(DOCUMENT_ICON_GROUPS)
  })

  it('matches by label and keyword, case-insensitively, requiring every term', () => {
    const byLabel = filterDocumentIcons('Rocket Launch')[0].items.map((icon) => icon.name)
    expect(byLabel).toEqual(['rocket_launch'])

    const byKeyword = filterDocumentIcons('piggy')[0].items.map((icon) => icon.name)
    expect(byKeyword).toEqual(['savings'])

    const [group] = filterDocumentIcons('zzzz-nothing')
    expect(group.id).toBe('results')
    expect(group.items).toEqual([])
  })
})

describe('parseDocumentIcon', () => {
  it('reads an ms: value as a Material Symbols glyph', () => {
    expect(parseDocumentIcon('ms:rocket_launch')).toEqual({
      symbol: 'rocket_launch',
      label: 'rocket launch',
    })
  })

  it('keeps any other value as emoji text', () => {
    expect(parseDocumentIcon('🔹')).toEqual({ emoji: '🔹' })
    expect(parseDocumentIcon(' 📄 ')).toEqual({ emoji: '📄' })
  })

  it('shows nothing for empty or malformed values instead of raw text', () => {
    expect(parseDocumentIcon('')).toBeNull()
    expect(parseDocumentIcon(null)).toBeNull()
    expect(parseDocumentIcon('ms:')).toBeNull()
    expect(parseDocumentIcon('ms:Rocket Launch')).toBeNull()
    expect(parseDocumentIcon(`ms:${'a'.repeat(65)}`)).toBeNull()
    // A name the bundled font lacks, e.g. one truncated by an older server.
    expect(parseDocumentIcon('ms:check_box_out')).toBeNull()
  })
})
