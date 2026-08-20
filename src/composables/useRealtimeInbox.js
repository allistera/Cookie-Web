import { onScopeDispose, unref, watch } from 'vue'
import {
  browserNotificationPermission,
  browserNotificationsEnabled,
  showNewEmailNotification,
} from '../lib/browserNotifications'

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
  let channelClient = null
  let debounceTimer = null
  let refreshPromise = null
  let refreshUserId = null
  let refreshQueued = false
  let wasDisconnected = false
  let wasHidden = document.hidden
  let lifecycleVersion = 0
  let disposed = false
  const pendingNotificationEventIds = new Set()
  const notificationRetryTimers = new Set()

  function client() {
    return unref(supabase)
  }

  // A background *tab* reliably reports document.hidden. An installed
  // standalone PWA (its own window, no tabs) only goes hidden when minimized
  // or fully occluded — switching focus to another app while it sits visible
  // on screen leaves document.hidden false, so document.hidden alone never
  // fires notifications for an installed app the user isn't looking at.
  // hasFocus() catches that case too.
  function isBackgrounded() {
    return document.hidden || !document.hasFocus()
  }

  function canShowBrowserNotification(userId, version) {
    return (
      !disposed &&
      version === lifecycleVersion &&
      isAuthenticated.value &&
      store.userId === userId &&
      isBackgrounded() &&
      browserNotificationPermission() === 'granted' &&
      browserNotificationsEnabled(userId)
    )
  }

  async function postNotificationEvent(body) {
    const headers = await store.authHeaders({ 'Content-Type': 'application/json' })
    return fetch('/api/notification-event', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
  }

  async function claimNotificationEvent(eventId, userId, version, allowRetry = true) {
    if (!canShowBrowserNotification(userId, version)) return
    try {
      const response = await postNotificationEvent({ action: 'claim', eventId })
      if (response.status === 423 && allowRetry) {
        const retryAfter = Number.parseInt(response.headers?.get?.('Retry-After') || '30', 10)
        const timer = setTimeout(
          () => {
            notificationRetryTimers.delete(timer)
            claimNotificationEvent(eventId, userId, version, false)
          },
          Math.max(1, retryAfter) * 1000,
        )
        notificationRetryTimers.add(timer)
        return
      }
      if (response.status === 204 || response.status === 404) return
      if (!response.ok) throw new Error(`POST /api/notification-event responded ${response.status}`)

      const claimed = await response.json()
      if (!canShowBrowserNotification(userId, version)) return
      const notification = showNewEmailNotification(claimed.message)
      if (!notification) return

      await postNotificationEvent({
        action: 'ack',
        eventId: claimed.eventId,
        claimToken: claimed.claimToken,
      })
    } catch (error) {
      console.error('Failed to process browser notification event:', error)
    }
  }

  function refreshNow() {
    if (!client() || !isAuthenticated.value || !store.userId || store.activeSearchQuery) return
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    if (refreshPromise && refreshUserId === store.userId) {
      refreshQueued = true
      return refreshPromise
    }

    const userId = store.userId
    const version = lifecycleVersion
    const notificationEventIds = [...pendingNotificationEventIds]
    pendingNotificationEventIds.clear()
    const storeRefresh = Promise.resolve(store.refreshInbox())
    const refresh = notificationEventIds.length
      ? storeRefresh.then(() =>
          Promise.all(
            notificationEventIds.map((eventId) => claimNotificationEvent(eventId, userId, version)),
          ),
        )
      : storeRefresh
    refreshPromise = refresh
    refreshUserId = userId
    refresh.finally(() => {
      if (refreshPromise !== refresh) return
      refreshPromise = null
      refreshUserId = null
      if (refreshQueued) {
        refreshQueued = false
        refreshNow()
      }
    })
    return refresh
  }

  function scheduleRefresh() {
    if (store.activeSearchQuery) return
    // Background tabs throttle timers aggressively. If Realtime delivered the
    // ping before suspension, refresh immediately so the unread count (and tab
    // title badge) can update without waiting on the visible-tab debounce.
    if (document.hidden) {
      refreshNow()
      return
    }
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      refreshNow()
    }, DEBOUNCE_MS)
  }

  function teardown() {
    lifecycleVersion += 1
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    if (channel) {
      channelClient?.removeChannel(channel)
      channel = null
      channelClient = null
    }
    wasDisconnected = false
    refreshQueued = false
    pendingNotificationEventIds.clear()
    for (const timer of notificationRetryTimers) clearTimeout(timer)
    notificationRetryTimers.clear()
  }

  function subscribe(userId) {
    teardown()
    channelClient = client()
    channel = channelClient
      .channel(`inbox:${userId}`)
      .on('broadcast', { event: 'inbox-changed' }, (event) => {
        const payload = event?.payload
        const eventId = String(payload?.event_id ?? '')
        if (payload?.op === 'INSERT' && eventId) {
          pendingNotificationEventIds.add(eventId)
        }
        scheduleRefresh()
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // Catch pings missed while offline/reconnecting.
          if (wasDisconnected) refreshNow()
          wasDisconnected = false
        } else {
          wasDisconnected = true
        }
      })
  }

  watch(
    () => [isAuthenticated.value, store.userId, client()],
    ([authenticated, userId, realtime]) => {
      if (authenticated && userId && realtime) {
        subscribe(userId)
      } else {
        teardown()
      }
    },
    { immediate: true },
  )

  // Browsers may freeze a background tab without reporting a Realtime
  // disconnect. In that case broadcasts sent while suspended cannot be
  // replayed, so refetch once when the tab resumes.
  function onVisibilityChange() {
    if (document.hidden) {
      wasHidden = true
    } else if (wasHidden) {
      wasHidden = false
      refreshNow()
    }
  }

  document.addEventListener('visibilitychange', onVisibilityChange)

  onScopeDispose(() => {
    disposed = true
    document.removeEventListener('visibilitychange', onVisibilityChange)
    teardown()
  })
}
