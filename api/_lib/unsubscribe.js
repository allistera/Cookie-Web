// Parsing and SSRF-hardening for the email unsubscribe feature.
//
// `messages.headers` is sender-controlled, untrusted jsonb: an array of
// { key, value } objects preserving original header casing. Everything here
// treats that input as hostile — malformed shapes and malformed URIs are
// skipped, never thrown.

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

// isSafeUnsubscribeUrl(url)
// SSRF guard for the server-side one-click POST. The sender controls this URL,
// so it must not be able to point our outbound request at internal
// infrastructure (cloud metadata endpoints, private ranges, loopback, etc.).
//
// Rejects unless ALL hold: parses as a URL; protocol is exactly https:; no
// embedded credentials; default port (empty); hostname is not an IP literal
// (v4 or v6, including bracketed or numeric shorthand), not localhost, not a
// private/internal-style name (localhost, *.localhost, *.local, *.internal,
// *.lan, *.home.arpa), and contains at least one dot with a non-numeric TLD.
//
// NOTE: This is name/literal filtering only. It does NOT protect against
// DNS rebinding or a public hostname whose A record resolves to a private IP —
// that (resolve-then-pin) level of protection is intentionally out of scope.
export function isSafeUnsubscribeUrl(url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  if (parsed.protocol !== 'https:') return false
  if (parsed.username || parsed.password) return false
  if (parsed.port !== '') return false

  const host = parsed.hostname.toLowerCase()

  // IPv6 literals are kept bracketed by the URL parser, e.g. "[::1]".
  if (host.startsWith('[') || host.endsWith(']')) return false
  // Dotted-quad IPv4 literals (covers loopback, RFC 1918, link-local, public).
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false
  // Single-label hosts: localhost, intranet, bare integers, etc.
  if (!host.includes('.')) return false

  // Reject anything whose rightmost label is all digits: catches IPv4
  // shorthand ("127.1") and decimal IP forms while never matching a real
  // domain (public TLDs are always alphabetic).
  const labels = host.split('.')
  if (/^\d+$/.test(labels[labels.length - 1])) return false

  if (host === 'localhost') return false
  const blockedSuffixes = ['.localhost', '.local', '.internal', '.lan', '.home.arpa']
  for (const suffix of blockedSuffixes) {
    if (host.endsWith(suffix)) return false
  }

  return true
}
