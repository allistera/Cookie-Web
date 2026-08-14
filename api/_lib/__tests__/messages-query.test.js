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
      '99999999-9999-4999-8999-999999999999',
    )

    expect(query).toContain('ai.summary')
    expect(query).toContain('LEFT JOIN message_ai ai ON ai.message_id = m.id')
    expect(query).toContain('m.id = ? AND m.user_id = ?')
    expect(values).toEqual([
      '11111111-1111-1111-1111-111111111111',
      '99999999-9999-4999-8999-999999999999',
    ])
  })
})
