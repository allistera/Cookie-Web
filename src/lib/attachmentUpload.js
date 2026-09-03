import { upload } from '@vercel/blob/client'

// Mirrors MAX_OUTBOUND_ATTACHMENT_BYTES and MAX_OUTBOUND_ATTACHMENTS in
// api/send.js. Checking here too keeps an oversized pick from spending the
// user's upload allowance on a request the send would reject anyway.
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
export const MAX_ATTACHMENTS = 20

const UPLOAD_TOKEN_URL = '/api/send?resource=upload-token'

// The server mints a token only for a pathname under the caller's own prefix,
// so this has to match api/send.js's attachmentPrefix() exactly. The visible
// filename the recipient sees is sanitised server-side from the name sent
// alongside the registration call; this only has to be a safe object key.
export function attachmentPathname(userId, filename) {
  const base = String(filename ?? '')
    .split(/[/\\]/)
    .pop()
  const safeName = base.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120)
  return `outbound-attachments/${userId}/${safeName || 'attachment'}`
}

export function attachmentSizeError(file) {
  if (!file || typeof file.size !== 'number') return 'That file could not be read.'
  if (file.size === 0) return 'That file is empty.'
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return `Attachments are limited to ${MAX_ATTACHMENT_BYTES / 1024 / 1024}MB.`
  }
  return null
}

/**
 * Streams one picked file straight to Blob storage under a short-lived token,
 * then registers it so the send API can resolve it by id. The blob url the
 * upload returns is handed to the server and deliberately not kept: every
 * later read of this attachment is metadata only.
 *
 * @returns the stored attachment row: { id, filename, content_type, size_bytes }
 */
export async function uploadAttachment(
  file,
  { userId, authHeaders, uploader = upload, fetchImpl = fetch, onProgress } = {},
) {
  if (!userId) throw new Error('Mailbox is still loading; attachments are not ready yet')
  const sizeError = attachmentSizeError(file)
  if (sizeError) throw new Error(sizeError)

  const headers = await authHeaders()
  const blob = await uploader(attachmentPathname(userId, file.name), file, {
    access: 'private',
    handleUploadUrl: UPLOAD_TOKEN_URL,
    contentType: file.type || 'application/octet-stream',
    headers,
    ...(onProgress ? { onUploadProgress: onProgress } : {}),
  })

  const registerHeaders = await authHeaders({ 'Content-Type': 'application/json' })
  const response = await fetchImpl('/api/send?resource=attachment', {
    method: 'POST',
    headers: registerHeaders,
    body: JSON.stringify({ url: blob.url, filename: file.name }),
  })
  if (!response.ok) {
    throw new Error(`POST /api/send?resource=attachment responded ${response.status}`)
  }
  const { attachment } = await response.json()
  return attachment
}
