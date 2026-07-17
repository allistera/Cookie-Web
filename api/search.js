import process from 'node:process'

import { getSql } from './_lib/db.js'
import { verifyAccessToken } from './_lib/auth.js'
import { captureApiError } from './_lib/sentry.js'
import { embedTextCached } from './_lib/embeddings.js'
import { fuseRankings } from './_lib/rank-fusion.js'
import { allowRequest } from './_lib/rate-limit.js'
import { keywordLeg, vectorLeg } from './_lib/retrieval.js'

const MAX_QUERY_CHARS = 500
const CANDIDATES = 40 // per leg, before fusion
const RESULTS = 20
const RATE_LIMIT = { limit: 30, windowMs: 60_000 } // per user; vector leg costs money

// Fetches the fused result ids in one list-shaped query. Only summary presence
// is exposed here; the generated text remains on the owned-message endpoint.
export function fetchSearchEmails(sql, email, ids) {
  return sql`
    SELECT m.id, m.from_name, m.from_address, m.subject, m.snippet,
           m.body_text, m.sent_at, m.is_unread, m.is_starred, m.scheduled_for,
           BOOL_OR(NULLIF(BTRIM(ai.summary), '') IS NOT NULL) AS has_ai_summary,
           COALESCE(
             json_agg(json_build_object('name', l.name, 'color', l.color)
                      ORDER BY l.name)
               FILTER (WHERE l.id IS NOT NULL),
             '[]'
           ) AS labels
    FROM messages m
    JOIN users u ON u.id = m.user_id
    LEFT JOIN message_ai ai ON ai.message_id = m.id
    LEFT JOIN message_labels ml ON ml.message_id = m.id
    LEFT JOIN labels l ON l.id = ml.label_id
    WHERE lower(u.email) = ${email} AND m.id = ANY(${ids}::uuid[])
    GROUP BY m.id
  `
}

// GET /api/search?q=… — hybrid (keyword + semantic) search over the
// authenticated user's messages, fused with reciprocal rank fusion.
// Response shape matches GET /api/emails.
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json')

  if (req.method !== 'GET') {
    res.statusCode = 405
    res.end(JSON.stringify({ error: 'Method not allowed' }))
    return
  }

  let email
  try {
    ;({ email } = await verifyAccessToken(req))
  } catch {
    res.statusCode = 401
    res.end(JSON.stringify({ error: 'Unauthorized' }))
    return
  }

  if (!allowRequest(`search:${email}`, RATE_LIMIT)) {
    res.statusCode = 429
    res.end(JSON.stringify({ error: 'Too many searches, slow down' }))
    return
  }

  const q = (new URL(req.url, 'http://localhost').searchParams.get('q') || '').trim()
  if (!q || q.length > MAX_QUERY_CHARS) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'q is required (max 500 chars)' }))
    return
  }

  try {
    const sql = getSql()

    // Semantic leg is best-effort: no key or an OpenAI failure degrades to
    // keyword-only search rather than failing the request.
    const semanticIds = async () => {
      if (!process.env.OPENAI_API_KEY) return []
      try {
        const vector = JSON.stringify(await embedTextCached(q, process.env.OPENAI_API_KEY))
        return await vectorLeg(sql, email, vector, CANDIDATES)
      } catch (err) {
        console.error('GET /api/search vector leg failed:', err.message)
        return []
      }
    }

    const [keywordRows, vectorRows] = await Promise.all([
      keywordLeg(sql, email, q, CANDIDATES),
      semanticIds(),
    ])

    const ids = fuseRankings([
      keywordRows.map((r) => r.id),
      vectorRows.map((r) => r.id),
    ]).slice(0, RESULTS)

    if (ids.length === 0) {
      res.statusCode = 200
      res.end(JSON.stringify({ emails: [] }))
      return
    }

    const rows = await fetchSearchEmails(sql, email, ids)
    const byId = new Map(rows.map((row) => [row.id, row]))
    const emails = ids.map((id) => byId.get(id)).filter(Boolean)

    res.statusCode = 200
    res.end(JSON.stringify({ emails }))
  } catch (err) {
    console.error('GET /api/search failed:', err)
    await captureApiError(err, { route: 'GET /api/search' })
    res.statusCode = 500
    res.end(JSON.stringify({ error: 'Search failed' }))
  }
}
