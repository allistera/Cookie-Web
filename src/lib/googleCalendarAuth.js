// The verifier never enters a consent/callback URL. It belongs to the tab
// that started linking and expires alongside the server's OAuth transaction.
const KEY = 'cookie.google-authorization'
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/
const TTL_MS = 10 * 60 * 1000

export function clearGoogleAuthorization(storage = globalThis.sessionStorage) {
  try {
    storage.removeItem(KEY)
  } catch {
    // Clearing a transaction must not prevent logout in a storage-blocked tab.
  }
}

export function rememberGoogleAuthorization(verifier, storage = globalThis.sessionStorage) {
  if (!TOKEN_RE.test(String(verifier))) throw new Error('Invalid sign-in verifier')
  storage.setItem(KEY, JSON.stringify({ verifier, startedAt: Date.now() }))
}

export function pendingGoogleAuthorization(completion, storage = globalThis.sessionStorage) {
  let pending
  try {
    pending = JSON.parse(storage.getItem(KEY))
  } catch {
    return null
  }
  if (
    !pending ||
    !TOKEN_RE.test(String(pending.verifier)) ||
    !Number.isFinite(pending.startedAt) ||
    Date.now() - pending.startedAt >= TTL_MS ||
    pending.startedAt > Date.now()
  ) {
    clearGoogleAuthorization(storage)
    return null
  }
  if (completion !== undefined) {
    if (!TOKEN_RE.test(String(completion))) return null
    pending.completion = completion
    // Keep this when authHeaders starts a new Auth0 login, after the callback
    // fragment has been removed from the address bar.
    storage.setItem(KEY, JSON.stringify(pending))
  }
  return TOKEN_RE.test(String(pending.completion)) ? pending : null
}
