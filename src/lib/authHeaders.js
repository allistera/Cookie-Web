import { getAuth0 } from '../auth0-client'

// Auth0 errors that mean the stored session is gone for good. Retrying cannot
// help: the refresh token has been rotated out, revoked or never stored, and
// every request will keep failing until the person signs in again.
const DEAD_SESSION_CODES = new Set([
  'invalid_grant',
  'login_required',
  'consent_required',
  'missing_refresh_token',
])

// auth0-spa-js throws MissingRefreshTokenError with no `error` code, so the
// message is the only thing identifying it.
const DEAD_SESSION_MESSAGES = [/missing refresh token/i, /invalid refresh token/i]

/** @param {any} error */
export function isDeadSession(error) {
  if (DEAD_SESSION_CODES.has(String(error?.error ?? ''))) return true
  const message = String(error?.message ?? '')
  return DEAD_SESSION_MESSAGES.some((pattern) => pattern.test(message))
}

// One redirect per client. Every store fetches on boot, so a dead session
// throws several times at once and four concurrent redirects would fight each
// other. Keyed on the client rather than held as a module flag so a new client
// — a new sign-in attempt — starts clean.
const redirecting = new WeakSet()

/**
 * Bearer-token headers for a Worker call, plus whatever `extra` carries.
 *
 * A dead session is the case worth handling: the cached ID token still says
 * "signed in", so the app renders normally while every request fails, leaving
 * a working-looking app that never loads anything. Sending the person to log
 * in is the only thing that fixes it, so this does that rather than letting
 * each store report its own generic failure.
 *
 * The error is always rethrown: the caller's own error path still has to run,
 * because the redirect is a navigation that may not happen for a moment (or
 * at all, if it is blocked).
 *
 * @param {Record<string, string>} extra
 */
export async function authHeaders(extra = {}) {
  const headers = { ...extra }
  const auth0 = getAuth0()
  if (!auth0) return headers

  try {
    headers.Authorization = `Bearer ${await auth0.getAccessTokenSilently()}`
  } catch (error) {
    if (isDeadSession(error) && !redirecting.has(auth0)) {
      redirecting.add(auth0)
      try {
        await auth0.loginWithRedirect()
      } catch (redirectError) {
        console.error('Failed to start a new sign-in after the session expired:', redirectError)
      }
    }
    throw error
  }
  return headers
}
