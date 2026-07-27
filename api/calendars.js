import { getSql } from './_lib/db.js'
import { verifyAccessToken } from './_lib/auth.js'
import { captureApiError } from './_lib/sentry.js'
import { readJsonBody } from './_lib/body.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const COLOR_RE = /^#[0-9a-f]{6}$/i
const MAX_NAME = 50

const DEFAULT_CALENDARS = [
  { id: 'work', name: 'Work', color: '#4f7c6b' },
  { id: 'personal', name: 'Personal', color: '#2db985' },
  { id: 'focus', name: 'Focus time', color: '#795da8' },
  { id: 'birthdays', name: 'Birthdays', color: '#d8953b' },
  { id: 'holidays', name: 'Holidays', color: '#d15c4e' },
]

const isUndefinedTable = (error) => error?.code === '42P01'

export function fetchCalendars(sql, email) {
  return sql`
    SELECT c.id, c.name, c.color
    FROM calendars c
    JOIN users u ON u.id = c.user_id
    WHERE lower(u.email) = ${email}
    ORDER BY c.created_at, c.id
  `
}

// New users have no calendars until this runs once; seed the same five
// defaults the client used to hardcode so the sidebar isn't empty on first
// load. A no-op for anyone who already has calendars, including users
// backfilled by migration 0023.
async function ensureDefaultCalendars(sql, email) {
  const existing = await fetchCalendars(sql, email)
  if (existing.length > 0) return existing

  // Seed in one statement, then read the canonical rows. This avoids leaving
  // a permanently partial set after a mid-loop failure and makes concurrent
  // first loads return the same complete result.
  await sql`
    INSERT INTO calendars (user_id, name, color)
    SELECT u.id, defaults.name, defaults.color
    FROM users u
    CROSS JOIN (VALUES
      ('Work', '#4f7c6b'),
      ('Personal', '#2db985'),
      ('Focus time', '#795da8'),
      ('Birthdays', '#d8953b'),
      ('Holidays', '#d15c4e')
    ) AS defaults(name, color)
    WHERE lower(u.email) = ${email}
    ON CONFLICT (user_id, name) DO NOTHING
  `
  return fetchCalendars(sql, email)
}

async function listCalendars(sql, email, res) {
  let calendars
  try {
    calendars = await ensureDefaultCalendars(sql, email)
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
  const trimmed = typeof name === 'string' ? name.trim() : ''
  return trimmed && trimmed.length <= MAX_NAME ? trimmed : null
}

async function createCalendar(sql, email, body, res) {
  const name = validName(body.name)
  const color = typeof body.color === 'string' ? body.color : ''
  if (!name || !COLOR_RE.test(color)) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'name (max 50) and a hex color are required' }))
    return
  }

  const [calendar] = await sql`
    INSERT INTO calendars (user_id, name, color)
    SELECT u.id, ${name}, ${color}
    FROM users u
    WHERE lower(u.email) = ${email}
    ON CONFLICT (user_id, name) DO NOTHING
    RETURNING id, name, color
  `
  if (!calendar) {
    res.statusCode = 409
    res.end(JSON.stringify({ error: 'A calendar with that name already exists' }))
    return
  }
  res.statusCode = 201
  res.end(JSON.stringify({ calendar }))
}

async function renameCalendar(sql, email, body, res) {
  const id = typeof body.id === 'string' && UUID_RE.test(body.id) ? body.id : null
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
      FROM users u
      WHERE c.id = ${id} AND c.user_id = u.id AND lower(u.email) = ${email}
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

// Blocks deleting a calendar that still has events, rather than silently
// cascading the delete or orphaning them — the client asks the user to
// delete or move those events first.
async function deleteCalendar(sql, email, body, res) {
  const id = typeof body.id === 'string' && UUID_RE.test(body.id) ? body.id : null
  if (!id) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'id is required' }))
    return
  }

  const [owns] = await sql`
    SELECT EXISTS (
      SELECT 1 FROM calendars c JOIN users u ON u.id = c.user_id
      WHERE c.id = ${id} AND lower(u.email) = ${email}
    ) AS calendar
  `
  if (!owns?.calendar) {
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'Calendar not found' }))
    return
  }

  const [{ count }] = await sql`
    SELECT count(*)::int AS count FROM calendar_events WHERE calendar = ${id}
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

// /api/calendars — GET lists the user's calendars (seeding defaults for a
// brand new user), POST creates one, PATCH renames one, DELETE removes one
// (rejected while it still has events).
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json')

  let email
  try {
    ;({ email } = await verifyAccessToken(req))
  } catch {
    res.statusCode = 401
    res.end(JSON.stringify({ error: 'Unauthorized' }))
    return
  }

  try {
    const sql = getSql()
    if (req.method === 'GET') {
      await listCalendars(sql, email, res)
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
      if (req.method === 'POST') await createCalendar(sql, email, body, res)
      else if (req.method === 'PATCH') await renameCalendar(sql, email, body, res)
      else await deleteCalendar(sql, email, body, res)
      return
    }
    res.statusCode = 405
    res.end(JSON.stringify({ error: 'Method not allowed' }))
  } catch (err) {
    if (isUndefinedTable(err)) {
      res.statusCode = 503
      res.end(JSON.stringify({ error: 'Calendar management is being upgraded. Try again shortly.' }))
      return
    }
    console.error(`${req.method} /api/calendars failed:`, err)
    await captureApiError(err, { route: `${req.method} /api/calendars` })
    res.statusCode = 500
    res.end(JSON.stringify({ error: 'Calendars request failed' }))
  }
}
