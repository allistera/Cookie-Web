import { SEND_API_URL } from './apiWorkers'

// Mirrors MAX_OUTBOUND_ATTACHMENT_BYTES on cookie-web-send (Cookie-Worker,
// workers/cookie-web-send/src/outbound.js). Checking here too keeps an
// oversized pick from spending the user's upload allowance on a request the
// Worker would refuse anyway.
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
export const MAX_ATTACHMENTS = 20

// The same route the iOS composer posts to, so both clients share one upload
// contract, rate limit and ownership rule on the send Worker.
export const ATTACHMENTS_URL = `${SEND_API_URL}/send/attachments`

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
 * Posts one picked file to the send Worker as multipart form data. The Worker
 * stores the bytes privately and records the upload in the same call, so the
 * returned row is ready for a draft's attachmentIds or POST /send. The blob
 * url never reaches the browser; every later read of this attachment is
 * metadata only.
 *
 * Not retried: the upload is the registration, so a repeat after an ambiguous
 * failure would store the file twice. The caller reports the failure and the
 * user picks the file again.
 *
 * @returns the stored attachment row: { id, filename, content_type, size_bytes }
 */
export async function uploadAttachment(file, { authHeaders, fetchImpl = fetch } = {}) {
  const sizeError = attachmentSizeError(file)
  if (sizeError) throw new Error(sizeError)

  // No Content-Type here: the browser sets multipart/form-data with the
  // boundary it chose, which a hand-written header would break.
  const headers = await authHeaders()
  const body = new FormData()
  body.append('file', file, file.name)
  const response = await fetchImpl(ATTACHMENTS_URL, { method: 'POST', headers, body })
  if (!response.ok) {
    const result = await response.json().catch(() => ({}))
    throw new Error(result?.error || `POST /send/attachments responded ${response.status}`)
  }
  const { attachment } = await response.json()
  return attachment
}
