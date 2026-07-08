// Embeds messages that don't have a vector yet (embedding IS NULL).
// Run via the "Backfill Embeddings" GitHub workflow (workflow_dispatch),
// which supplies DATABASE_URL and OPENAI_API_KEY. Safe to re-run: it only
// touches rows that still have no embedding.

import process from 'node:process'

import { neon } from '@neondatabase/serverless'

import { embedBatch, EMBEDDING_MODEL } from '../api/_lib/embeddings.js'

const BATCH_SIZE = 20

const { DATABASE_URL, OPENAI_API_KEY } = process.env
if (!DATABASE_URL || !OPENAI_API_KEY) {
  console.error('DATABASE_URL and OPENAI_API_KEY must be set')
  process.exit(1)
}

const sql = neon(DATABASE_URL)
let total = 0

for (;;) {
  const rows = await sql`
    SELECT id, subject, body_text
    FROM messages
    WHERE embedding IS NULL
    ORDER BY created_at
    LIMIT ${BATCH_SIZE}
  `
  if (rows.length === 0) {
    break
  }

  const vectors = await embedBatch(
    rows.map((row) => `${row.subject ?? ''}\n\n${row.body_text ?? ''}`),
    OPENAI_API_KEY,
  )

  await Promise.all(
    rows.map(
      (row, i) => sql`
        UPDATE messages
        SET embedding = ${JSON.stringify(vectors[i])}::vector,
            embedding_model = ${EMBEDDING_MODEL}
        WHERE id = ${row.id} AND embedding IS NULL
      `,
    ),
  )

  total += rows.length
  console.log(`embedded ${total} messages so far`)
}

console.log(`done: ${total} messages embedded`)
