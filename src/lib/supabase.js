import { getAuth0 } from '../auth0-client'

// The Auth0 ID token for the Realtime socket. It rejects when there is no token
// (no Auth0 client, or a dead session) and never redirects to login. The socket
// calls it on connect and on every heartbeat, so a renewed token reaches the
// server before the old one expires. Because it rejects on failure, realtime-js
// keeps the last good token rather than clearing it. The token logic is imported
// on first use to keep the entry chunk within its budget.
export async function realtimeAccessToken() {
  const auth0 = getAuth0()
  if (!auth0) throw new Error('Auth0 is not configured')
  const { currentIdToken } = await import('./idToken.js')
  return currentIdToken(auth0)
}
