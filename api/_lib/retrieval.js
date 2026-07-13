// Shared hybrid-retrieval legs for /api/search and /api/ask. Both return
// ranked lists of message ids scoped to the authenticated user's non-archived
// mail (sent copies included — finding your own replies is a feature).

// Keyword leg over the generated tsvector column.
export function keywordLeg(sql, email, q, limit) {
  return sql`
    SELECT m.id
    FROM messages m
    JOIN users u ON u.id = m.user_id
    WHERE lower(u.email) = ${email} AND NOT m.is_archived
      AND m.search @@ websearch_to_tsquery('english', ${q})
    ORDER BY ts_rank(m.search, websearch_to_tsquery('english', ${q})) DESC
    LIMIT ${limit}
  `
}

// Vector leg: cosine distance over pgvector embeddings. Takes the query
// vector (already embedded) so callers can cache or skip embedding.
export function vectorLeg(sql, email, vector, limit) {
  return sql`
    SELECT m.id
    FROM messages m
    JOIN users u ON u.id = m.user_id
    WHERE lower(u.email) = ${email} AND NOT m.is_archived
      AND m.embedding IS NOT NULL
    ORDER BY m.embedding <=> ${vector}::vector
    LIMIT ${limit}
  `
}
