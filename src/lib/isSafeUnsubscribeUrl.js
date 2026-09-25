// Shared policy for unsubscribe URLs exposed in app chrome or fetched by the
// server. Sender-controlled targets must be public HTTPS URLs with no embedded
// credentials or non-default port.
export function isSafeUnsubscribeUrl(url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port !== '') {
    return false
  }

  // A fully qualified name may end in a dot ("intranet.local.") and still
  // resolve to the same host, so strip it before the blocked-host checks.
  const host = parsed.hostname.toLowerCase().replace(/\.+$/, '')
  if (host.startsWith('[') || host.endsWith(']')) return false
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false
  if (!host.includes('.')) return false

  const labels = host.split('.')
  if (/^\d+$/.test(labels.at(-1))) return false

  const blockedSuffixes = ['.localhost', '.local', '.internal', '.lan', '.home.arpa']
  return !blockedSuffixes.some((suffix) => host.endsWith(suffix))
}
