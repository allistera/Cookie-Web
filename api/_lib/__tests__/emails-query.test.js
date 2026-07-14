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
    expect(capture.query()).toContain('m.scheduled_for')
    expect(capture.query()).toContain('m.scheduled_for IS NULL OR m.scheduled_for <= now()')
  })

  it.each([null, { sentAt: '2026-07-13T12:00:00.000Z', id: '11111111-1111-1111-1111-111111111111' }])(
    'selects only future scheduled messages for the snoozed folder',
    (cursor) => {
      const capture = captureQuery()

      fetchEmails(capture.sql, 'owner@example.com', 50, cursor, 'snoozed')

      expect(capture.query()).toContain("? = 'snoozed'")
      expect(capture.query()).toContain('m.scheduled_for > now()')
      expect(capture.query()).toContain('GROUP BY m.id, ai.spam_score')
    },
  )

  it.each([
    ['first page', null],
    [
      'cursor page',
      { sentAt: '2026-07-13T12:00:00.000Z', id: '11111111-1111-1111-1111-111111111111' },
    ],
  ])('selects archived messages for the Done %s query', (_name, cursor) => {
    const capture = captureQuery()

    fetchEmails(capture.sql, 'owner@example.com', 50, cursor, 'done')

    expect(capture.query()).toContain("? = 'done' AND m.is_archived")
    expect(capture.query()).toContain('OR (NOT m.is_archived AND (')
    expect(capture.query()).toContain('GROUP BY m.id, ai.spam_score')
  })
})
