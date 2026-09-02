import { beforeEach, describe, expect, it } from 'vitest'

import {
  ALL_EMOJI,
  EMOJI_GROUPS,
  RECENT_LIMIT,
  filterEmoji,
  getRecentEmoji,
  rememberRecentEmoji,
} from '../emoji'

describe('emoji catalogue', () => {
  it('parses every entry into a character with a name and keywords', () => {
    expect(ALL_EMOJI.length).toBeGreaterThan(100)
    for (const emoji of ALL_EMOJI) {
      expect(emoji.char).toBeTruthy()
      expect(emoji.char).not.toMatch(/\s/)
      expect(emoji.name).toBeTruthy()
      expect(emoji.keywords).toContain(emoji.name.toLowerCase())
    }
  })

  it('has no duplicate characters across groups', () => {
    const chars = ALL_EMOJI.map((emoji) => emoji.char)
    expect(new Set(chars).size).toBe(chars.length)
  })

  it('returns every group for an empty query', () => {
    expect(filterEmoji('')).toBe(EMOJI_GROUPS)
    expect(filterEmoji('   ')).toBe(EMOJI_GROUPS)
  })

  it('matches by name and by keyword, case-insensitively', () => {
    const byName = filterEmoji('Thumbs Up')[0].items.map((emoji) => emoji.char)
    expect(byName).toContain('👍')

    const byKeyword = filterEmoji('tada')[0].items.map((emoji) => emoji.char)
    expect(byKeyword).toEqual(['🎉'])
  })

  it('requires every term to match', () => {
    const items = filterEmoji('heart green')[0].items.map((emoji) => emoji.char)
    expect(items).toEqual(['💚'])
  })

  it('returns an empty results group when nothing matches', () => {
    const [group] = filterEmoji('zzzz-nothing')
    expect(group.id).toBe('results')
    expect(group.items).toEqual([])
  })
})

describe('recent emoji', () => {
  beforeEach(() => localStorage.clear())

  it('starts empty and remembers the most recent selection first', () => {
    expect(getRecentEmoji()).toEqual([])
    rememberRecentEmoji('👍')
    rememberRecentEmoji('🎉')
    expect(getRecentEmoji().map((emoji) => emoji.char)).toEqual(['🎉', '👍'])
  })

  it('moves a repeated selection to the front without duplicating it', () => {
    rememberRecentEmoji('👍')
    rememberRecentEmoji('🎉')
    rememberRecentEmoji('👍')
    expect(getRecentEmoji().map((emoji) => emoji.char)).toEqual(['👍', '🎉'])
  })

  it('caps the list and ignores unknown characters and corrupt storage', () => {
    for (const emoji of ALL_EMOJI.slice(0, RECENT_LIMIT + 5)) rememberRecentEmoji(emoji.char)
    expect(getRecentEmoji()).toHaveLength(RECENT_LIMIT)

    rememberRecentEmoji('not-an-emoji')
    expect(getRecentEmoji()[0].char).toBe(ALL_EMOJI[RECENT_LIMIT + 4].char)

    localStorage.setItem('cookie.recentEmoji', '{not json')
    expect(getRecentEmoji()).toEqual([])
  })
})
