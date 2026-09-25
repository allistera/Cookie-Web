// One-time migration: rewrites every legacy `{ type: 'table', data: {
// content } }` block (the old @editorjs/table + formulaTableTool.js shape)
// into `{ type: 'table', data: { workbook } }`, a full Univer IWorkbookData
// snapshot, via the same converter (contentGridToWorkbookData) the client
// tool falls back to for any block this script hasn't reached yet — so it is
// not load-bearing for correctness, only for getting every document onto the
// new format up front rather than lazily on next open.
//
// Table blocks that already carry `data.workbook` are left untouched, so
// this is safe to re-run. Defaults to a dry run (prints what it would do,
// writes nothing); pass --apply to actually write.
//
// This performs direct writes to the production documents/document_templates
// tables and is not wired into a GitHub workflow on purpose — run it by hand:
//   DATABASE_URL=... node scripts/migrate-table-blocks-to-univer.js          # dry run
//   DATABASE_URL=... node scripts/migrate-table-blocks-to-univer.js --apply  # writes

import process from 'node:process'

import postgres from 'postgres'

import { contentGridToWorkbookData } from '../src/lib/univerTableData.js'
import { flattenBlocksToText } from '../api/_lib/documentText.js'

const BATCH_SIZE = 100
const APPLY = process.argv.includes('--apply')
const NIL_UUID = '00000000-0000-0000-0000-000000000000'
// Selects rows holding a top-level table block without data.workbook — the
// exact shape migrateBlocks rewrites. A LIKE over blocks::text cannot do
// this: jsonb renders as `"type": "table"` (with a space), so it never matched.
const LEGACY_TABLE_PATH = '$[*] ? (@.type == "table" && !exists(@.data.workbook))'

const { DATABASE_URL } = process.env
if (!DATABASE_URL) {
  console.error('DATABASE_URL must be set')
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

function migrateBlocks(blocks) {
  let changed = false
  const next = (Array.isArray(blocks) ? blocks : []).map((block) => {
    if (block?.type !== 'table' || block.data?.workbook) return block
    changed = true
    return { type: 'table', data: { workbook: contentGridToWorkbookData(block.data?.content) } }
  })
  return { blocks: next, changed }
}

async function migrateDocuments() {
  let cursor = NIL_UUID
  let scanned = 0
  let migrated = 0

  for (;;) {
    const rows = await sql`
      SELECT id, title, blocks FROM documents
      WHERE id > ${cursor} AND jsonb_path_exists(blocks, ${LEGACY_TABLE_PATH}::jsonpath)
      ORDER BY id ASC
      LIMIT ${BATCH_SIZE}
    `
    if (rows.length === 0) break
    cursor = rows.at(-1).id
    scanned += rows.length

    for (const row of rows) {
      const { blocks, changed } = migrateBlocks(row.blocks)
      if (!changed) continue
      migrated += 1
      if (!APPLY) {
        console.log(`[dry-run] would migrate document ${row.id}`)
        continue
      }
      const contentText = flattenBlocksToText(row.title, blocks)
      await sql`
        UPDATE documents SET blocks = ${sql.json(blocks)}, content_text = ${contentText}
        WHERE id = ${row.id}
      `
    }
    console.log(
      `documents: scanned ${scanned}, ${APPLY ? 'migrated' : 'would migrate'} ${migrated} so far`,
    )
  }
  return { scanned, migrated }
}

async function migrateTemplates() {
  let cursor = NIL_UUID
  let scanned = 0
  let migrated = 0

  for (;;) {
    const rows = await sql`
      SELECT id, blocks FROM document_templates
      WHERE id > ${cursor} AND jsonb_path_exists(blocks, ${LEGACY_TABLE_PATH}::jsonpath)
      ORDER BY id ASC
      LIMIT ${BATCH_SIZE}
    `
    if (rows.length === 0) break
    cursor = rows.at(-1).id
    scanned += rows.length

    for (const row of rows) {
      const { blocks, changed } = migrateBlocks(row.blocks)
      if (!changed) continue
      migrated += 1
      if (!APPLY) {
        console.log(`[dry-run] would migrate template ${row.id}`)
        continue
      }
      await sql`UPDATE document_templates SET blocks = ${sql.json(blocks)} WHERE id = ${row.id}`
    }
    console.log(
      `document_templates: scanned ${scanned}, ${APPLY ? 'migrated' : 'would migrate'} ${migrated} so far`,
    )
  }
  return { scanned, migrated }
}

const documentsResult = await migrateDocuments()
const templatesResult = await migrateTemplates()

console.log(
  `Done. Documents: ${documentsResult.migrated}/${documentsResult.scanned} table blocks migrated. ` +
    `Templates: ${templatesResult.migrated}/${templatesResult.scanned} table blocks migrated.`,
)
if (!APPLY) console.log('Dry run only — nothing was written. Re-run with --apply to write changes.')

await sql.end()
