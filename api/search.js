import process from 'node:process'

import { neon } from '@neondatabase/serverless'

import { verifyAccessToken } from './_lib/auth.js'
import { embedText } from './_lib/embeddings.js'
import { fuseRankings } from './_lib/rank-fusion.js'

const MAX_QUERY_CHARS = 500
const CANDIDATES = 40 // per leg, before fusion
const RESULTS = 20

// Keyword leg: the tsvector column from migration 0001. Also the fallback
// when the vector leg is unavailable (no key, no embeddings yet, API error).
function keywordLeg(sql, sub, q) {
  return sql`
    SELECT m.id
    FROM messages m
    JOIN users u ON u.id = m.user_id
    WHERE u.auth0_sub = ${sub} AND NOT m.is_archived
      AND m.search @@ websearch_to_tsquery('english', ${q})
    ORDER BY ts_rank(m.search, websearch_to_tsquery('english', ${q})) DESC
    LIMIT ${CANDIDATES}
  `
}

// Vector leg: cosine distance over pgvector embeddings. Best-effort — any
// failure degrades to keyword-only search rather than failing the request.
async function vectorLeg(sql, sub, q) {
  if (!process.env.OPENAI_API_KEY) {
    return []
  }
  try {
    const vector = JSON.stringify(await embedText(q, process.env.OPENAI_API_KEY))
    return await sql`
      SELECT m.id
      FROM messages m
      JOIN users u ON u.id = m.user_id
      WHERE u.auth0_sub = ${sub} AND NOT m.is_archived
        AND m.embedding IS NOT NULL
      ORDER BY m.embedding <=> ${vector}::vector
      LIMIT ${CANDIDATES}
    `
  } catch (err) {
    console.error('GET /api/search vector leg failed:', err.message)
    return []
  }
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

  let sub
  try {
    ;({ sub } = await verifyAccessToken(req))
  } catch {
    res.statusCode = 401
    res.end(JSON.stringify({ error: 'Unauthorized' }))
    return
  }

  const q = (new URL(req.url, 'http://localhost').searchParams.get('q') || '').trim()
  if (!q || q.length > MAX_QUERY_CHARS) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'q is required (max 500 chars)' }))
    return
  }

  try {
    const sql = neon(process.env.DATABASE_URL)
    const [keywordRows, vectorRows] = await Promise.all([
      keywordLeg(sql, sub, q),
      vectorLeg(sql, sub, q),
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

    const rows = await sql`
      SELECT m.id, m.from_name, m.from_address, m.subject, m.snippet,
             m.body_text, m.sent_at, m.is_unread, m.is_starred,
             COALESCE(
               json_agg(json_build_object('name', l.name, 'color', l.color)
                        ORDER BY l.name)
                 FILTER (WHERE l.id IS NOT NULL),
               '[]'
             ) AS labels
      FROM messages m
      JOIN users u ON u.id = m.user_id
      LEFT JOIN message_labels ml ON ml.message_id = m.id
      LEFT JOIN labels l ON l.id = ml.label_id
      WHERE u.auth0_sub = ${sub} AND m.id = ANY(${ids}::uuid[])
      GROUP BY m.id
    `
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
