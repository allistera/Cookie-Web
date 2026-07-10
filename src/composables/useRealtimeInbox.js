import { watch, onScopeDispose } from 'vue'

const DEBOUNCE_MS = 1500

// Subscribes to the authenticated user's content-free Realtime "inbox
// changed" channel and refreshes the inbox store through the normal
// Auth0-protected API when a ping arrives. Requires: authenticated, a known
// store.userId (set from GET /api/emails), and a non-null supabase client
// (it's null when VITE_SUPABASE_URL/ANON_KEY are unset — dev/e2e run with
// live-inbox silently off). Re-subscribes whenever userId or auth state
// changes, and cleans up on scope dispose.
export function useRealtimeInbox(store, supabase, isAuthenticated) {
  let channel = null
  let debounceTimer = null
  let wasDisconnected = false

  function scheduleRefresh() {
    if (store.activeSearchQuery) return
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      if (store.activeSearchQuery) return
      store.refreshInbox()
    }, DEBOUNCE_MS)
  }

  function teardown() {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    if (channel) {
      supabase.removeChannel(channel)
      channel = null
    }
    wasDisconnected = false
  }

  function subscribe(userId) {
    teardown()
    channel = supabase
      .channel(`inbox:${userId}`)
      .on('broadcast', { event: 'inbox-changed' }, () => {
        scheduleRefresh()
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // Catch pings missed while offline/reconnecting.
          if (wasDisconnected) store.refreshInbox()
          wasDisconnected = false
        } else {
          wasDisconnected = true
        }
      })
  }

  watch(
    () => [isAuthenticated.value, store.userId],
    ([authenticated, userId]) => {
      if (authenticated && userId && supabase) {
        subscribe(userId)
      } else {
        teardown()
      }
    },
    { immediate: true },
  )

  onScopeDispose(teardown)
}
