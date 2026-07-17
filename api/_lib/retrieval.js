// Shared hybrid-retrieval legs for /api/search and /api/ask. All return ranked
// lists of message ids scoped to the authenticated user's non-archived mail
// (sent copies included — finding your own replies is a feature).
//
// The legs take a parsed spec { text, prefixQuery, filters } (see
// query-parse.js). `text` is the free-text query, `prefixQuery` is an optional
// prefix tsquery for search-as-you-type, and `filters` holds the structured
// operators applied as extra SQL predicates across every leg.

// Full-text predicate: the free-text query OR, when present, the prefix query,
// so an in-progress last word still matches. Both are injection-safe:
// websearch_to_tsquery sanitises free text, and prefixQuery is built from
// alphanumeric-only words in query-parse.js.
function textMatch(sql, text, prefixQuery) {
  if (prefixQuery) {
    return sql`(m.search @@ websearch_to_tsquery('english', ${text})
                OR m.search @@ to_tsquery('english', ${prefixQuery}))`
  }
  return sql`m.search @@ websearch_to_tsquery('english', ${text})`
}

// Relevance score: best of the free-text and prefix ranks. setweight() in the
// generated column already boosts subject/sender over body via ts_rank's
// default weights.
function rankExpr(sql, text, prefixQuery) {
  if (prefixQuery) {
    return sql`GREATEST(
      ts_rank(m.search, websearch_to_tsquery('english', ${text})),
      ts_rank(m.search, to_tsquery('english', ${prefixQuery}))
    )`
  }
  return sql`ts_rank(m.search, websearch_to_tsquery('english', ${text}))`
}

// Structured-operator predicates, ANDed into a leg's WHERE. Returns an empty
// fragment when no filters are set.
function filterClause(sql, filters = {}) {
  const parts = []
  if (filters.from) {
    const like = `%${filters.from}%`
    parts.push(sql`AND (m.from_address ILIKE ${like} OR coalesce(m.from_name, '') ILIKE ${like})`)
  }
  if (filters.to) {
    parts.push(sql`AND m.recipients::text ILIKE ${`%${filters.to}%`}`)
  }
  if (filters.hasAttachment) {
    parts.push(sql`AND EXISTS (SELECT 1 FROM attachments a WHERE a.message_id = m.id)`)
  }
  if (filters.before) {
    parts.push(sql`AND m.sent_at < ${filters.before}::date`)
  }
  if (filters.after) {
    parts.push(sql`AND m.sent_at >= ${filters.after}::date`)
  }
  return parts.reduce((acc, part) => sql`${acc} ${part}`, sql``)
}

// Keyword leg: full-text match ranked by relevance. Requires spec.text.
export function keywordLeg(sql, email, spec, limit) {
  const { text, prefixQuery, filters } = spec
  return sql`
    SELECT m.id
    FROM messages m
    JOIN users u ON u.id = m.user_id
    WHERE lower(u.email) = ${email} AND NOT m.is_archived
      AND ${textMatch(sql, text, prefixQuery)}
      ${filterClause(sql, filters)}
    ORDER BY ${rankExpr(sql, text, prefixQuery)} DESC
    LIMIT ${limit}
  `
}

// Recency leg: the same candidates ordered newest-first, fused with the keyword
// leg so a recent relevant match outranks an equally-relevant stale one. With
// no free text (a filters-only query such as `from:alice has:attachment`) it
// returns filter matches by date, which is the whole result set for such
// queries.
export function recencyLeg(sql, email, spec, limit) {
  const { text, prefixQuery, filters } = spec
  const match = text ? sql`AND ${textMatch(sql, text, prefixQuery)}` : sql``
  return sql`
    SELECT m.id
    FROM messages m
    JOIN users u ON u.id = m.user_id
    WHERE lower(u.email) = ${email} AND NOT m.is_archived
      ${match}
      ${filterClause(sql, filters)}
    ORDER BY m.sent_at DESC
    LIMIT ${limit}
  `
}

// Vector leg: cosine distance over pgvector embeddings. Takes the query vector
// (already embedded) so callers can cache or skip embedding, plus the same
// structured filters so semantic results honour from:/to:/date operators too.
export function vectorLeg(sql, email, vector, filters, limit) {
  return sql`
    SELECT m.id
    FROM messages m
    JOIN users u ON u.id = m.user_id
    WHERE lower(u.email) = ${email} AND NOT m.is_archived
      AND m.embedding IS NOT NULL
      ${filterClause(sql, filters)}
    ORDER BY m.embedding <=> ${vector}::extensions.vector
    LIMIT ${limit}
  `
}
