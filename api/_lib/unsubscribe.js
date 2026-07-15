// Parsing and SSRF-hardening for the email unsubscribe feature.
//
// `messages.headers` is sender-controlled, untrusted jsonb: an array of
// { key, value } objects preserving original header casing. Everything here
// treats that input as hostile — malformed shapes and malformed URIs are
// skipped, never thrown.

export { isSafeUnsubscribeUrl } from '../../src/lib/isSafeUnsubscribeUrl.js'

// parseListUnsubscribe(headers)
// Reads the RFC 2369 `List-Unsubscribe` header (comma-separated <uri> entries)
// and the RFC 8058 `List-Unsubscribe-Post` header. Returns the first http(s)
// URI and the first mailto: URI found, plus whether one-click POST is offered.
//
// Returns null when there is no usable URI, else:
//   { oneClick: boolean, url: string|null, mailto: { address, subject }|null }
// oneClick is only true when List-Unsubscribe-Post signals One-Click AND there
// is an http(s) url to POST to.
export function parseListUnsubscribe(headers) {
  if (!Array.isArray(headers)) return null

  const findHeader = (name) => {
    const lower = name.toLowerCase()
    for (const entry of headers) {
      if (
        entry &&
        typeof entry.key === 'string' &&
        entry.key.toLowerCase() === lower &&
        typeof entry.value === 'string'
      ) {
        return entry.value
      }
    }
    return null
  }

  const listUnsub = findHeader('List-Unsubscribe')
  const listUnsubPost = findHeader('List-Unsubscribe-Post')

  let url = null
  let mailto = null

  if (listUnsub) {
    // RFC 2369 wraps each URI in angle brackets: <uri>, <uri>, ...
    const bracketed = listUnsub.match(/<([^>]*)>/g) || []
    for (const raw of bracketed) {
      const uri = raw.slice(1, -1).trim()
      if (!uri) continue
      let parsed
      try {
        parsed = new URL(uri)
      } catch {
        continue // malformed URI — skip, never throw
      }
      const protocol = parsed.protocol.toLowerCase()
      if ((protocol === 'http:' || protocol === 'https:') && url === null) {
        url = uri
      } else if (protocol === 'mailto:' && mailto === null) {
        const address = parsed.pathname.trim()
        if (!address) continue
        const subject = parsed.searchParams.get('subject')
        mailto = { address, subject: subject && subject.length ? subject : null }
      }
    }
  }

  const oneClick = Boolean(
    listUnsubPost &&
      listUnsubPost.trim().toLowerCase() === 'list-unsubscribe=one-click' &&
      url,
  )

  if (url === null && mailto === null) return null
  return { oneClick, url, mailto }
}
