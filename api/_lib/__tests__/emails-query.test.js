import { describe, expect, it } from 'vitest'

import { fetchEmails } from '../../emails.js'

function captureQuery() {
  let text = ''
  const sql = (strings) => {
    text = strings.join('?')
    return []
  }
  return { sql, query: () => text }
}

describe('fetchEmails', () => {
  it.each([
    ['first page', null],
    [
      'cursor page',
      { sentAt: '2026-07-13T12:00:00.000Z', id: '11111111-1111-1111-1111-111111111111' },
    ],
  ])('groups joined AI fields for the %s query', (_name, cursor) => {
    const capture = captureQuery()

    fetchEmails(capture.sql, 'owner@example.com', 50, cursor, 'inbox')

    expect(capture.query()).toContain('GROUP BY m.id, ai.spam_score')
  })
})
