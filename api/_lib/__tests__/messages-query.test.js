import { describe, expect, it } from 'vitest'

import { fetchOwnedMessageBody } from '../../messages.js'

describe('fetchOwnedMessageBody', () => {
  it('returns the saved summary only for a message owned by the caller', () => {
    let query = ''
    let values = []
    const sql = (strings, ...parameters) => {
      query = strings.join('?')
      values = parameters
      return []
    }

    fetchOwnedMessageBody(
      sql,
      '11111111-1111-1111-1111-111111111111',
      'owner@example.com',
    )

    expect(query).toContain('ai.summary')
    expect(query).toContain('LEFT JOIN message_ai ai ON ai.message_id = m.id')
    expect(query).toContain('m.id = ? AND lower(u.email) = ?')
    expect(values).toEqual(['11111111-1111-1111-1111-111111111111', 'owner@example.com'])
  })
})
