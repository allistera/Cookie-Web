import process from 'node:process'

import { getSql } from './_lib/db.js'
import { verifyAccessToken } from './_lib/auth.js'
import { embedTextCached } from './_lib/embeddings.js'
import { fuseRankings } from './_lib/rank-fusion.js'
import { allowRequest } from './_lib/rate-limit.js'
import { keywordLeg, recencyLeg, vectorLeg } from './_lib/retrieval.js'
import { parseSearchQuery } from './_lib/query-parse.js'

const MAX_QUERY_CHARS = 500
const CANDIDATES = 40 // per leg, before fusion
const RESULTS = 20
const RATE_LIMIT = { limit: 10, windowMs: 60_000 } // shared with all user-triggered AI routes

// Fetches the fused result ids in one list-shaped query. Only summary presence
// is exposed here; the generated text remains on the owned-message endpoint.
// Bodies are excluded for the same reason as fetchEmails: results render the
// stored snippet and fetch the authoritative body only when opened.
export function fetchSearchEmails(sql, userId, ids) {
  return sql`
    SELECT m.id, m.from_name, m.from_address, m.subject, m.snippet,
           m.sent_at, m.is_unread, m.is_starred, m.scheduled_for,
           BOOL_OR(NULLIF(BTRIM(ai.summary), '') IS NOT NULL) AS has_ai_summary,
           COALESCE(
             json_agg(json_build_object('name', l.name, 'color', l.color)
                      ORDER BY l.name)
               FILTER (WHERE l.id IS NOT NULL),
             '[]'
           ) AS labels
    FROM messages m
    LEFT JOIN message_ai ai ON ai.message_id = m.id
    LEFT JOIN message_labels ml ON ml.message_id = m.id
    LEFT JOIN labels l ON l.id = ml.label_id
    WHERE m.user_id = ${userId} AND m.id = ANY(${ids}::uuid[])
    GROUP BY m.id
  `
}

export function parseSearchRequest(reqUrl) {
  const url = new URL(reqUrl, 'http://localhost')
  return {
    query: (url.searchParams.get('q') || '').trim(),
    semantic: url.searchParams.get('mode') !== 'keyword',
  }
}

// GET /api/search?q=… — hybrid (keyword + semantic) search over the
// authenticated user's messages, fused with reciprocal rank fusion.
// mode=keyword is the lower-latency type-ahead path and skips embeddings.
// Response shape matches GET /api/emails.
export function createSearchHandler(services = { getSql, verifyAccessToken, allowRequest }) {
  return async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json')

    if (req.method !== 'GET') {
      res.statusCode = 405
      res.end(JSON.stringify({ error: 'Method not allowed' }))
      return
    }

    let userId
    try {
      ;({ userId } = await services.verifyAccessToken(req))
    } catch {
      res.statusCode = 401
      res.end(JSON.stringify({ error: 'Unauthorized' }))
      return
    }

    const { query: q, semantic } = parseSearchRequest(req.url)
    if (!q || q.length > MAX_QUERY_CHARS) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'q is required (max 500 chars)' }))
      return
    }

    // Split the raw query into free text, a prefix tsquery, and structured
    // operators (sender:/tag:/from:/to:/has:/before:/after:). A query containing
    // only empty recognized operators has no work to do and must not spend AI
    // quota.
    const spec = parseSearchQuery(q)
    const hasFilters = Object.keys(spec.filters).length > 0
    if (!spec.text && !hasFilters) {
      res.statusCode = 200
      res.end(JSON.stringify({ emails: [] }))
      return
    }

    // Only hybrid search spends AI quota. Keyword-only type-ahead remains a
    // normal authenticated database query and cannot exhaust the shared AI
    // allowance merely because a user paused while typing.
    if (semantic && spec.text && process.env.OPENAI_API_KEY) {
      let allowed
      try {
        allowed = await services.allowRequest(services.getSql(), userId, 'ai', RATE_LIMIT)
      } catch (err) {
        console.error('GET /api/search quota enforcement failed:', err.message)
        res.statusCode = 503
        res.end(JSON.stringify({ error: 'Search is temporarily unavailable' }))
        return
      }
      if (!allowed) {
        res.statusCode = 429
        res.end(JSON.stringify({ error: 'Too many searches, slow down' }))
        return
      }
    }

    try {
      const sql = services.getSql()

      // Semantic leg is best-effort: no key, no free text, or an OpenAI failure
      // degrades to keyword/recency search rather than failing the request.
      const semanticIds = async () => {
        if (!semantic || !spec.text || !process.env.OPENAI_API_KEY) return []
        try {
          const vector = JSON.stringify(
            await embedTextCached(spec.text, process.env.OPENAI_API_KEY),
          )
          return await vectorLeg(sql, userId, vector, spec.filters, CANDIDATES)
        } catch (err) {
          console.error('GET /api/search vector leg failed:', err.message)
          return []
        }
      }

      // Free-text queries rank purely by relevance (keyword + semantic); recency
      // is only the keyword leg's tie-breaker, so results are not date-sorted. A
      // filters-only query has no relevance signal, so it falls back to the
      // recency leg ordered newest-first.
      const keywordIds = spec.text ? keywordLeg(sql, userId, spec, CANDIDATES) : Promise.resolve([])
      const recencyIds = spec.text ? Promise.resolve([]) : recencyLeg(sql, userId, spec, CANDIDATES)

      const [keywordRows, recencyRows, vectorRows] = await Promise.all([
        keywordIds,
        recencyIds,
        semanticIds(),
      ])

      const ids = fuseRankings([
        keywordRows.map((r) => r.id),
        recencyRows.map((r) => r.id),
        vectorRows.map((r) => r.id),
      ]).slice(0, RESULTS)

      if (ids.length === 0) {
        res.statusCode = 200
        res.end(JSON.stringify({ emails: [] }))
        return
      }

      const rows = await fetchSearchEmails(sql, userId, ids)
      const byId = new Map(rows.map((row) => [row.id, row]))
      const emails = ids.map((id) => byId.get(id)).filter(Boolean)

      res.statusCode = 200
      res.end(JSON.stringify({ emails }))
    } catch (err) {
      console.error('GET /api/search failed:', err)
      res.statusCode = 500
      res.end(JSON.stringify({ error: 'Search failed' }))
    }
  }
}

export default createSearchHandler()
