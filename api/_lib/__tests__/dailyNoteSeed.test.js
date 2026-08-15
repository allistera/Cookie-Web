import { describe, expect, it } from 'vitest'

import { fetchDailyNoteSeed, saveDailyNoteSeed } from '../dailyNoteSeed.js'

function recordingSql(rows = []) {
  const calls = []
  const sql = (strings, ...values) => {
    calls.push({ text: strings.join('?'), values })
    return Promise.resolve(rows)
  }
  sql.calls = calls
  // Mirrors postgres.js's sql.json: marks a value to be sent as a real jsonb
  // parameter instead of pre-stringifying it into a jsonb string scalar.
  sql.json = (value) => ({ __pgJson: value })
  return sql
}

const USER_ID = '99999999-9999-9999-9999-999999999999'
const BLOCKS = [{ type: 'header', data: { text: 'Standup', level: 2 } }]

describe('fetchDailyNoteSeed', () => {
  it('reads the dailyNoteSeed key out of prefs, defaulting to empty', () => {
    const sql = recordingSql()
    fetchDailyNoteSeed(sql, USER_ID)

    expect(sql.calls[0].text).toContain("prefs -> 'dailyNoteSeed'")
    expect(sql.calls[0].text).toContain("'[]'::jsonb")
    expect(sql.calls[0].text).toContain('u.id =')
    expect(sql.calls[0].values).toEqual([USER_ID])
  })
})

describe('saveDailyNoteSeed', () => {
  it('merges into prefs rather than replacing the whole object', () => {
    const sql = recordingSql([{ blocks: BLOCKS }])
    saveDailyNoteSeed(sql, USER_ID, BLOCKS)

    // The || merge preserves any other settings-modal preferences stored there.
    expect(sql.calls[0].text).toContain('prefs = coalesce(prefs')
    expect(sql.calls[0].text).toContain('||')
    // Must go through sql.json (a real jsonb parameter), not a manually
    // JSON.stringify'd string cast with ::jsonb - see saveDailyNoteSeed's comment.
    expect(sql.calls[0].values[0]).toEqual({ __pgJson: { dailyNoteSeed: BLOCKS } })
    expect(sql.calls[0].values).toContain(USER_ID)
  })

  it('accepts an empty array, which means "use the built-in default"', () => {
    const sql = recordingSql([{ blocks: [] }])
    saveDailyNoteSeed(sql, USER_ID, [])

    expect(sql.calls[0].values[0]).toEqual({ __pgJson: { dailyNoteSeed: [] } })
  })
})
