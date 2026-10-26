import { realtimeAccessToken } from './supabase.js'

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
// The URL and apikey params mirror supabase-js's own _initRealtimeClient. App.vue
// imports this module after sign-in, which keeps it out of the entry chunk.
const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

function realtimeUrl(base) {
  const target = new URL('realtime/v1', base)
  target.protocol = target.protocol.replace('http', 'ws')
  return target.href
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
