import { describe, expect, it } from 'vitest'

import {
  fetchInterests,
  saveInterests,
  normalizeInterests,
  MAX_INTERESTS,
  MAX_INTEREST_LENGTH,
} from '../interests.js'

function recordingSql(rows = []) {
  const calls = []
  const sql = (strings, ...values) => {
    calls.push({ text: strings.join('?'), values })
    return Promise.resolve(rows)
  }
  sql.calls = calls
  return sql
}

describe('normalizeInterests', () => {
  it('trims, drops blanks and de-duplicates case-insensitively', () => {
    expect(normalizeInterests([' Vue ', 'vue', '', '   ', 'Postgres'])).toEqual(['Vue', 'Postgres'])
  })

  it('caps the list length', () => {
    const many = Array.from({ length: MAX_INTERESTS + 5 }, (_, i) => `topic-${i}`)
    expect(normalizeInterests(many)).toHaveLength(MAX_INTERESTS)
  })

  it('caps each entry length', () => {
    const [only] = normalizeInterests(['x'.repeat(MAX_INTEREST_LENGTH + 40)])
    expect(only).toHaveLength(MAX_INTEREST_LENGTH)
  })

  it('accepts an empty list, which means "do not personalise"', () => {
    expect(normalizeInterests([])).toEqual([])
  })

  // null signals a malformed payload, which the handler turns into a 400
  // rather than storing an empty list the user never asked for.
  it('returns null for anything that is not a list of strings', () => {
    expect(normalizeInterests(undefined)).toBeNull()
    expect(normalizeInterests('Vue')).toBeNull()
    expect(normalizeInterests(['Vue', 42])).toBeNull()
    expect(normalizeInterests([{ topic: 'Vue' }])).toBeNull()
  })
})

describe('fetchInterests', () => {
  it('reads the interests key out of prefs, defaulting to empty', () => {
    const sql = recordingSql()
    fetchInterests(sql, 'owner@example.com')

    expect(sql.calls[0].text).toContain("prefs -> 'interests'")
    expect(sql.calls[0].text).toContain("'[]'::jsonb")
    expect(sql.calls[0].text).toContain('lower(u.email) =')
    expect(sql.calls[0].values).toEqual(['owner@example.com'])
  })
})

describe('saveInterests', () => {
  it('merges into prefs rather than replacing the whole object', () => {
    const sql = recordingSql([{ interests: ['Vue'] }])
    saveInterests(sql, 'owner@example.com', ['Vue'])

    // The || merge preserves any other settings-modal preferences stored there.
    expect(sql.calls[0].text).toContain('prefs = coalesce(prefs')
    expect(sql.calls[0].text).toContain('||')
    expect(sql.calls[0].values[0]).toBe(JSON.stringify({ interests: ['Vue'] }))
    expect(sql.calls[0].values).toContain('owner@example.com')
  })
})
