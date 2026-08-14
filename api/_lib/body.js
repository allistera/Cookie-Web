// Matches Vercel's own ~4.5 MB serverless function request body limit, so a
// request that would be rejected in production behaves the same way against
// the local Vite dev middleware's raw stream, which has no size limit of its
// own to fall back on.
const MAX_BODY_BYTES = 4.5 * 1024 * 1024

// Vercel parses JSON bodies into req.body; the local Vite middleware hands us
// the raw stream. Support both.
export async function readJsonBody(req) {
  if (req.body !== undefined) {
    return req.body instanceof Object ? req.body : JSON.parse(req.body)
  }
  let raw = ''
  let bytes = 0
  for await (const chunk of req) {
    bytes += chunk.length
    if (bytes > MAX_BODY_BYTES) throw new Error('Request body too large')
    raw += chunk
  }
  return raw ? JSON.parse(raw) : {}
}
