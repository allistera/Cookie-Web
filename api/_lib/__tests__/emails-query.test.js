import { describe, expect, it } from 'vitest'

import { fetchEmails, fetchUnreadCount } from '../../emails.js'

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
    expect(capture.query()).toContain('ai.summary')
    expect(capture.query()).toContain('AS has_ai_summary')
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

describe('fetchUnreadCount', () => {
  // As a WHERE predicate the spam test drops the joined message rows *and*,
  // when every candidate message is spam, the user's own row along with them —
  // leaving the handler to report userId: null, so the client never subscribes
  // to its Realtime inbox channel. It has to live in the aggregate's FILTER.
  it('excludes spam inside the aggregate filter, not the WHERE clause', () => {
    const capture = captureQuery()

    fetchUnreadCount(capture.sql, 'owner@example.com')

    expect(capture.query()).toMatch(
      /count\(m\.id\) FILTER \(\s*WHERE m\.is_unread AND COALESCE\(ai\.spam_verdict, 'inbox'\) <> 'spam'\s*\)/,
    )
    const whereOnwards = capture.query().slice(capture.query().indexOf('WHERE lower(u.email)'))
    expect(whereOnwards).not.toContain('spam')
    expect(whereOnwards).toContain('GROUP BY u.id')
  })
})
