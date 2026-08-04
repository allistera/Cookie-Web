import { getSql } from './db.js'
import { captureApiError } from './sentry.js'
import { readJsonBody } from './body.js'

// Personalisation topics for AI Today's news section. Unlike the signature and
// snippets, these cannot live in localStorage: the data-enricher Worker reads
// them at 05:00 UTC with no browser running. They go in users.prefs, the jsonb
// column 0001 declared for settings-modal preferences and never used.
export const MAX_INTERESTS = 20
export const MAX_INTEREST_LENGTH = 60

export function fetchInterests(sql, email) {
  return sql`
    SELECT coalesce(u.prefs -> 'interests', '[]'::jsonb) AS interests
    FROM users u
    WHERE lower(u.email) = ${email}
  `
}

export function saveInterests(sql, email, interests) {
  return sql`
    UPDATE users
    SET prefs = coalesce(prefs, '{}'::jsonb) || ${JSON.stringify({ interests })}::jsonb
    WHERE lower(email) = ${email}
    RETURNING coalesce(prefs -> 'interests', '[]'::jsonb) AS interests
  `
}

// Trim, drop blanks, de-duplicate case-insensitively, and bound both the list
// and each entry. Returns null when the payload is not a list of strings at
// all, which the caller reports as a 400 rather than silently storing nothing.
export function normalizeInterests(input) {
  if (!Array.isArray(input)) return null
  if (input.some((entry) => typeof entry !== 'string')) return null

  const seen = new Set()
  const interests = []
  for (const entry of input) {
    const trimmed = entry.trim().slice(0, MAX_INTEREST_LENGTH)
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    interests.push(trimmed)
    if (interests.length === MAX_INTERESTS) break
  }
  return interests
}

// GET/PUT /api/tasks?resource=interests — the topics the news section is
// ranked against. An empty list is valid and means "don't personalise".
export async function handleInterests(req, res, email) {
  const sql = getSql()

  if (req.method === 'GET') {
    try {
      const [row] = await fetchInterests(sql, email)
      res.statusCode = 200
      res.end(JSON.stringify({ interests: row?.interests ?? [] }))
    } catch (err) {
      console.error('GET /api/tasks?resource=interests failed:', err)
      await captureApiError(err, { route: 'GET /api/tasks?resource=interests' })
      res.statusCode = 500
      res.end(JSON.stringify({ error: 'Failed to load interests' }))
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

    const interests = normalizeInterests(body?.interests)
    if (!interests) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'interests must be an array of strings' }))
      return
    }

    try {
      const [row] = await saveInterests(sql, email, interests)
      if (!row) {
        res.statusCode = 404
        res.end(JSON.stringify({ error: 'User not found' }))
        return
      }
      res.statusCode = 200
      res.end(JSON.stringify({ interests: row.interests }))
    } catch (err) {
      console.error('PUT /api/tasks?resource=interests failed:', err)
      await captureApiError(err, { route: 'PUT /api/tasks?resource=interests' })
      res.statusCode = 500
      res.end(JSON.stringify({ error: 'Failed to save interests' }))
    }
    return
  }

  res.statusCode = 405
  res.end(JSON.stringify({ error: 'Method not allowed' }))
}
