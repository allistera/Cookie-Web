// Embeds documents that don't have a vector yet (embedding IS NULL), and
// backfills content_text for any row migration 0048 defaulted to '' (every
// document that existed before document search shipped). Recomputes
// content_text from the document's current title/blocks on every run rather
// than trusting the stored column, so a stale save-time skip self-heals too.
// Run via the "Backfill Embeddings" GitHub workflow (workflow_dispatch),
// which supplies DATABASE_URL and OPENAI_API_KEY. Safe to re-run: it only
// touches rows that still need content_text or an embedding.

import process from 'node:process'

import postgres from 'postgres'

import { embedBatch, EMBEDDING_MODEL } from '../api/_lib/embeddings.js'
import { flattenBlocksToText } from '../api/_lib/documentText.js'

const BATCH_SIZE = 20

const { DATABASE_URL, OPENAI_API_KEY } = process.env
if (!DATABASE_URL || !OPENAI_API_KEY) {
  console.error('DATABASE_URL and OPENAI_API_KEY must be set')
  process.exit(1)
}

// prepare: false is required for transaction-mode poolers (Supavisor,
// PgBouncer) — safe no-op against a direct connection too.
const sql = postgres(DATABASE_URL, {
  ssl: 'require',
  max: 5,
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: false,
})
let total = 0

for (;;) {
  const rows = await sql`
    SELECT id, title, blocks
    FROM documents
    WHERE embedding IS NULL OR content_text = ''
    ORDER BY created_at
    LIMIT ${BATCH_SIZE}
  `
  if (rows.length === 0) {
    break
  }

  const texts = rows.map((row) => flattenBlocksToText(row.title, row.blocks))
  const vectors = await embedBatch(texts, OPENAI_API_KEY)

  await Promise.all(
    rows.map(
      (row, i) => sql`
        UPDATE documents
        SET content_text = ${texts[i]},
            embedding = ${JSON.stringify(vectors[i])}::extensions.vector,
            embedding_model = ${EMBEDDING_MODEL}
        WHERE id = ${row.id} AND (embedding IS NULL OR content_text = '')
      `,
    ),
  )

  total += rows.length
  console.log(`embedded ${total} documents so far`)
}

console.log(`done: ${total} documents embedded`)
await sql.end()
