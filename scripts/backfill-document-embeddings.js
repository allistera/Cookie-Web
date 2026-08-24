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
// Safety valve: the loop below should terminate because every selected row
// leaves the predicate, but a paid-API loop must never rely on that alone.
const MAX_BATCHES = 500
// Durable marker for genuinely blank documents (no title/block text). Blank
// docs keep content_text = '' — the same value migration 0048 used as its
// "needs backfill" default — so without this marker they'd re-match the
// selection forever and burn an OpenAI call per batch. The save path
// overwrites embedding_model whenever a real embedding is computed, so an
// edited blank doc naturally becomes eligible again.
const SKIPPED_EMPTY = 'skipped-empty'

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
let skippedEmpty = 0

for (let batch = 0; batch < MAX_BATCHES; batch++) {
  // Skip rows already marked skipped-empty *and* still blank; a blank doc
  // that later gained content has a non-empty content_text (written at save
  // time) and re-enters via embedding IS NULL if its save-time embed failed.
  const rows = await sql`
    SELECT id, title, blocks
    FROM documents
    WHERE (embedding IS NULL OR content_text = '')
      AND NOT (content_text = '' AND embedding_model IS NOT DISTINCT FROM ${SKIPPED_EMPTY})
    ORDER BY created_at
    LIMIT ${BATCH_SIZE}
  `
  if (rows.length === 0) {
    break
  }

  const texts = rows.map((row) => flattenBlocksToText(row.title, row.blocks))
  const embeddable = rows
    .map((row, i) => ({ row, text: texts[i] }))
    .filter(({ text }) => text.trim() !== '')
  const empty = rows
    .map((row, i) => ({ row, text: texts[i] }))
    .filter(({ text }) => text.trim() === '')

  const vectors = embeddable.length
    ? await embedBatch(
        embeddable.map(({ text }) => text),
        OPENAI_API_KEY,
      )
    : []

  await Promise.all([
    ...embeddable.map(
      ({ row, text }, i) => sql`
        UPDATE documents
        SET content_text = ${text},
            embedding = ${JSON.stringify(vectors[i])}::extensions.vector,
            embedding_model = ${EMBEDDING_MODEL}
        WHERE id = ${row.id} AND (embedding IS NULL OR content_text = '')
      `,
    ),
    // Blank documents get the durable marker instead of a meaningless
    // "(empty)" vector, and drop out of the selection above for good.
    ...empty.map(
      ({ row, text }) => sql`
        UPDATE documents
        SET content_text = ${text},
            embedding_model = ${SKIPPED_EMPTY}
        WHERE id = ${row.id} AND (embedding IS NULL OR content_text = '')
      `,
    ),
  ])

  total += embeddable.length
  skippedEmpty += empty.length
  console.log(`embedded ${total} documents so far (${skippedEmpty} blank docs skipped)`)
}

console.log(`done: ${total} documents embedded, ${skippedEmpty} blank documents marked skipped`)
await sql.end()
