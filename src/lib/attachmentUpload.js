// Mirrors MAX_OUTBOUND_ATTACHMENT_BYTES and MAX_OUTBOUND_ATTACHMENTS in
// api/send.js. Checking here too keeps an oversized pick from spending the
// user's upload allowance on a request the send would reject anyway.
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
export const MAX_ATTACHMENTS = 20

const UPLOAD_TOKEN_URL = '/api/send?resource=upload-token'
const REGISTER_RETRY_DELAYS_MS = [500, 1500]

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
  const reportedSize = file?.size
  if (reportedSize === null || reportedSize === undefined) return 'That file could not be read.'
  const size = Number(reportedSize)
  if (!Number.isFinite(size) || size < 0) return 'That file could not be read.'
  if (size === 0) return 'That file is empty.'
  if (size > MAX_ATTACHMENT_BYTES) {
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
  {
    userId,
    authHeaders,
    uploader,
    fetchImpl = fetch,
    onProgress,
    retryDelaysMs = REGISTER_RETRY_DELAYS_MS,
  } = {},
) {
  if (!userId) throw new Error('Mailbox is still loading; attachments are not ready yet')
  const sizeError = attachmentSizeError(file)
  if (sizeError) throw new Error(sizeError)

  const headers = await authHeaders()
  const uploadOptions = {
    access: 'private',
    handleUploadUrl: UPLOAD_TOKEN_URL,
    contentType: file.type || 'application/octet-stream',
    headers,
  }
  if (onProgress) uploadOptions.onUploadProgress = onProgress
  const upload = uploader ?? (await import('@vercel/blob/client')).upload
  const blob = await upload(attachmentPathname(userId, file.name), file, uploadOptions)

  // The blob is already stored at this point, so a transient registration
  // failure would orphan it. Registration is idempotent on the blob url, so
  // a network error or 5xx is retried a couple of times before giving up. A
  // 429 is not retried: the server's window is a minute, far longer than this
  // backoff, so a quick retry would only spend more of an exhausted budget.
  for (let attempt = 0; ; attempt += 1) {
    const registerHeaders = await authHeaders({ 'Content-Type': 'application/json' })
    let response
    let error
    try {
      response = await fetchImpl('/api/send?resource=attachment', {
        method: 'POST',
        headers: registerHeaders,
        body: JSON.stringify({ url: blob.url, filename: file.name }),
      })
    } catch (fetchError) {
      error = fetchError
    }
    if (response?.ok) {
      const { attachment } = await response.json()
      return attachment
    }
    if (response) {
      error = new Error(`POST /api/send?resource=attachment responded ${response.status}`)
    }
    const retryable = !response || response.status >= 500
    if (!retryable || attempt >= retryDelaysMs.length) throw error
    await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[attempt]))
  }
}
