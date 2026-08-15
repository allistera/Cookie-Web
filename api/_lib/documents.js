import process from 'node:process'

import { createServices } from './services.js'
import { readJsonBody } from './body.js'
import { normalizeDocumentTags } from '../../src/lib/documentTags.js'
import { resolveDailyNoteEventDate, syncDailyNoteEvents } from './dailyEventSync.js'
import { flattenBlocksToText } from './documentText.js'
import { keywordLeg, recencyLeg, vectorLeg } from './documentRetrieval.js'
import { parseDocumentSearchQuery } from './query-parse.js'
import { fuseRankings } from './rank-fusion.js'
import { EMBEDDING_MODEL } from './embeddings.js'

// The Documents workspace: nested folders plus Editor.js block documents,
// modeled on Paper. Dispatched as /api/tasks?resource=documents because the
// Vercel Hobby function cap keeps new endpoints on the resource= pattern.
// Search (GET ?q=…) is dispatched the same way for the same reason, rather
// than getting its own /api/search-documents.js file.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const MAX_TITLE_LENGTH = 300
export const MAX_EMOJI_LENGTH = 16
// Blocks are stored verbatim, including base64 images, so the cap is generous
// but still bounds a single row (and request) to something sane.
export const MAX_BLOCKS_BYTES = 6 * 1024 * 1024

const MAX_SEARCH_QUERY_CHARS = 500
const SEARCH_CANDIDATES = 40 // per leg, before fusion
const SEARCH_RESULTS = 20
// Shared with every other user-triggered AI route (search.js, ask.js, ...).
const SEARCH_RATE_LIMIT = { limit: 10, windowMs: 60_000 }
// A dedicated, more generous bucket for the save-time embedding call: it's an
// autosave side effect, not a user-initiated AI action, so a heavy editing
// session must not starve concurrent mail search/ask/compose requests from
// the same user by draining their shared 'ai' quota.
const EMBED_RATE_LIMIT = { limit: 30, windowMs: 60_000 }
// flushPendingSave() serializes autosave PATCHes, so a hung OpenAI call would
// stall every edit queued behind it — bound how long a save-time embed call
// can take before giving up and saving without one.
const EMBED_TIMEOUT_MS = 5000

// UUID_RE.test coerces its argument; the identity check keeps non-strings
// that could coerce into a valid-looking id out of the raw SQL bindings.
function isUuid(value) {
  return value === String(value ?? '') && UUID_RE.test(value)
}

// Titles and emoji come straight from contenteditable inputs; bound them
// rather than trusting the client. Returns null when not a string at all.
export function cleanText(value, max) {
  if (!(value?.trim instanceof Function)) return null
  return value.trim().slice(0, max)
}

// A document body must be an array of objects small enough to store. Returns
// null on anything else so the caller can 400 instead of persisting garbage.
export function normalizeBlocks(input) {
  if (!Array.isArray(input)) return null
  if (input.some((block) => Object(block) !== block)) return null
  if (JSON.stringify(input).length > MAX_BLOCKS_BYTES) return null
  return input
}

export function fetchWorkspace(sql, userId) {
  return Promise.all([
    sql`
      SELECT f.id, f.parent_id, f.title, f.emoji, f.created_at
      FROM document_folders f
      WHERE f.user_id = ${userId}
      ORDER BY f.title ASC, f.created_at ASC
    `,
    sql`
      SELECT d.id, d.folder_id, d.title, d.emoji, d.starred, d.tags, d.created_at, d.updated_at
      FROM documents d
      WHERE d.user_id = ${userId}
      ORDER BY d.updated_at DESC
    `,
  ])
}

export function fetchDocument(sql, userId, id) {
  return sql`
    SELECT d.id, d.folder_id, d.title, d.emoji, d.starred, d.tags, d.blocks,
           d.created_at, d.updated_at
    FROM documents d
    WHERE d.id = ${id} AND d.user_id = ${userId}
  `
}

export function fetchTemplates(sql, userId) {
  return sql`
    SELECT t.id, t.title, t.emoji, t.created_at, t.updated_at
    FROM document_templates t
    WHERE t.user_id = ${userId}
    ORDER BY t.updated_at DESC
  `
}

export function fetchTemplate(sql, userId, id) {
  return sql`
    SELECT t.id, t.title, t.emoji, t.blocks, t.created_at, t.updated_at
    FROM document_templates t
    WHERE t.id = ${id} AND t.user_id = ${userId}
  `
}

// Fetches the fused search result ids in one list-shaped query, matching
// fetchWorkspace's row shape — blocks are never loaded for a result list, the
// same rule every other document list endpoint follows.
function fetchSearchDocuments(sql, userId, ids) {
  return sql`
    SELECT d.id, d.folder_id, d.title, d.emoji, d.starred, d.tags, d.created_at, d.updated_at
    FROM documents d
    WHERE d.user_id = ${userId} AND d.id = ANY(${ids}::uuid[])
  `
}

// Best-effort content_text + embedding for a document's current title/blocks,
// computed from the same flattened text so the tsvector (content_text) and
// the semantic vector never disagree about what a document "says". Never
// throws: a missing API key, exhausted quota, a timeout, or an OpenAI failure
// just means embedding/embedding_model are omitted from this save — content
// search still works off content_text, and the weekly backfill
// (scripts/backfill-document-embeddings.js) catches any stragglers. Must
// never delay or fail the caller's PATCH/POST over an embedding problem.
async function computeSearchFields(sql, userId, { title, blocks }, services) {
  const contentText = flattenBlocksToText(title, blocks)
  const fields = { content_text: contentText, embedding: null, embedding_model: null }
  if (!contentText.trim() || !process.env.OPENAI_API_KEY) return fields
  try {
    const allowed = await services.allowRequest(sql, userId, 'doc-embed', EMBED_RATE_LIMIT)
    if (!allowed) return fields
    fields.embedding = await services.embedText(contentText, process.env.OPENAI_API_KEY, {
      signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
    })
    fields.embedding_model = EMBEDDING_MODEL
  } catch (err) {
    console.error('Document embedding failed:', err.message)
  }
  return fields
}

function userExists(sql, userId) {
  return sql`SELECT 1 FROM users WHERE id = ${userId}`
}

// The caller's own folder, used to validate parent/target folder references
// before writing them — a folder id belonging to another user must behave
// exactly like one that does not exist.
function fetchOwnedFolder(sql, userId, id) {
  return sql`
    SELECT f.id
    FROM document_folders f
    WHERE f.id = ${id} AND f.user_id = ${userId}
  `
}

async function handleGet(req, res, userId, sql, services) {
  const searchParams = new URL(req.url, 'http://localhost').searchParams
  const q = (searchParams.get('q') || '').trim()
  if (q) return handleDocumentSearch(req, res, userId, sql, services, q)

  const templateId = searchParams.get('templateId')
  if (templateId) {
    if (!isUuid(templateId)) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'A valid template id is required' }))
      return
    }
    const [template] = await fetchTemplate(sql, userId, templateId)
    if (!template) {
      res.statusCode = 404
      res.end(JSON.stringify({ error: 'Template not found' }))
      return
    }
    res.statusCode = 200
    res.end(JSON.stringify({ template }))
    return
  }

  if (searchParams.has('templates')) {
    const templates = await fetchTemplates(sql, userId)
    res.statusCode = 200
    res.end(JSON.stringify({ templates }))
    return
  }

  const id = searchParams.get('id')
  if (id) {
    if (!isUuid(id)) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'A valid document id is required' }))
      return
    }
    const [document] = await fetchDocument(sql, userId, id)
    if (!document) {
      res.statusCode = 404
      res.end(JSON.stringify({ error: 'Document not found' }))
      return
    }
    res.statusCode = 200
    res.end(JSON.stringify({ document }))
    return
  }

  const [folders, documents] = await fetchWorkspace(sql, userId)
  res.statusCode = 200
  res.end(JSON.stringify({ folders, documents }))
}

// GET /api/tasks?resource=documents&q=…[&mode=keyword] — hybrid (keyword +
// semantic) search over the caller's documents, fused with reciprocal rank
// fusion. mode=keyword is the lower-latency type-ahead path and skips
// embeddings. Response shape matches the workspace list (no blocks).
// Structurally mirrors createSearchHandler in api/search.js.
async function handleDocumentSearch(req, res, userId, sql, services, rawQuery) {
  if (rawQuery.length > MAX_SEARCH_QUERY_CHARS) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'q is required (max 500 chars)' }))
    return
  }
  const semantic = new URL(req.url, 'http://localhost').searchParams.get('mode') !== 'keyword'

  // Split the raw query into free text, a prefix tsquery, and structured
  // operators (tag:/is:starred). A query containing only empty recognized
  // operators has no work to do and must not spend AI quota.
  const spec = parseDocumentSearchQuery(rawQuery)
  const hasFilters = Object.keys(spec.filters).length > 0
  if (!spec.text && !hasFilters) {
    res.statusCode = 200
    res.end(JSON.stringify({ documents: [] }))
    return
  }

  // Only hybrid search spends AI quota. Keyword-only type-ahead remains a
  // normal authenticated database query and cannot exhaust the shared AI
  // allowance merely because a user paused while typing.
  if (semantic && spec.text && process.env.OPENAI_API_KEY) {
    let allowed
    try {
      allowed = await services.allowRequest(sql, userId, 'ai', SEARCH_RATE_LIMIT)
    } catch (err) {
      console.error('GET /api/tasks?resource=documents (search) quota enforcement failed:', err.message)
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
    // Semantic leg is best-effort: no key, no free text, or an OpenAI failure
    // degrades to keyword/recency search rather than failing the request.
    const semanticIds = async () => {
      if (!semantic || !spec.text || !process.env.OPENAI_API_KEY) return []
      try {
        const vector = JSON.stringify(
          await services.embedTextCached(spec.text, process.env.OPENAI_API_KEY),
        )
        return await vectorLeg(sql, userId, vector, spec.filters, SEARCH_CANDIDATES)
      } catch (err) {
        console.error('GET /api/tasks?resource=documents (search) vector leg failed:', err.message)
        return []
      }
    }

    // Free-text queries rank purely by relevance (keyword + semantic);
    // recency is only the keyword leg's tie-breaker. A filters-only query has
    // no relevance signal, so it falls back to the recency leg newest-first.
    const keywordIds = spec.text ? keywordLeg(sql, userId, spec, SEARCH_CANDIDATES) : Promise.resolve([])
    const recencyIds = spec.text ? Promise.resolve([]) : recencyLeg(sql, userId, spec, SEARCH_CANDIDATES)

    const [keywordRows, recencyRows, vectorRows] = await Promise.all([
      keywordIds,
      recencyIds,
      semanticIds(),
    ])

    const ids = fuseRankings([
      keywordRows.map((r) => r.id),
      recencyRows.map((r) => r.id),
      vectorRows.map((r) => r.id),
    ]).slice(0, SEARCH_RESULTS)

    if (ids.length === 0) {
      res.statusCode = 200
      res.end(JSON.stringify({ documents: [] }))
      return
    }

    const rows = await fetchSearchDocuments(sql, userId, ids)
    const byId = new Map(rows.map((row) => [row.id, row]))
    const documents = ids.map((id) => byId.get(id)).filter(Boolean)

    res.statusCode = 200
    res.end(JSON.stringify({ documents }))
  } catch (err) {
    console.error('GET /api/tasks?resource=documents (search) failed:', err)
    res.statusCode = 500
    res.end(JSON.stringify({ error: 'Search failed' }))
  }
}

async function handlePost(res, body, userId, sql, services) {
  const [user] = await userExists(sql, userId)
  if (!user) {
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'User not found' }))
    return
  }

  if (body.kind === 'folder') {
    const title = cleanText(body.title, MAX_TITLE_LENGTH)
    if (!title) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'A folder title is required' }))
      return
    }
    const parentId = body.parentId ?? null
    if (parentId !== null) {
      if (!isUuid(parentId) || !(await fetchOwnedFolder(sql, userId, parentId)).length) {
        res.statusCode = 400
        res.end(JSON.stringify({ error: 'parentId must be one of your folders' }))
        return
      }
    }
    const emoji = cleanText(body.emoji, MAX_EMOJI_LENGTH) || '📁'
    const [folder] = await sql`
      INSERT INTO document_folders (user_id, parent_id, title, emoji)
      VALUES (${userId}, ${parentId}, ${title}, ${emoji})
      RETURNING id, parent_id, title, emoji, created_at
    `
    res.statusCode = 201
    res.end(JSON.stringify({ folder }))
    return
  }

  if (body.kind === 'template') {
    const title = cleanText(body.title, MAX_TITLE_LENGTH)
    const blocks = normalizeBlocks(body.blocks ?? [])
    if (!title || !blocks) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'A template title and valid blocks are required' }))
      return
    }
    const emoji = cleanText(body.emoji, MAX_EMOJI_LENGTH) || '📄'
    const [template] = await sql`
      INSERT INTO document_templates (user_id, title, emoji, blocks)
      VALUES (${userId}, ${title}, ${emoji}, ${sql.json(blocks)})
      RETURNING id, title, emoji, blocks, created_at, updated_at
    `
    res.statusCode = 201
    res.end(JSON.stringify({ template }))
    return
  }

  if (body.kind === 'document') {
    const folderId = body.folderId ?? null
    if (folderId !== null) {
      if (!isUuid(folderId) || !(await fetchOwnedFolder(sql, userId, folderId)).length) {
        res.statusCode = 400
        res.end(JSON.stringify({ error: 'folderId must be one of your folders' }))
        return
      }
    }
    let template = null
    if (body.templateId !== undefined && body.templateId !== null) {
      if (!isUuid(body.templateId)) {
        res.statusCode = 400
        res.end(JSON.stringify({ error: 'templateId must be one of your templates' }))
        return
      }
      ;[template] = await fetchTemplate(sql, userId, body.templateId)
      if (!template) {
        res.statusCode = 400
        res.end(JSON.stringify({ error: 'templateId must be one of your templates' }))
        return
      }
    }
    const title = cleanText(body.title, MAX_TITLE_LENGTH) ?? template?.title ?? ''
    const emoji = template?.emoji ?? '🔹'
    const blocks = template?.blocks ?? []
    // Awaited before the INSERT so a slow/failed OpenAI call never holds a DB
    // round trip open — see computeSearchFields. Branches into two full
    // statements (rather than a conditionally-nested embedding fragment)
    // since the vector column needs an explicit ::extensions.vector cast that
    // only applies when there is a vector to write.
    const searchFields = await computeSearchFields(sql, userId, { title, blocks }, services)
    const [document] = searchFields.embedding
      ? await sql`
          INSERT INTO documents (user_id, folder_id, title, emoji, blocks, content_text, embedding, embedding_model)
          VALUES (
            ${userId}, ${folderId}, ${title}, ${emoji}, ${sql.json(blocks)}, ${searchFields.content_text},
            ${JSON.stringify(searchFields.embedding)}::extensions.vector, ${searchFields.embedding_model}
          )
          RETURNING id, folder_id, title, emoji, starred, tags, blocks, created_at, updated_at
        `
      : await sql`
          INSERT INTO documents (user_id, folder_id, title, emoji, blocks, content_text)
          VALUES (${userId}, ${folderId}, ${title}, ${emoji}, ${sql.json(blocks)}, ${searchFields.content_text})
          RETURNING id, folder_id, title, emoji, starred, tags, blocks, created_at, updated_at
        `
    res.statusCode = 201
    res.end(JSON.stringify({ document }))
    return
  }

  res.statusCode = 400
  res.end(JSON.stringify({ error: "kind must be 'folder', 'document', or 'template'" }))
}

async function handlePatch(res, body, userId, sql, services) {
  if (!isUuid(body.id)) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'A valid id is required' }))
    return
  }

  if (body.kind === 'folder') {
    const title = cleanText(body.title, MAX_TITLE_LENGTH)
    if (!title) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'A folder title is required' }))
      return
    }
    const [folder] = await sql`
      UPDATE document_folders f
      SET title = ${title}
      WHERE f.id = ${body.id} AND f.user_id = ${userId}
      RETURNING f.id, f.parent_id, f.title, f.emoji, f.created_at
    `
    if (!folder) {
      res.statusCode = 404
      res.end(JSON.stringify({ error: 'Folder not found' }))
      return
    }
    res.statusCode = 200
    res.end(JSON.stringify({ folder }))
    return
  }

  if (body.kind === 'template') {
    const title = cleanText(body.title, MAX_TITLE_LENGTH)
    const blocks = normalizeBlocks(body.blocks)
    if (!title || !blocks) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'A template title and valid blocks are required' }))
      return
    }
    const [template] = await sql`
      UPDATE document_templates t
      SET title = ${title}, blocks = ${sql.json(blocks)}, updated_at = now()
      WHERE t.id = ${body.id} AND t.user_id = ${userId}
      RETURNING t.id, t.title, t.emoji, t.blocks, t.created_at, t.updated_at
    `
    if (!template) {
      res.statusCode = 404
      res.end(JSON.stringify({ error: 'Template not found' }))
      return
    }
    res.statusCode = 200
    res.end(JSON.stringify({ template }))
    return
  }

  // Document update: only the provided fields change. Every write bumps
  // updated_at, which is what orders the sidebar and dashboard.
  const updates = {}
  let newBlocks = null
  if (Object.hasOwn(body, 'title')) {
    const title = cleanText(body.title, MAX_TITLE_LENGTH)
    if (title === null) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'title must be a string' }))
      return
    }
    updates.title = title
  }
  if (Object.hasOwn(body, 'emoji')) {
    const emoji = cleanText(body.emoji, MAX_EMOJI_LENGTH)
    if (!emoji) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'emoji must be a non-empty string' }))
      return
    }
    updates.emoji = emoji
  }
  if (Object.hasOwn(body, 'starred')) {
    if (body.starred !== true && body.starred !== false) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'starred must be a boolean' }))
      return
    }
    updates.starred = body.starred
  }
  if (Object.hasOwn(body, 'folderId')) {
    if (body.folderId !== null) {
      if (!isUuid(body.folderId) || !(await fetchOwnedFolder(sql, userId, body.folderId)).length) {
        res.statusCode = 400
        res.end(JSON.stringify({ error: 'folderId must be one of your folders' }))
        return
      }
    }
    updates.folder_id = body.folderId
  }
  if (Object.hasOwn(body, 'blocks')) {
    const blocks = normalizeBlocks(body.blocks)
    if (!blocks) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'blocks must be an array of block objects' }))
      return
    }
    // sql.json, never a pre-stringified string: postgres.js would store that
    // as a jsonb string scalar rather than the array itself.
    updates.blocks = sql.json(blocks)
    newBlocks = blocks
  }
  if (Object.hasOwn(body, 'tags')) {
    const tags = normalizeDocumentTags(body.tags)
    if (!tags) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'tags must be an array of valid document tags' }))
      return
    }
    updates.tags = sql.array(tags)
  }
  if (Object.keys(updates).length === 0) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'Nothing to update' }))
    return
  }

  // content_text/embedding are derived from the document's *effective*
  // post-save title+blocks, so a save that only touches one of them still
  // needs the other's current value — fetched here (outside the transaction
  // below, which exists only for the unrelated daily-note-event diff) so a
  // slow/failed OpenAI call in computeSearchFields never holds a DB
  // transaction open. Kept independent of the transaction's own `previous`
  // read: that one is used to diff blocks for daily-note-event sync and has
  // its own correctness needs (must run at UPDATE time, inside the
  // transaction); content_text/embedding are eventual-consistency-tolerant
  // and don't need that rigor.
  let embeddingVector = null
  const touchesTitle = Object.hasOwn(body, 'title')
  const touchesBlocks = Object.hasOwn(body, 'blocks')
  if (touchesTitle || touchesBlocks) {
    // newBlocks defaults to null (not undefined) when blocks aren't touched,
    // so effective-value resolution is driven by touchesTitle/touchesBlocks
    // rather than a value comparison that null would also satisfy.
    let effectiveTitle = touchesTitle ? updates.title : undefined
    let effectiveBlocks = touchesBlocks ? newBlocks : undefined
    if (!touchesTitle || !touchesBlocks) {
      const [current] =
        await sql`SELECT title, blocks FROM documents WHERE id = ${body.id} AND user_id = ${userId}`
      if (!current) {
        res.statusCode = 404
        res.end(JSON.stringify({ error: 'Document not found' }))
        return
      }
      if (!touchesTitle) effectiveTitle = current.title
      if (!touchesBlocks) effectiveBlocks = current.blocks
    }
    const searchFields = await computeSearchFields(
      sql,
      userId,
      { title: effectiveTitle, blocks: effectiveBlocks },
      services,
    )
    updates.content_text = searchFields.content_text
    if (searchFields.embedding) {
      updates.embedding_model = searchFields.embedding_model
      embeddingVector = searchFields.embedding
    }
  }

  const [document] = await sql.begin(async (sql) => {
    // Only needed to diff against the post-update blocks below; skip the
    // extra round trip when this save doesn't touch blocks at all.
    const previous = newBlocks
      ? (await sql`SELECT folder_id, title, blocks FROM documents WHERE id = ${body.id} AND user_id = ${userId}`)[0]
      : null

    // Branches into two full statements (rather than a conditionally-nested
    // embedding fragment) since the vector column needs an explicit
    // ::extensions.vector cast that only applies when there is a new vector
    // to write — a rate-limited or skipped embed must leave the existing
    // column untouched, not null it out.
    const rows = embeddingVector
      ? await sql`
          UPDATE documents d
          SET ${sql(updates)}, updated_at = now(), embedding = ${JSON.stringify(embeddingVector)}::extensions.vector
          WHERE d.id = ${body.id} AND d.user_id = ${userId}
          RETURNING d.id, d.folder_id, d.title, d.emoji, d.starred, d.tags, d.created_at, d.updated_at
        `
      : await sql`
          UPDATE documents d
          SET ${sql(updates)}, updated_at = now()
          WHERE d.id = ${body.id} AND d.user_id = ${userId}
          RETURNING d.id, d.folder_id, d.title, d.emoji, d.starred, d.tags, d.created_at, d.updated_at
        `
    const updated = rows[0]
    if (updated && previous) {
      const eventDate = await resolveDailyNoteEventDate(sql, userId, updated.folder_id, updated.title)
      if (eventDate) {
        await syncDailyNoteEvents(sql, userId, updated.id, eventDate, previous.blocks, newBlocks)
      }
    }
    return rows
  })
  if (!document) {
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'Document not found' }))
    return
  }
  res.statusCode = 200
  res.end(JSON.stringify({ document }))
}

async function handleDelete(res, body, userId, sql) {
  if (!isUuid(body.id)) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'A valid id is required' }))
    return
  }

  // Folder deletion cascades to sub-folders in the schema; their documents
  // drop back to the root via ON DELETE SET NULL rather than vanishing.
  const result =
    body.kind === 'folder'
      ? await sql`
          DELETE FROM document_folders f
          WHERE f.id = ${body.id} AND f.user_id = ${userId}
          RETURNING f.id
        `
      : body.kind === 'template'
        ? await sql`
          DELETE FROM document_templates t
          WHERE t.id = ${body.id} AND t.user_id = ${userId}
          RETURNING t.id
        `
        : await sql`
          DELETE FROM documents d
          WHERE d.id = ${body.id} AND d.user_id = ${userId}
          RETURNING d.id
        `
  if (!result.length) {
    res.statusCode = 404
    const subject = body.kind === 'folder' ? 'Folder' : body.kind === 'template' ? 'Template' : 'Document'
    res.end(JSON.stringify({ error: `${subject} not found` }))
    return
  }
  res.statusCode = 200
  res.end(JSON.stringify({ ok: true }))
}

// GET /api/tasks?resource=documents        — { folders, documents } (no blocks)
// GET ...&id=<uuid>                        — { document } with blocks
// GET ...&templates / &templateId=<uuid>   — template list / full template
// POST { kind: 'folder'|'document'|'template', ... } — create
// PATCH { id, ... } / { kind:'folder', id, title } — update
// DELETE { kind, id }                      — delete
export async function handleDocuments(req, res, userId, services = createServices()) {
  const sql = services.getSql()
  const route = `${req.method} /api/tasks?resource=documents`
  try {
    if (req.method === 'GET') {
      return await handleGet(req, res, userId, sql, services)
    }

    if (req.method !== 'POST' && req.method !== 'PATCH' && req.method !== 'DELETE') {
      res.statusCode = 405
      res.end(JSON.stringify({ error: 'Method not allowed' }))
      return
    }

    let body
    try {
      body = await readJsonBody(req)
    } catch {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'Invalid JSON body' }))
      return
    }

    if (req.method === 'POST') return await handlePost(res, body, userId, sql, services)
    if (req.method === 'PATCH') return await handlePatch(res, body, userId, sql, services)
    return await handleDelete(res, body, userId, sql)
  } catch (err) {
    console.error(`${route} failed:`, err)
    res.statusCode = 500
    res.end(JSON.stringify({ error: 'Documents request failed' }))
  }
}
