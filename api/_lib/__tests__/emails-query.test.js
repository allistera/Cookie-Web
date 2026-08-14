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

    fetchEmails(capture.sql, '99999999-9999-4999-8999-999999999999', 50, cursor, 'inbox')

    expect(capture.query()).toContain('GROUP BY m.id, ai.spam_score')
    expect(capture.query()).toContain('ai.summary')
    expect(capture.query()).toContain('AS has_ai_summary')
    expect(capture.query()).toContain('m.scheduled_for')
    expect(capture.query()).toContain('m.scheduled_for IS NULL OR m.scheduled_for <= now()')
  })

  it('normalizes double-encoded recipients to a jsonb object, like the contacts view does', () => {
    const capture = captureQuery()

    fetchEmails(capture.sql, '99999999-9999-4999-8999-999999999999', 50, null, 'inbox')

    expect(capture.query()).toContain("jsonb_typeof(m.recipients) = 'string'")
    expect(capture.query()).toContain("(m.recipients #>> '{}')::jsonb")
    expect(capture.query()).toContain('ELSE m.recipients END AS recipients')
  })

  it('does not transfer message bodies in list rows', () => {
    const capture = captureQuery()

    fetchEmails(capture.sql, '99999999-9999-4999-8999-999999999999', 50, null, 'inbox')

    expect(capture.query()).not.toContain('body_text')
  })

  it.each([null, { sentAt: '2026-07-13T12:00:00.000Z', id: '11111111-1111-1111-1111-111111111111' }])(
    'selects only future scheduled messages for the snoozed folder',
    (cursor) => {
      const capture = captureQuery()

      fetchEmails(capture.sql, '99999999-9999-4999-8999-999999999999', 50, cursor, 'snoozed')

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

    fetchEmails(capture.sql, '99999999-9999-4999-8999-999999999999', 50, cursor, 'done')

    expect(capture.query()).toContain("? = 'done' AND m.is_archived")
    expect(capture.query()).toContain('OR (NOT m.is_archived AND (')
    expect(capture.query()).toContain('GROUP BY m.id, ai.spam_score')
  })
})

describe('fetchUnreadCount', () => {
  // A bare aggregate (no GROUP BY) always returns exactly one row even when
  // zero messages match, so unlike the old users-anchored LEFT JOIN version,
  // this can scope directly off messages by the already-known userId and
  // still guarantee a row. is_unread stays in the WHERE, matching the
  // partial index messages_unread_idx; spam exclusion stays in the FILTER
  // since it depends on the joined message_ai row.
  it('excludes spam inside the aggregate filter, not the WHERE clause', () => {
    const capture = captureQuery()

    fetchUnreadCount(capture.sql, '99999999-9999-4999-8999-999999999999')

    expect(capture.query()).toMatch(
      /count\(m\.id\) FILTER \(\s*WHERE COALESCE\(ai\.spam_verdict, 'inbox'\) <> 'spam'\s*\)/,
    )
    expect(capture.query()).toContain('WHERE m.user_id = ? AND m.is_unread')
    const whereOnwards = capture.query().slice(capture.query().indexOf('WHERE m.user_id'))
    expect(whereOnwards).not.toContain('spam')
  })
})
