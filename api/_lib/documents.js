import { getSql } from './db.js'
import { captureApiError } from './sentry.js'
import { readJsonBody } from './body.js'

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

export function fetchWorkspace(sql, email) {
  return Promise.all([
    sql`
      SELECT f.id, f.parent_id, f.title, f.emoji, f.created_at
      FROM document_folders f
      JOIN users u ON u.id = f.user_id
      WHERE lower(u.email) = ${email}
      ORDER BY f.title ASC, f.created_at ASC
    `,
    sql`
      SELECT d.id, d.folder_id, d.title, d.emoji, d.starred, d.created_at, d.updated_at
      FROM documents d
      JOIN users u ON u.id = d.user_id
      WHERE lower(u.email) = ${email}
      ORDER BY d.updated_at DESC
    `,
  ])
}

export function fetchDocument(sql, email, id) {
  return sql`
    SELECT d.id, d.folder_id, d.title, d.emoji, d.starred, d.blocks,
           d.created_at, d.updated_at
    FROM documents d
    JOIN users u ON u.id = d.user_id
    WHERE d.id = ${id} AND lower(u.email) = ${email}
  `
}

function fetchUserId(sql, email) {
  return sql`SELECT id FROM users WHERE lower(email) = ${email}`
}

// The caller's own folder, used to validate parent/target folder references
// before writing them — a folder id belonging to another user must behave
// exactly like one that does not exist.
function fetchOwnedFolder(sql, email, id) {
  return sql`
    SELECT f.id
    FROM document_folders f
    JOIN users u ON u.id = f.user_id
    WHERE f.id = ${id} AND lower(u.email) = ${email}
  `
}

async function handleGet(req, res, email, sql) {
  const id = new URL(req.url, 'http://localhost').searchParams.get('id')
  if (id) {
    if (!isUuid(id)) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'A valid document id is required' }))
      return
    }
    const [document] = await fetchDocument(sql, email, id)
    if (!document) {
      res.statusCode = 404
      res.end(JSON.stringify({ error: 'Document not found' }))
      return
    }
    res.statusCode = 200
    res.end(JSON.stringify({ document }))
    return
  }

  const [folders, documents] = await fetchWorkspace(sql, email)
  res.statusCode = 200
  res.end(JSON.stringify({ folders, documents }))
}

async function handlePost(res, body, email, sql) {
  const [user] = await fetchUserId(sql, email)
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
      if (!isUuid(parentId) || !(await fetchOwnedFolder(sql, email, parentId)).length) {
        res.statusCode = 400
        res.end(JSON.stringify({ error: 'parentId must be one of your folders' }))
        return
      }
    }
    const emoji = cleanText(body.emoji, MAX_EMOJI_LENGTH) || '📁'
    const [folder] = await sql`
      INSERT INTO document_folders (user_id, parent_id, title, emoji)
      VALUES (${user.id}, ${parentId}, ${title}, ${emoji})
      RETURNING id, parent_id, title, emoji, created_at
    `
    res.statusCode = 201
    res.end(JSON.stringify({ folder }))
    return
  }

  if (body.kind === 'document') {
    const folderId = body.folderId ?? null
    if (folderId !== null) {
      if (!isUuid(folderId) || !(await fetchOwnedFolder(sql, email, folderId)).length) {
        res.statusCode = 400
        res.end(JSON.stringify({ error: 'folderId must be one of your folders' }))
        return
      }
    }
    const title = cleanText(body.title, MAX_TITLE_LENGTH) ?? ''
    const [document] = await sql`
      INSERT INTO documents (user_id, folder_id, title)
      VALUES (${user.id}, ${folderId}, ${title})
      RETURNING id, folder_id, title, emoji, starred, blocks, created_at, updated_at
    `
    res.statusCode = 201
    res.end(JSON.stringify({ document }))
    return
  }

  res.statusCode = 400
  res.end(JSON.stringify({ error: "kind must be 'folder' or 'document'" }))
}

async function handlePatch(res, body, email, sql) {
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
      FROM users u
      WHERE f.id = ${body.id} AND f.user_id = u.id AND lower(u.email) = ${email}
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

  // Document update: only the provided fields change. Every write bumps
  // updated_at, which is what orders the sidebar and dashboard.
  const updates = {}
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
      if (!isUuid(body.folderId) || !(await fetchOwnedFolder(sql, email, body.folderId)).length) {
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
  }
  if (Object.keys(updates).length === 0) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'Nothing to update' }))
    return
  }

  const [document] = await sql`
    UPDATE documents d
    SET ${sql(updates)}, updated_at = now()
    FROM users u
    WHERE d.id = ${body.id} AND d.user_id = u.id AND lower(u.email) = ${email}
    RETURNING d.id, d.folder_id, d.title, d.emoji, d.starred, d.created_at, d.updated_at
  `
  if (!document) {
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'Document not found' }))
    return
  }
  res.statusCode = 200
  res.end(JSON.stringify({ document }))
}

async function handleDelete(res, body, email, sql) {
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
          USING users u
          WHERE f.id = ${body.id} AND f.user_id = u.id AND lower(u.email) = ${email}
          RETURNING f.id
        `
      : await sql`
          DELETE FROM documents d
          USING users u
          WHERE d.id = ${body.id} AND d.user_id = u.id AND lower(u.email) = ${email}
          RETURNING d.id
        `
  if (!result.length) {
    res.statusCode = 404
    res.end(JSON.stringify({ error: body.kind === 'folder' ? 'Folder not found' : 'Document not found' }))
    return
  }
  res.statusCode = 200
  res.end(JSON.stringify({ ok: true }))
}

// GET /api/tasks?resource=documents        — { folders, documents } (no blocks)
// GET ...&id=<uuid>                        — { document } with blocks
// POST { kind: 'folder'|'document', ... }  — create
// PATCH { id, ... } / { kind:'folder', id, title } — update
// DELETE { kind, id }                      — delete
export async function handleDocuments(req, res, email) {
  const sql = getSql()
  const route = `${req.method} /api/tasks?resource=documents`
  try {
    if (req.method === 'GET') {
      return await handleGet(req, res, email, sql)
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

    if (req.method === 'POST') return await handlePost(res, body, email, sql)
    if (req.method === 'PATCH') return await handlePatch(res, body, email, sql)
    return await handleDelete(res, body, email, sql)
  } catch (err) {
    console.error(`${route} failed:`, err)
    await captureApiError(err, { route })
    res.statusCode = 500
    res.end(JSON.stringify({ error: 'Documents request failed' }))
  }
}
