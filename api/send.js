import { createUploadHandler } from './_lib/outboundUploads.js'
export { sanitizeAttachmentFilename } from './_lib/outboundUploads.js'
import { readJsonBody } from './_lib/body.js'

// Preserve the old URL contract while Cookie-Worker owns sending, retries,
// quotas, reminders, and sent-copy persistence for both browser and iOS.
const SEND_URL = 'https://send-api.infinitywave.online/send'
const METHODS = {
  send: ['POST'],
  scheduled: ['GET', 'DELETE'],
  'follow-up': ['PATCH'],
  flush: ['POST'],
}

export function createHandler(overrides = {}) {
  const sendRequest = overrides.fetch ?? globalThis.fetch
  const uploadHandler = createUploadHandler(overrides)
  return async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'no-store')
    const resource =
      new URL(req.url || '/api/send', 'http://localhost').searchParams.get('resource') || 'send'
    if (resource === 'upload-token' || resource === 'attachment') {
      await uploadHandler(req, res)
      return
    }
    if (!Object.hasOwn(METHODS, resource)) {
      res.statusCode = 404
      res.end(JSON.stringify({ error: 'Not Found' }))
      return
    }
    if (!METHODS[resource].includes(req.method)) {
      res.statusCode = 405
      res.setHeader('Allow', METHODS[resource].join(', '))
      res.end(JSON.stringify({ error: 'Method not allowed' }))
      return
    }
    let body
    if (req.method !== 'GET') {
      try {
        body = JSON.stringify(await readJsonBody(req))
      } catch {
        res.statusCode = 400
        res.end(JSON.stringify({ error: 'Invalid JSON body' }))
        return
      }
    }
    try {
      const headers = { 'Content-Type': 'application/json' }
      // Only the caller's bearer credential is forwarded, to this fixed API.
      if (req.headers?.authorization) headers.Authorization = String(req.headers.authorization)
      const response = await sendRequest(
        `${SEND_URL}${resource === 'send' ? '' : `/${resource}`}`,
        {
          method: req.method,
          headers,
          body,
          redirect: 'error',
          signal: AbortSignal.timeout(25_000),
        },
      )
      const payload = await response.text()
      res.statusCode = response.status
      if (response.headers.get('Allow')) res.setHeader('Allow', response.headers.get('Allow'))
      res.end(payload)
    } catch {
      res.statusCode = 502
      res.end(JSON.stringify({ error: 'Sending is temporarily unavailable. Please retry.' }))
    }
  }
}

export default createHandler()
