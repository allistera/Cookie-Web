import { getAuth0 } from '../auth0-client'

// Realtime client for the inbox's private broadcast channel. It carries only
// content-free "inbox changed" pings that tell the app to refetch through the
// Auth0-protected Workers. Every public table has RLS enabled with no policies,
// so the anon and authenticated roles see no rows, and the app reads no data
// through the Supabase Data API.
//
// Migration 0105 made each ping a private broadcast on `inbox:<users.id>`. The
// server delivers it only to a socket whose JWT has role `authenticated` and
// whose `sub` equals users.auth0_sub. The anon key still goes in the URL as the
// apikey, but a subscription needs the user's Auth0 ID token, which carries the
// role claim: the composable sets it with setAuth before joining, and the
// accessToken callback below keeps it renewed on the socket.
//
// Null when the env vars are unset so dev/e2e keep working with live-inbox
// silently off.
//
// Deliberately RealtimeClient rather than @supabase/supabase-js createClient:
// the full client drags auth-js/storage-js/postgrest-js into the entry chunk
// (~45 KB gzipped) for .channel()/.removeChannel(), the only API used here.
// The URL and apikey params mirror supabase-js's own _initRealtimeClient.
const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

function realtimeUrl(base) {
  const target = new URL('realtime/v1', base)
  target.protocol = target.protocol.replace('http', 'ws')
  return target.href
}

// The Auth0 ID token for the Realtime socket. Supabase reads the `role` claim
// from it, and Auth0 strips non-namespaced claims from access tokens. It rejects
// when there is no token (no Auth0 client, or a dead session) and never
// redirects to login. The socket calls it on connect and on every heartbeat, so
// a renewed token reaches the server before the old one expires. Because it
// rejects on failure, realtime-js keeps the last good token rather than clearing
// it.
const ID_TOKEN_RENEW_BEFORE_MS = 60 * 1000

// Reads `exp` from the ID token payload. The signature is not checked here,
// because Supabase verifies the token when the socket authenticates.
function idTokenExpiresAt(idToken) {
  const payload = idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
  return JSON.parse(atob(payload)).exp * 1000
}

export async function realtimeAccessToken() {
  const auth0 = getAuth0()
  if (!auth0) throw new Error('Auth0 is not configured')
  let tokens = await auth0.getAccessTokenSilently({ detailedResponse: true })
  // The ID token can expire before the access token, so renew it when it is
  // close to expiry instead of sending the old one.
  if (
    !tokens?.id_token ||
    idTokenExpiresAt(tokens.id_token) - Date.now() < ID_TOKEN_RENEW_BEFORE_MS
  ) {
    tokens = await auth0.getAccessTokenSilently({
      detailedResponse: true,
      cacheMode: 'off',
    })
  }
  if (!tokens?.id_token) throw new Error('Missing ID token')
  return tokens.id_token
}

let clientPromise

export function getRealtimeClient() {
  if (!url || !anonKey) return Promise.resolve(null)
  if (!clientPromise) {
    clientPromise = import('@supabase/realtime-js').then(
      ({ RealtimeClient }) =>
        new RealtimeClient(realtimeUrl(url), {
          params: { apikey: anonKey },
          accessToken: realtimeAccessToken,
        }),
    )
  }
  return clientPromise
}
