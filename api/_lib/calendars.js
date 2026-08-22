import { writeAuthError } from './auth.js'
import { createServices } from './services.js'
import { readJsonBody } from './body.js'
import { syncCalendarSubscription, validSubscriptionUrl } from './calendarSync.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const COLOR_RE = /^#[0-9a-f]{6}$/i
const MAX_NAME = 50
// A subscription sync performs a server-side HTTPS fetch (10s timeout, 5MB
// cap) plus a transactional rewrite of up to 1000 event rows, so both the
// create-time initial sync and manual re-syncs share one per-user quota.
const SYNC_RATE_LIMIT = { limit: 5, windowMs: 60_000 }

const DEFAULT_CALENDARS = [
  { id: 'work', name: 'Work', color: '#4f7c6b' },
  { id: 'personal', name: 'Personal', color: '#2db985' },
  { id: 'focus', name: 'Focus time', color: '#795da8' },
  { id: 'birthdays', name: 'Birthdays', color: '#d8953b' },
  { id: 'holidays', name: 'Holidays', color: '#d15c4e' },
]

const isUndefinedTable = (error) => error?.code === '42P01'

export async function fetchCalendars(sql, userId) {
  try {
    return await sql`
      SELECT c.id, c.name, c.color, c.subscription_url AS "subscriptionUrl",
             c.subscription_synced_at AS "subscriptionSyncedAt", c.subscription_error AS "subscriptionError"
      FROM calendars c
      WHERE c.user_id = ${userId}
      ORDER BY c.created_at, c.id
    `
  } catch (error) {
    // During the rollout window before migration 0026 lands, fall back to a
    // read that doesn't reference the new subscription columns.
    if (error?.code !== '42703') throw error
    return sql`
      SELECT c.id, c.name, c.color
      FROM calendars c
      WHERE c.user_id = ${userId}
      ORDER BY c.created_at, c.id
    `
  }
}

// New users have no calendars until this runs once; seed the same five
// defaults the client used to hardcode so the sidebar isn't empty on first
// load. A no-op for anyone who already has calendars, including users
// backfilled by migration 0023.
async function ensureDefaultCalendars(sql, userId) {
  const existing = await fetchCalendars(sql, userId)
  if (existing.length > 0) return existing

  // Seed in one statement, then read the canonical rows. This avoids leaving
  // a permanently partial set after a mid-loop failure and makes concurrent
  // first loads return the same complete result. WHERE EXISTS keeps the same
  // no-op-if-the-user-vanished behavior the users-join used to give for free.
  await sql`
    INSERT INTO calendars (user_id, name, color)
    SELECT ${userId}, defaults.name, defaults.color
    FROM (VALUES
      ('Work', '#4f7c6b'),
      ('Personal', '#2db985'),
      ('Focus time', '#795da8'),
      ('Birthdays', '#d8953b'),
      ('Holidays', '#d15c4e')
    ) AS defaults(name, color)
    WHERE EXISTS (SELECT 1 FROM users WHERE id = ${userId})
    ON CONFLICT (user_id, name) DO NOTHING
  `
  return fetchCalendars(sql, userId)
}

async function listCalendars(sql, userId, res) {
  let calendars
  try {
    calendars = await ensureDefaultCalendars(sql, userId)
  } catch (error) {
    // Vercel and the migration workflow deploy independently. Keep the new
    // client usable if it arrives first; mutations become available as soon
    // as the expand migration creates the table.
    if (!isUndefinedTable(error)) throw error
    calendars = DEFAULT_CALENDARS
  }
  res.statusCode = 200
  res.end(JSON.stringify({ calendars }))
}

function validName(name) {
  const trimmed = String(name ?? '').trim()
  return trimmed && trimmed.length <= MAX_NAME ? trimmed : null
}

async function claimSyncQuota(allowRequest, sql, userId, res) {
  let allowed
  try {
    allowed = await allowRequest(sql, userId, 'calendar-sync', SYNC_RATE_LIMIT)
  } catch (err) {
    console.error('calendar sync quota enforcement failed:', err.message)
    res.statusCode = 503
    res.end(JSON.stringify({ error: 'Calendar sync is temporarily unavailable' }))
    return false
  }
  if (!allowed) {
    res.statusCode = 429
    res.end(JSON.stringify({ error: 'Too many calendar syncs, slow down' }))
    return false
  }
  return true
}

async function createCalendar(sql, userId, body, res) {
  const name = validName(body.name)
  const color = String(body.color ?? '')
  const subscriptionUrl =
    body.subscriptionUrl !== undefined &&
    body.subscriptionUrl !== null &&
    body.subscriptionUrl !== ''
      ? validSubscriptionUrl(body.subscriptionUrl)
      : null
  if (!name || !COLOR_RE.test(color) || (body.subscriptionUrl && !subscriptionUrl)) {
    res.statusCode = 400
    res.end(
      JSON.stringify({
        error:
          'name (max 50), a hex color, and (if subscribing) a valid https calendar URL are required',
      }),
    )
    return
  }

  const [row] = await sql`
    INSERT INTO calendars (user_id, name, color, subscription_url)
    SELECT ${userId}, ${name}, ${color}, ${subscriptionUrl}
    WHERE EXISTS (SELECT 1 FROM users WHERE id = ${userId})
    ON CONFLICT (user_id, name) DO NOTHING
    RETURNING id, name, color, user_id AS "userId"
  `
  if (!row) {
    res.statusCode = 409
    res.end(JSON.stringify({ error: 'A calendar with that name already exists' }))
    return
  }

  let calendar = { id: row.id, name: row.name, color: row.color }
  if (subscriptionUrl) {
    const sync = await syncCalendarSubscription(sql, row.id, row.userId, subscriptionUrl)
    calendar = {
      ...calendar,
      subscriptionUrl,
      subscriptionSyncedAt: sync.ok ? new Date().toISOString() : null,
      subscriptionError: sync.ok ? null : sync.error,
    }
  }
  res.statusCode = 201
  res.end(JSON.stringify({ calendar }))
}

// Manual re-sync of an existing subscribed calendar, triggered from the
// sidebar's "Sync now" action.
async function syncCalendar(sql, userId, body, res) {
  const id = UUID_RE.test(body.id) ? String(body.id) : null
  if (!id) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'id is required' }))
    return
  }

  const [row] = await sql`
    SELECT c.id, c.user_id AS "userId", c.subscription_url AS "subscriptionUrl"
    FROM calendars c
    WHERE c.id = ${id} AND c.user_id = ${userId}
  `
  if (!row?.subscriptionUrl) {
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'Subscribed calendar not found' }))
    return
  }

  const sync = await syncCalendarSubscription(sql, row.id, row.userId, row.subscriptionUrl)
  res.statusCode = sync.ok ? 200 : 502
  res.end(
    JSON.stringify(
      sync.ok
        ? { ok: true, subscriptionSyncedAt: new Date().toISOString(), subscriptionError: null }
        : { ok: false, subscriptionError: sync.error },
    ),
  )
}

async function renameCalendar(sql, userId, body, res) {
  const id = UUID_RE.test(body.id) ? String(body.id) : null
  const name = id ? validName(body.name) : null
  if (!id || !name) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'id and a valid name (max 50) are required' }))
    return
  }

  let calendar
  try {
    ;[calendar] = await sql`
      UPDATE calendars c
      SET name = ${name}
      WHERE c.id = ${id} AND c.user_id = ${userId}
      RETURNING c.id, c.name, c.color
    `
  } catch (error) {
    if (error?.code === '23505') {
      res.statusCode = 409
      res.end(JSON.stringify({ error: 'A calendar with that name already exists' }))
      return
    }
    throw error
  }

  if (!calendar) {
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'Calendar not found' }))
    return
  }
  res.statusCode = 200
  res.end(JSON.stringify({ calendar }))
}

// Blocks deleting a manually-managed calendar that still has events, rather
// than silently cascading the delete or orphaning them — the client asks the
// user to delete or move those events first. Subscribed calendars are
// exempt: their events are entirely sync-owned (never hand-edited), so
// deleting the subscription cascades its events rather than asking the user
// to clear a calendar they can't otherwise edit.
async function deleteCalendar(sql, userId, body, res) {
  const id = UUID_RE.test(body.id) ? String(body.id) : null
  if (!id) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'id is required' }))
    return
  }

  let owned
  try {
    ;[owned] = await sql`
      SELECT c.subscription_url IS NOT NULL AS "isSubscribed"
      FROM calendars c
      WHERE c.id = ${id} AND c.user_id = ${userId}
    `
  } catch (error) {
    if (error?.code !== '42703') throw error
    // Rollout window before migration 0026 lands: no calendar can be a
    // subscription yet, so behave exactly like the pre-subscription check.
    ;[owned] = await sql`
      SELECT false AS "isSubscribed"
      FROM calendars c
      WHERE c.id = ${id} AND c.user_id = ${userId}
    `
  }
  if (!owned) {
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'Calendar not found' }))
    return
  }

  // user_id rides along in these statements not for authorization (the
  // ownership check above already settled that) but so the composite index
  // (user_id, calendar) applies — calendar alone has no usable index.
  if (owned.isSubscribed) {
    await sql.begin(async (tx) => {
      await tx`DELETE FROM calendar_events WHERE user_id = ${userId} AND calendar = ${id}`
      await tx`DELETE FROM calendars WHERE id = ${id}`
    })
    res.statusCode = 200
    res.end(JSON.stringify({ ok: true }))
    return
  }

  const [{ count }] = await sql`
    SELECT count(*)::int AS count
    FROM calendar_events WHERE user_id = ${userId} AND calendar = ${id}
  `
  if (count > 0) {
    res.statusCode = 409
    res.end(
      JSON.stringify({
        error: `This calendar has ${count} event${count === 1 ? '' : 's'}. Delete or move them first.`,
      }),
    )
    return
  }

  try {
    await sql`DELETE FROM calendars WHERE id = ${id}`
  } catch (error) {
    // The FK installed by the contract migration closes the count/delete
    // race if an event is created between the two statements.
    if (error?.code === '23503') {
      res.statusCode = 409
      res.end(JSON.stringify({ error: 'This calendar has events. Delete or move them first.' }))
      return
    }
    throw error
  }
  res.statusCode = 200
  res.end(JSON.stringify({ ok: true }))
}

// /api/calendar-events?resource=calendars — GET lists the user's calendars
// (seeding defaults for a brand new user), POST creates one, PATCH renames
// one, DELETE removes one (rejected while it still has events).
export function createHandler(overrides = {}) {
  const services = createServices(overrides)
  return async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json')

    let userId
    try {
      ;({ userId } = await services.verifyAccessToken(req))
    } catch (error) {
      writeAuthError(res, error)
      return
    }

    try {
      const sql = services.getSql()
      if (req.method === 'GET') {
        await listCalendars(sql, userId, res)
        return
      }
      if (req.method === 'POST' || req.method === 'PATCH' || req.method === 'DELETE') {
        let body
        try {
          body = await readJsonBody(req)
        } catch {
          res.statusCode = 400
          res.end(JSON.stringify({ error: 'Invalid JSON body' }))
          return
        }
        if (req.method === 'POST' && body.action === 'sync') {
          if (!(await claimSyncQuota(services.allowRequest, sql, userId, res))) return
          await syncCalendar(sql, userId, body, res)
        } else if (req.method === 'POST' && body.subscriptionUrl) {
          if (!(await claimSyncQuota(services.allowRequest, sql, userId, res))) return
          await createCalendar(sql, userId, body, res)
        } else if (req.method === 'POST') await createCalendar(sql, userId, body, res)
        else if (req.method === 'PATCH') await renameCalendar(sql, userId, body, res)
        else await deleteCalendar(sql, userId, body, res)
        return
      }
      res.statusCode = 405
      res.end(JSON.stringify({ error: 'Method not allowed' }))
    } catch (err) {
      if (isUndefinedTable(err)) {
        res.statusCode = 503
        res.end(
          JSON.stringify({ error: 'Calendar management is being upgraded. Try again shortly.' }),
        )
        return
      }
      console.error(`${req.method} calendar management failed:`, err)
      res.statusCode = 500
      res.end(JSON.stringify({ error: 'Calendars request failed' }))
    }
  }
}

export default createHandler()
