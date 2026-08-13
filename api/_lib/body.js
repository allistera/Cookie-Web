// Vercel parses JSON bodies into req.body; the local Vite middleware hands us
// the raw stream. Support both.
export async function readJsonBody(req) {
  if (req.body !== undefined) {
    return req.body instanceof Object ? req.body : JSON.parse(req.body)
  }
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
  }
  return raw ? JSON.parse(raw) : {}
}
