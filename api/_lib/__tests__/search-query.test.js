import { describe, expect, it } from 'vitest'

import { fetchSearchEmails } from '../../search.js'

describe('fetchSearchEmails', () => {
  it('returns AI summary presence for search-result lists without returning the summary text', () => {
    let query = ''
    const sql = (strings) => {
      query = strings.join('?')
      return []
    }

    fetchSearchEmails(sql, 'owner@example.com', ['11111111-1111-1111-1111-111111111111'])

    expect(query).toContain("BOOL_OR(NULLIF(BTRIM(ai.summary), '') IS NOT NULL)")
    expect(query).toContain('AS has_ai_summary')
    expect(query).toContain('LEFT JOIN message_ai ai ON ai.message_id = m.id')
    expect(query).toContain('GROUP BY m.id')
    expect(query).not.toContain('body_text')
  })
})
