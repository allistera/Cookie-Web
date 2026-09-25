import process from 'node:process'
import { del, head } from '@vercel/blob'
import { handleUpload } from '@vercel/blob/client'
import { writeAuthError } from './auth.js'
import { createServices } from './services.js'
import { readJsonBody } from './body.js'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_OUTBOUND_ATTACHMENT_BYTES = 20 * 1024 * 1024
const ATTACHMENT_BLOB_PREFIX = 'outbound-attachments'
const ATTACHMENT_UPLOADS_PER_MINUTE = 30
const ATTACHMENT_REGISTRATIONS_PER_MINUTE = 30

export function sanitizeAttachmentFilename(value) {
  const base = String(value ?? '')
    .split(/[/\\]/)
    .pop()
  // Stripping control characters is the whole point here: they are what makes
  // a filename header-injection bait.
  // oxlint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  if (!cleaned || cleaned === '.' || cleaned === '..') return 'attachment'
  return cleaned.slice(0, 200)
}
function isUndefinedOutboundAttachmentsTable(err) {
  return err?.code === '42P01' && /outbound_attachments/i.test(String(err.message ?? ''))
}
// 42P10: no unique index matches the ON CONFLICT target, i.e. 0083 has not
// been applied yet. Postgres does not name the table in this message.
function isMissingUpsertIndex(err) {
  return err?.code === '42P10'
}
function attachmentPrefix(userId) {
  return `${ATTACHMENT_BLOB_PREFIX}/${userId}/`
}

// Only our own store's hosts are worth a head() call; anything else is a
// client-supplied URL we should reject before it reaches the Blob API.
function parseBlobUrl(value) {
  let url
  try {
    url = new URL(String(value ?? ''))
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  if (url.hostname !== 'vercel-storage.com' && !url.hostname.endsWith('.vercel-storage.com')) {
    return null
  }
  return url.href
}

// POST /api/send?resource=upload-token — mints a short-lived Blob client
// token so the browser can stream attachment bytes straight to storage.
// Proxying them through this function instead would cap attachments at
// Vercel's ~4.5 MB request body limit, well under the 20 MB outbound ceiling.
async function handleAttachmentUploadToken(req, res, userId, services) {
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.end(JSON.stringify({ error: 'Method not allowed' }))
    return
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    res.statusCode = 503
    res.end(JSON.stringify({ error: 'Attachment storage is not configured' }))
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

  let rateLimited = false
  try {
    const sql = services.getSql()
    const result = await services.handleBlobUpload({
      body,
      request: req,
      token: process.env.BLOB_READ_WRITE_TOKEN,
      onBeforeGenerateToken: async (pathname) => {
        // The token is minted for the pathname the client asked for, so a
        // foreign prefix must be refused here — not merely at registration.
        if (!String(pathname ?? '').startsWith(attachmentPrefix(userId))) {
          throw new Error('Attachment pathname is outside the caller prefix')
        }
        const allowed = await services.allowRequest(sql, userId, 'attachment-upload', {
          limit: ATTACHMENT_UPLOADS_PER_MINUTE,
          windowMs: 60_000,
        })
        if (!allowed) {
          rateLimited = true
          throw new Error('Too many attachment uploads')
        }
        return {
          addRandomSuffix: true,
          maximumSizeInBytes: MAX_OUTBOUND_ATTACHMENT_BYTES,
          tokenPayload: JSON.stringify({ userId }),
        }
      },
    })
    res.statusCode = 200
    res.end(JSON.stringify(result))
  } catch (err) {
    if (rateLimited) {
      res.statusCode = 429
      res.end(JSON.stringify({ error: 'Too many attachment uploads, slow down' }))
      return
    }
    console.error('attachment upload token failed:', err)
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'Failed to authorize attachment upload' }))
  }
}

// POST /api/send?resource=attachment — records a client upload that finished.
// head() is the authority on what actually landed: a client that lies about
// its size or content type cannot widen the row beyond the stored blob, and a
// pathname outside the caller's prefix is not theirs to claim.
async function registerUploadedAttachment(req, res, userId, services) {
  let body
  try {
    body = await readJsonBody(req)
  } catch {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'Invalid JSON body' }))
    return
  }

  const blobUrl = parseBlobUrl(body?.url)
  if (!blobUrl) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'A Blob storage url is required' }))
    return
  }

  // Registration costs a Blob head() plus a database write, so it gets the
  // same per-user budget as token minting instead of running unbounded.
  const sql = services.getSql()
  const allowed = await services.allowRequest(sql, userId, 'attachment-register', {
    limit: ATTACHMENT_REGISTRATIONS_PER_MINUTE,
    windowMs: 60_000,
  })
  if (!allowed) {
    res.statusCode = 429
    res.end(JSON.stringify({ error: 'Too many attachment registrations, slow down' }))
    return
  }

  let blob
  try {
    blob = await services.headBlob(blobUrl)
  } catch (err) {
    console.error('attachment head failed:', err.message)
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'Uploaded attachment not found' }))
    return
  }

  if (!String(blob?.pathname ?? '').startsWith(attachmentPrefix(userId))) {
    res.statusCode = 403
    res.end(JSON.stringify({ error: 'Attachment does not belong to this account' }))
    return
  }
  const sizeBytes = Number(blob?.size)
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'Uploaded attachment has no readable size' }))
    return
  }
  if (sizeBytes > MAX_OUTBOUND_ATTACHMENT_BYTES) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'Attachments exceed the allowed size' }))
    return
  }

  // The filename is display-only metadata that also becomes the provider
  // attachment name, so strip path separators and control characters rather
  // than trusting whatever the picker reported.
  const filename = sanitizeAttachmentFilename(body?.filename ?? blob?.pathname)

  const contentType = blob?.contentType ?? null
  try {
    // Idempotent on (user_id, blob_url): a retried registration of the same
    // blob returns the existing row instead of stacking duplicates. The
    // no-op update exists only so ON CONFLICT still RETURNINGs the row, and
    // (xmax = 0) distinguishes the fresh insert from that conflict path.
    let row
    try {
      ;[row] = await sql`
        INSERT INTO outbound_attachments (user_id, filename, content_type, size_bytes, blob_url)
        VALUES (${userId}, ${filename}, ${contentType}, ${sizeBytes}, ${blobUrl})
        ON CONFLICT (user_id, blob_url) DO UPDATE SET blob_url = EXCLUDED.blob_url
        RETURNING id, filename, content_type, size_bytes, (xmax = 0) AS created
      `
    } catch (err) {
      if (!isMissingUpsertIndex(err)) throw err
      // Deploy window before 0083: keep registering with the plain insert.
      ;[row] = await sql`
        INSERT INTO outbound_attachments (user_id, filename, content_type, size_bytes, blob_url)
        VALUES (${userId}, ${filename}, ${contentType}, ${sizeBytes}, ${blobUrl})
        RETURNING id, filename, content_type, size_bytes
      `
    }
    const { created, ...attachment } = row ?? {}
    res.statusCode = created === false ? 200 : 201
    res.end(JSON.stringify({ attachment }))
  } catch (err) {
    if (isUndefinedOutboundAttachmentsTable(err)) {
      res.statusCode = 503
      res.end(JSON.stringify({ error: 'Attachment uploads are not available yet' }))
      return
    }
    throw err
  }
}

// DELETE /api/send?resource=attachment&id=... — drops an upload the user
// removed from the composer before sending.
async function deleteUploadedAttachment(req, res, userId, services) {
  const id = new URL(req.url, 'http://localhost').searchParams.get('id')
  if (!id || !UUID_RE.test(id)) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'A valid attachment id is required' }))
    return
  }

  try {
    const sql = services.getSql()
    const [row] = await sql`
      DELETE FROM outbound_attachments oa
      WHERE oa.id = ${id}::uuid AND oa.user_id = ${userId}
      RETURNING oa.blob_url,
                NOT EXISTS (
                  SELECT 1 FROM attachments a WHERE a.blob_url = oa.blob_url
                )
                AND NOT EXISTS (
                  SELECT 1 FROM outbound_attachments other
                  WHERE other.user_id = oa.user_id
                    AND other.blob_url = oa.blob_url
                    AND other.id <> oa.id
                ) AS "blobUnreferenced"
    `
    if (!row) {
      res.statusCode = 404
      res.end(JSON.stringify({ error: 'Attachment not found' }))
      return
    }
    // Best effort: the row is already gone, and a stranded blob is the
    // orphan sweep's problem rather than a failed removal for the user.
    if (row.blobUnreferenced) {
      try {
        await services.deleteBlob(row.blob_url)
      } catch (err) {
        console.error('failed to delete attachment blob:', err.message)
      }
    }
    res.statusCode = 204
    res.end()
  } catch (err) {
    if (isUndefinedOutboundAttachmentsTable(err)) {
      res.statusCode = 404
      res.end(JSON.stringify({ error: 'Attachment not found' }))
      return
    }
    throw err
  }
}

async function handleAttachment(req, res, userId, services) {
  if (req.method === 'POST') {
    await registerUploadedAttachment(req, res, userId, services)
    return
  }
  if (req.method === 'DELETE') {
    await deleteUploadedAttachment(req, res, userId, services)
    return
  }
  res.statusCode = 405
  res.end(JSON.stringify({ error: 'Method not allowed' }))
}

export function createUploadHandler(overrides = {}) {
  const services = createServices({
    headBlob: (url) => head(url, { token: process.env.BLOB_READ_WRITE_TOKEN }),
    deleteBlob: (url) => del(url, { token: process.env.BLOB_READ_WRITE_TOKEN }),
    handleBlobUpload: handleUpload,
    ...overrides,
  })
  return async function uploadHandler(req, res) {
    let userId
    try {
      ;({ userId } = await services.verifyAccessToken(req))
    } catch (error) {
      writeAuthError(res, error)
      return
    }
    try {
      const resource = new URL(req.url, 'http://localhost').searchParams.get('resource')
      if (resource === 'upload-token') await handleAttachmentUploadToken(req, res, userId, services)
      else await handleAttachment(req, res, userId, services)
    } catch (err) {
      console.error('Attachment request failed:', err.message)
      res.statusCode = 500
      res.end(JSON.stringify({ error: 'Attachment request failed' }))
    }
  }
}
