import { createServices } from './services.js'
import { readJsonBody } from './body.js'
import { normalizeDocumentTags } from '../../src/lib/documentTags.js'
import { resolveDailyNoteEventDate, syncDailyNoteEvents } from './dailyEventSync.js'

// The Documents workspace: nested folders plus Editor.js block documents,
// modeled on Paper. Dispatched as /api/tasks?resource=documents because the
// Vercel Hobby function cap keeps new endpoints on the resource= pattern.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const MAX_TITLE_LENGTH = 300
export const MAX_EMOJI_LENGTH = 16
// Blocks are stored verbatim, including base64 images, so the cap is generous
// but still bounds a single row (and request) to something sane.
export const MAX_BLOCKS_BYTES = 6 * 1024 * 1024

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

async function handleGet(req, res, userId, sql) {
  const searchParams = new URL(req.url, 'http://localhost').searchParams
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

async function handlePost(res, body, userId, sql) {
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
    const [document] = await sql`
      INSERT INTO documents (user_id, folder_id, title, emoji, blocks)
      VALUES (${userId}, ${folderId}, ${title}, ${emoji}, ${sql.json(blocks)})
      RETURNING id, folder_id, title, emoji, starred, tags, blocks, created_at, updated_at
    `
    res.statusCode = 201
    res.end(JSON.stringify({ document }))
    return
  }

  res.statusCode = 400
  res.end(JSON.stringify({ error: "kind must be 'folder', 'document', or 'template'" }))
}

async function handlePatch(res, body, userId, sql) {
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

  const [document] = await sql.begin(async (sql) => {
    // Only needed to diff against the post-update blocks below; skip the
    // extra round trip when this save doesn't touch blocks at all.
    const previous = newBlocks
      ? (await sql`SELECT folder_id, title, blocks FROM documents WHERE id = ${body.id} AND user_id = ${userId}`)[0]
      : null

    const rows = await sql`
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
      return await handleGet(req, res, userId, sql)
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

    if (req.method === 'POST') return await handlePost(res, body, userId, sql)
    if (req.method === 'PATCH') return await handlePatch(res, body, userId, sql)
    return await handleDelete(res, body, userId, sql)
  } catch (err) {
    console.error(`${route} failed:`, err)
    res.statusCode = 500
    res.end(JSON.stringify({ error: 'Documents request failed' }))
  }
}
