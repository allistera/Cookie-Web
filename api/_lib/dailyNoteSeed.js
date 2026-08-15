import { getSql } from './db.js'
import { readJsonBody } from './body.js'
import { normalizeBlocks } from './documents.js'

// The default content new daily notes are seeded with (see openTodayNote in
// src/stores/documents.js), customizable in Settings > Documents > Time
// Management. Lives in users.prefs like interests.js's topics: a small
// per-user preference with no need for its own table. An empty array is the
// valid "not customized, use the built-in default" state, not an error.
export function fetchDailyNoteSeed(sql, userId) {
  return sql`
    SELECT coalesce(u.prefs -> 'dailyNoteSeed', '[]'::jsonb) AS blocks
    FROM users u
    WHERE u.id = ${userId}
  `
}

export function saveDailyNoteSeed(sql, userId, blocks) {
  // sql.json (not a manually JSON.stringify'd string cast with ::jsonb) is
  // required here: postgres.js sends a pre-stringified string parameter as
  // jsonb text that Postgres parses back into a jsonb *string scalar*, not an
  // object, which turns the || below into an array-append instead of a
  // key merge and silently drops every previous save.
  return sql`
    UPDATE users
    SET prefs = coalesce(prefs, '{}'::jsonb) || ${sql.json({ dailyNoteSeed: blocks })}
    WHERE id = ${userId}
    RETURNING coalesce(prefs -> 'dailyNoteSeed', '[]'::jsonb) AS blocks
  `
}

// GET/PUT /api/tasks?resource=daily-note-seed
export async function handleDailyNoteSeed(req, res, userId) {
  const sql = getSql()

  if (req.method === 'GET') {
    try {
      const [row] = await fetchDailyNoteSeed(sql, userId)
      res.statusCode = 200
      res.end(JSON.stringify({ blocks: row?.blocks ?? [] }))
    } catch (err) {
      console.error('GET /api/tasks?resource=daily-note-seed failed:', err)
      res.statusCode = 500
      res.end(JSON.stringify({ error: 'Failed to load the daily note default' }))
    }
    return
  }

  if (req.method === 'PUT') {
    let body
    try {
      body = await readJsonBody(req)
    } catch {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'Invalid JSON body' }))
      return
    }

    const blocks = normalizeBlocks(body?.blocks ?? [])
    if (!blocks) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'blocks must be an array of block objects' }))
      return
    }

    try {
      const [row] = await saveDailyNoteSeed(sql, userId, blocks)
      if (!row) {
        res.statusCode = 404
        res.end(JSON.stringify({ error: 'User not found' }))
        return
      }
      res.statusCode = 200
      res.end(JSON.stringify({ blocks: row.blocks }))
    } catch (err) {
      console.error('PUT /api/tasks?resource=daily-note-seed failed:', err)
      res.statusCode = 500
      res.end(JSON.stringify({ error: 'Failed to save the daily note default' }))
    }
    return
  }

  res.statusCode = 405
  res.end(JSON.stringify({ error: 'Method not allowed' }))
}
