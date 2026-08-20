import { describe, expect, it } from 'vitest'

import { fetchSearchEmails, parseSearchRequest } from '../../search.js'

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
    expect(query).toContain('GROUP BY m.id, ai.spam_score')
    expect(query).toContain('NOT m.is_deleted')
    expect(query).toContain('m.is_sent')
    expect(query).toContain('AS has_html')
    expect(query).toContain('AS has_attachments')
    expect(query).toContain("'kind', l.kind")
    expect(query).not.toContain('body_text')
  })
})

describe('parseSearchRequest', () => {
  it('uses hybrid retrieval by default and keyword-only mode for type-ahead', () => {
    expect(parseSearchRequest('/api/search?q=%20zoom%20invoice%20')).toEqual({
      query: 'zoom invoice',
      semantic: true,
    })
    expect(parseSearchRequest('/api/search?q=zoom&mode=keyword')).toEqual({
      query: 'zoom',
      semantic: false,
    })
  })
})
