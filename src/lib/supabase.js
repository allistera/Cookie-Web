import { createClient } from '@supabase/supabase-js'

// Realtime-only client: no anon-key data access is relied upon (there is no
// RLS on our tables), it just receives content-free broadcast pings telling
// the app to refetch through the Auth0-protected API. Null when the env vars
// are unset so dev/e2e keep working with live-inbox silently off.
const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = url && anonKey ? createClient(url, anonKey) : null
