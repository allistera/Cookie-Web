import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

import { describe, expect, it } from 'vitest'

// The claim/ack endpoint itself now lives in Cookie-Worker's
// cookie-web-notifications Worker (with the query-shape tests that used to
// sit here), but the browser_notification_events table and its trigger are
// still created by this repo's migrations — so their invariants stay pinned
// here.
describe('browser notification events migration', () => {
  it('keeps notification tokens private, bounded and isolated from ingestion', () => {
    const migration = readFileSync(
      resolve(process.cwd(), 'migrations/0016_browser_notification_events.sql'),
      'utf8',
    )

    expect(migration).toContain('ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('REVOKE ALL PRIVILEGES')
    expect(migration).toContain("created_at < clock_timestamp() - interval '24 hours'")
    expect(migration).toContain('EXCEPTION WHEN OTHERS')
    expect(migration).toContain(
      "jsonb_build_object('op', TG_OP, 'event_id', notification_event_id)",
    )
    expect(migration).toContain('SET search_path = pg_catalog')
  })
})
