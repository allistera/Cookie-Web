import { getDownloadUrl, issueSignedToken, presignUrl } from '@vercel/blob'

import { verifyAccessToken } from './_lib/auth.js'
import { getSql } from './_lib/db.js'
import { captureApiError } from './_lib/sentry.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SIGNED_URL_TTL_MS = 5 * 60 * 1000

export function fetchOwnedAttachment(sql, id, email) {
  return sql`
    SELECT a.filename, a.content_type, a.blob_url
    FROM attachments a
    JOIN messages m ON m.id = a.message_id
    JOIN users u ON u.id = m.user_id
    WHERE a.id = ${id} AND lower(u.email) = ${email}
  `
}

export function privateBlobPathname(blobUrl) {
  const url = new URL(blobUrl)
  if (!url.hostname.endsWith('.private.blob.vercel-storage.com')) {
    throw new Error('Attachment does not reference private Blob storage')
  }
  return decodeURIComponent(url.pathname.replace(/^\//, ''))
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'private, no-store')

  if (req.method !== 'GET') {
    res.statusCode = 405
    res.end(JSON.stringify({ error: 'Method not allowed' }))
    return
  }

  let email
  try {
    ;({ email } = await verifyAccessToken(req))
  } catch {
    res.statusCode = 401
    res.end(JSON.stringify({ error: 'Unauthorized' }))
    return
  }

  const id = new URL(req.url, 'http://localhost').searchParams.get('id')
  if (typeof id !== 'string' || !UUID_RE.test(id)) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'A valid attachment id is required' }))
    return
  }

  try {
    const rows = await fetchOwnedAttachment(getSql(), id, email)
    const attachment = rows[0]
    if (!attachment?.blob_url) {
      res.statusCode = 404
      res.end(JSON.stringify({ error: 'Attachment is not available' }))
      return
    }

    const pathname = privateBlobPathname(attachment.blob_url)
    const validUntil = Date.now() + SIGNED_URL_TTL_MS
    const signedToken = await issueSignedToken({
      pathname,
      operations: ['get'],
      validUntil,
    })
    const { presignedUrl } = await presignUrl(signedToken, {
      access: 'private',
      operation: 'get',
      pathname,
      validUntil,
    })

    res.statusCode = 200
    res.end(
      JSON.stringify({
        url: getDownloadUrl(presignedUrl),
        filename: attachment.filename || 'attachment',
        contentType: attachment.content_type || 'application/octet-stream',
      }),
    )
  } catch (error) {
    console.error('GET /api/attachments failed:', error)
    await captureApiError(error, { route: 'GET /api/attachments' })
    res.statusCode = 500
    res.end(JSON.stringify({ error: 'Failed to prepare attachment download' }))
  }
}
