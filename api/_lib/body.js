// Vercel parses JSON bodies into req.body; the local Vite middleware hands us
// the raw stream. Support both.
export async function readJsonBody(req) {
  if (req.body !== undefined) {
    return typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  }
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
  }
  return raw ? JSON.parse(raw) : {}
}
