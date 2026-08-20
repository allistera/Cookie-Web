import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

import { describe, expect, it } from 'vitest'

import { acknowledgeNotificationEvent, claimNotificationEvent } from '../../notification-event.js'

function captureQuery(result = []) {
  let text = ''
  let values = []
  const sql = (strings, ...parameters) => {
    text = strings.join('?')
    values = parameters
    return result
  }
  return { sql, query: () => text, values: () => values }
}

describe('browser notification event queries', () => {
  it('keeps notification tokens private, bounded and isolated from ingestion', () => {
    const migration = readFileSync(
      resolve(process.cwd(), 'migrations/0016_browser_notification_events.sql'),
      'utf8',
    )

    expect(migration).toContain('ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('REVOKE ALL PRIVILEGES')
    expect(migration).toContain("created_at < clock_timestamp() - interval '24 hours'")
    expect(migration).toContain('EXCEPTION WHEN OTHERS')
    expect(migration).toContain("jsonb_build_object('op', TG_OP, 'event_id', notification_event_id)")
    expect(migration).toContain('SET search_path = pg_catalog')
  })

  it('atomically leases only an eligible event owned by the authenticated user', () => {
    const capture = captureQuery()

    claimNotificationEvent(
      capture.sql,
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    )

    expect(capture.query()).toContain('UPDATE browser_notification_events event')
    expect(capture.query()).toContain('event.claimed_until < now()')
    expect(capture.query()).toContain('event.user_id = ?')
    expect(capture.query()).toContain('NOT message.is_deleted')
    expect(capture.query()).toContain("COALESCE(ai.spam_verdict, 'inbox') <> 'spam'")
    expect(capture.query()).toContain('RETURNING event.event_id, event.claim_token')
    expect(capture.values()).toContain('11111111-1111-4111-8111-111111111111')
  })

  it('acknowledges only the matching lease owned by the authenticated user', () => {
    const capture = captureQuery()

    acknowledgeNotificationEvent(
      capture.sql,
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    )

    expect(capture.query()).toContain('DELETE FROM browser_notification_events event')
    expect(capture.query()).toContain('event.claim_token =')
    expect(capture.query()).toContain('event.user_id =')
    expect(capture.values()).toEqual([
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      '11111111-1111-4111-8111-111111111111',
    ])
  })
})
