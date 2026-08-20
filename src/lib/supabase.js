// Realtime-only client: no anon-key data access is relied upon (there is no
// RLS on our tables), it just receives content-free broadcast pings telling
// the app to refetch through the Auth0-protected API. Null when the env vars
// are unset so dev/e2e keep working with live-inbox silently off.
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

let clientPromise

export function getRealtimeClient() {
  if (!url || !anonKey) return Promise.resolve(null)
  if (!clientPromise) {
    clientPromise = import('@supabase/realtime-js').then(
      ({ RealtimeClient }) => new RealtimeClient(realtimeUrl(url), { params: { apikey: anonKey } }),
    )
  }
  return clientPromise
}
