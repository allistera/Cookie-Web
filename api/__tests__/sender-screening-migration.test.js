// @vitest-environment node
import { readFile } from 'node:fs/promises'
import process from 'node:process'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const databaseUrl = process.env.SCREENING_TEST_DATABASE_URL
if (process.env.CI && !databaseUrl)
  throw new Error(
    'CI must provide the disposable screening database; migration coverage may not be skipped',
  )
// Only the disposable, specifically named loopback CI database may run this
// fixture. Never reuse DATABASE_URL or a configured Supabase connection.
if (databaseUrl) {
  const url = new URL(databaseUrl)
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.pathname !== '/cookie_screening_test'
  )
    throw new Error(
      'Screening migration tests require the isolated localhost cookie_screening_test database',
    )
}
const OWNER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const THREAD = '33333333-3333-4333-8333-333333333333'
const OTHER_THREAD = '44444444-4444-4444-8444-444444444444'

describe.skipIf(!databaseUrl)('0083 sender screening on PostgreSQL', () => {
  let sql
  beforeAll(async () => {
    sql = postgres(databaseUrl, { max: 2 })
    // Minimum pre-0083 public contract. Read and execute the shipped migration,
    // not a JavaScript imitation of its trigger/notification behavior.
    await sql.unsafe(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE public.users (id uuid PRIMARY KEY, prefs jsonb NOT NULL DEFAULT '{}');
      CREATE TABLE public.threads (id uuid PRIMARY KEY, user_id uuid REFERENCES public.users(id), is_muted boolean NOT NULL DEFAULT false);
      CREATE TABLE public.messages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.users(id),
        thread_id uuid NOT NULL REFERENCES public.threads(id), from_address text NOT NULL,
        message_id text, is_sent boolean NOT NULL DEFAULT false, is_deleted boolean NOT NULL DEFAULT false,
        is_unread boolean NOT NULL DEFAULT true, is_archived boolean NOT NULL DEFAULT false,
        sent_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(), search_indexed_at timestamptz
      );
      CREATE UNIQUE INDEX messages_message_id_owner_idx ON public.messages(user_id, message_id) WHERE message_id IS NOT NULL;
      CREATE TABLE public.message_ai (message_id uuid PRIMARY KEY REFERENCES public.messages(id), spam_verdict text);
      CREATE TABLE public.browser_notification_events (event_id uuid DEFAULT gen_random_uuid(), user_id uuid, message_id uuid);
      CREATE TABLE public.ntfy_subscriptions (user_id uuid PRIMARY KEY, enabled boolean);
      CREATE TABLE public.ntfy_notification_events (user_id uuid, message_id uuid UNIQUE);
      CREATE SCHEMA realtime;
      CREATE TABLE realtime.pings (payload jsonb);
      CREATE FUNCTION realtime.send(jsonb, text, text, boolean) RETURNS void LANGUAGE sql AS
        'INSERT INTO realtime.pings (payload) VALUES ($1)';
    `)
    await sql.unsafe(
      await readFile(
        new URL('../../migrations/0080_quiet_inbox_ping.sql', import.meta.url),
        'utf8',
      ),
    )
    await sql.unsafe(`CREATE TRIGGER messages_notify AFTER INSERT OR UPDATE OR DELETE ON public.messages
      FOR EACH ROW EXECUTE FUNCTION public.notify_inbox_changed()`)
    await sql.unsafe(
      await readFile(new URL('../../migrations/0082_out_of_office.sql', import.meta.url), 'utf8'),
    )
    await sql.unsafe(
      await readFile(
        new URL('../../migrations/0083_sender_screening.sql', import.meta.url),
        'utf8',
      ),
    )
  })
  beforeEach(async () => {
    await sql.unsafe(`TRUNCATE public.message_ai, public.messages, public.threads, public.users,
      public.sender_decisions, public.browser_notification_events, public.ntfy_notification_events,
      public.ntfy_subscriptions, realtime.pings CASCADE`)
    await sql`INSERT INTO users(id) VALUES (${OWNER}), (${OTHER})`
    await sql`INSERT INTO threads(id, user_id) VALUES (${THREAD}, ${OWNER}), (${OTHER_THREAD}, ${OTHER})`
    await sql`INSERT INTO ntfy_subscriptions(user_id, enabled) VALUES (${OWNER}, true), (${OTHER}, true)`
  })
  afterAll(async () => {
    if (sql) await sql.end()
  })

  async function arrive({
    user = OWNER,
    address = 'sender@example.com',
    messageId = crypto.randomUUID(),
    archived = false,
  } = {}) {
    const [message] =
      await sql`INSERT INTO messages(user_id, thread_id, from_address, message_id, is_archived)
      VALUES (${user}, ${user === OWNER ? THREAD : OTHER_THREAD}, ${address}, ${messageId}, ${archived})
      ON CONFLICT(user_id, message_id) WHERE message_id IS NOT NULL DO NOTHING RETURNING *`
    return message
  }
  async function enable(user = OWNER) {
    await sql`UPDATE users SET prefs = jsonb_build_object('senderScreening', true) WHERE id = ${user}`
  }
  async function decide(address, decision, user = OWNER) {
    await sql`INSERT INTO sender_decisions(user_id, address, decision) VALUES (${user}, ${address}, ${decision})`
  }
  async function alerts() {
    return sql`SELECT (SELECT count(*)::int FROM browser_notification_events) AS browser,
      (SELECT count(*)::int FROM ntfy_notification_events) AS ntfy`
  }

  it('defaults off, persists allowed mail, queues alerts once, and deduplicates an MTA retry', async () => {
    expect((await arrive({ messageId: 'retry-id' })).screening_status).toBe('allowed')
    expect(await arrive({ messageId: 'retry-id' })).toBeUndefined()
    expect(await alerts()).toEqual([{ browser: 1, ntfy: 1 }])
    expect(await sql`SELECT count(*)::int AS count FROM messages`).toEqual([{ count: 1 }])
  })
  it('withholds unknown and blocked arrivals before notification exposure without hiding refresh pings', async () => {
    await enable()
    await decide('blocked@example.com', 'blocked')
    const unknown = await arrive({ archived: true })
    const blocked = await arrive({ address: '  BLOCKED@EXAMPLE.COM  ' })
    expect(unknown).toMatchObject({
      screening_status: 'held',
      auto_reply_suppressed: true,
      is_archived: true,
      is_unread: true,
    })
    expect(blocked).toMatchObject({ screening_status: 'blocked', auto_reply_suppressed: true })
    expect(await alerts()).toEqual([{ browser: 0, ntfy: 0 }])
    const pings = await sql`SELECT payload FROM realtime.pings`
    expect(pings).toHaveLength(2)
    expect(pings.every((row) => !row.payload.event_id)).toBe(true)
  })
  it('recognizes only exact accepted addresses and keeps independent spam/archive state', async () => {
    await enable()
    await decide('sender@example.com', 'accepted')
    const accepted = await arrive({ address: ' Sender@Example.COM ', archived: true })
    await sql`INSERT INTO message_ai(message_id, spam_verdict) VALUES (${accepted.id}, 'spam')`
    expect(accepted.screening_status).toBe('allowed')
    expect((await arrive({ address: 'sender+tag@example.com' })).screening_status).toBe('held')
    expect((await arrive({ address: 'other@example.com' })).screening_status).toBe('held')
    const [saved] = await sql`SELECT m.is_archived, m.is_unread, ai.spam_verdict FROM messages m
      JOIN message_ai ai ON ai.message_id = m.id WHERE m.id = ${accepted.id}`
    expect(saved).toEqual({ is_archived: true, is_unread: true, spam_verdict: 'spam' })
  })
  it('keeps owner decisions separate and retains previous held mail after disabling screening', async () => {
    await decide('sender@example.com', 'blocked')
    expect((await arrive()).screening_status).toBe('blocked')
    expect((await arrive({ user: OTHER })).screening_status).toBe('allowed')
    await enable(OTHER)
    const held = await arrive({ user: OTHER, address: 'new@example.com' })
    await sql`UPDATE users SET prefs = '{}' WHERE id = ${OTHER}`
    expect((await arrive({ user: OTHER, address: 'next@example.com' })).screening_status).toBe(
      'allowed',
    )
    expect(
      (await sql`SELECT screening_status FROM messages WHERE id = ${held.id}`)[0].screening_status,
    ).toBe('held')
  })
  it('restores held mail without replaying alerts, clearing suppression, or overwriting underlying flags', async () => {
    await enable()
    const held = await arrive({ archived: true })
    await sql`INSERT INTO message_ai(message_id, spam_verdict) VALUES (${held.id}, 'spam')`
    await sql`UPDATE messages SET screening_status = 'allowed', search_indexed_at = NULL
      WHERE id = ${held.id} AND user_id = ${OWNER}`
    const [restored] = await sql`SELECT m.screening_status, m.is_archived, m.is_unread,
      m.auto_reply_suppressed, ai.spam_verdict FROM messages m JOIN message_ai ai ON ai.message_id = m.id
      WHERE m.id = ${held.id}`
    expect(restored).toEqual({
      screening_status: 'allowed',
      is_archived: true,
      is_unread: true,
      auto_reply_suppressed: true,
      spam_verdict: 'spam',
    })
    expect(await alerts()).toEqual([{ browser: 0, ntfy: 0 }])
    expect((await arrive()).screening_status).toBe('held')
    expect(await sql`SELECT count(*)::int AS count FROM realtime.pings`).toEqual([{ count: 3 }])
  })
  it('fails closed while preserving stored mail if a sender lookup fails', async () => {
    await sql.unsafe('ALTER TABLE public.sender_decisions RENAME TO sender_decisions_unavailable')
    try {
      expect(await arrive()).toMatchObject({
        screening_status: 'held',
        auto_reply_suppressed: true,
      })
      expect(await alerts()).toEqual([{ browser: 0, ntfy: 0 }])
    } finally {
      await sql.unsafe('ALTER TABLE public.sender_decisions_unavailable RENAME TO sender_decisions')
    }
  })
  it('keeps new decision data private from browser roles', async () => {
    const [privacy] = await sql`SELECT relrowsecurity AS rls,
      has_table_privilege('anon', 'public.sender_decisions', 'SELECT') AS anon_read,
      has_table_privilege('authenticated', 'public.sender_decisions', 'INSERT') AS browser_write
      FROM pg_class WHERE oid = 'public.sender_decisions'::regclass`
    expect(privacy).toEqual({ rls: true, anon_read: false, browser_write: false })
  })
})
