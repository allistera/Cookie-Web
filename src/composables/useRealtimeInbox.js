import { onScopeDispose, unref, watch } from 'vue'
import {
  browserNotificationPermission,
  browserNotificationsEnabled,
  showNewEmailNotification,
} from '../lib/browserNotifications'
import { NOTIFICATIONS_API_URL } from '../lib/apiWorkers'
import { realtimeAccessToken } from '../lib/supabase'

const DEBOUNCE_MS = 1500
const NOTIFICATION_CLAIM_RETRIES = 60
// A tab hidden for less than this was alt-tabbed, not frozen: its Realtime
// channel stayed up and delivered every ping, so resuming has nothing to
// catch up on. Browsers only start freezing background tabs after minutes.
export const RESUME_REFRESH_AFTER_MS = 60_000

// Pings are coalesced into at most one refresh per interval, hidden tab or
// not, so a burst of pings costs the API a refetch every few seconds, not one
// per ping.
export const BROADCAST_REFRESH_INTERVAL_MS = 5000
// While the channel is not SUBSCRIBED, the inbox is refreshed at this interval
// and the join is retried with a fresh token, so mail still arrives when
// realtime is down.
export const REALTIME_FALLBACK_INTERVAL_MS = 3 * 60 * 1000
// Each INSERT ping may name an event to claim. Cap how many claims one refresh
// may POST, so a burst of pings cannot flood the notification endpoint. Real
// inserts rarely burst past it.
export const MAX_PENDING_NOTIFICATION_EVENTS = 10
const PING_OPS = new Set(['INSERT', 'UPDATE', 'DELETE'])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// The trigger only ever sends {op, event_id?}; anything else on the channel is
// not ours, so it parses to null and is ignored.
function parsePing(payload) {
  const op = payload?.op
  if (!PING_OPS.has(op)) return null
  if (payload.event_id === undefined) return { op, eventId: null }
  const eventId = String(payload.event_id)
  return UUID_RE.test(eventId) ? { op, eventId } : null
}

// Subscribes to the authenticated user's content-free Realtime "inbox
// changed" channel and refreshes the inbox store through the normal
// Auth0-protected API when a ping arrives. Requires: authenticated, a known
// store.userId (set from GET /emails), and a non-null supabase client
// (it's null when VITE_SUPABASE_URL/ANON_KEY are unset — dev/e2e run with
// live-inbox silently off). The channel is private, so each join first sets
// the Auth0 access token from getAccessToken and joins only if one is
// available. Until the channel is SUBSCRIBED, a fallback timer refreshes the
// inbox and retries the join. Re-subscribes whenever userId or auth state
// changes, and cleans up on scope dispose.
export function useRealtimeInbox(
  store,
  supabase,
  isAuthenticated,
  getAccessToken = realtimeAccessToken,
) {
  let channel = null
  let channelClient = null
  // The latest removal of a previous channel. realtime-js keeps a channel in
  // the client until its leave completes, so a join waits for this first.
  let detaching = Promise.resolve()
  let joinAttempt = 0
  let fallbackTimer = null
  let debounceTimer = null
  let refreshPromise = null
  let refreshUserId = null
  let refreshQueued = false
  let lastBroadcastRefreshAt = -Infinity
  // An UPDATE ping (flags, labels, AI drafts) rarely touches the open
  // thread's body; an INSERT/DELETE, or a catch-up after missed pings, may.
  let openThreadDirty = false
  let wasDisconnected = false
  let hiddenAt = document.hidden ? Date.now() : null
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
    return fetch(`${NOTIFICATIONS_API_URL}/notification-event`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
  }

  async function claimNotificationEvent(
    eventId,
    userId,
    version,
    retriesRemaining = NOTIFICATION_CLAIM_RETRIES,
  ) {
    if (!canShowBrowserNotification(userId, version)) return
    try {
      const response = await postNotificationEvent({ action: 'claim', eventId })
      if ((response.status === 423 || response.status === 425) && retriesRemaining > 0) {
        const retryAfter = Number.parseInt(response.headers?.get?.('Retry-After') || '30', 10)
        const timer = setTimeout(
          () => {
            notificationRetryTimers.delete(timer)
            claimNotificationEvent(eventId, userId, version, retriesRemaining - 1)
          },
          Math.max(1, retryAfter) * 1000,
        )
        notificationRetryTimers.add(timer)
        return
      }
      if (response.status === 204 || response.status === 404) return
      if (!response.ok) throw new Error(`POST /notification-event responded ${response.status}`)

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

  // The open email's inbox row as of now, or null when it isn't listed
  // there (opened from another folder or search) and so can't be compared.
  function openRowSignature() {
    const id = store.openEmailId
    const row = id ? store.traditionalEmails.find((email) => email.id === id) : null
    return row ? JSON.stringify(row) : null
  }

  // Refetch the open body only when the thread may have changed: always for
  // a structural ping or catch-up, otherwise only when the refreshed inbox
  // page changed the open email's row.
  function refreshStore(threadDirty) {
    if (store.activeSearchQuery) return Promise.resolve(store.refreshOpenThread())
    const before = openRowSignature()
    const inboxRefresh = Promise.resolve(store.refreshInbox())
    const threadRefresh =
      threadDirty || before === null
        ? Promise.resolve(store.refreshOpenThread())
        : inboxRefresh.then(() =>
            openRowSignature() === before ? undefined : store.refreshOpenThread(),
          )
    return Promise.all([inboxRefresh, threadRefresh])
  }

  // Visibility/reconnect catch-ups may have missed any kind of ping.
  function catchUp() {
    openThreadDirty = true
    refreshNow()
  }

  function refreshNow() {
    if (!client() || !isAuthenticated.value || !store.userId) return
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
    const threadDirty = openThreadDirty
    openThreadDirty = false
    const storeRefresh = refreshStore(threadDirty)
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

  function broadcastRefresh() {
    lastBroadcastRefreshAt = Date.now()
    refreshNow()
  }

  function scheduleRefresh() {
    // A refresh is already scheduled; it picks this ping up too.
    if (debounceTimer) return
    // Background tabs throttle timers aggressively. If Realtime delivered the
    // ping before suspension, refresh immediately so the unread count (and tab
    // title badge) can update without waiting on the visible-tab debounce —
    // unless a broadcast refresh ran within the last interval.
    const sinceLast = Date.now() - lastBroadcastRefreshAt
    const wait = Math.max(
      document.hidden ? 0 : DEBOUNCE_MS,
      BROADCAST_REFRESH_INTERVAL_MS - sinceLast,
    )
    if (wait <= 0) {
      broadcastRefresh()
      return
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      broadcastRefresh()
    }, wait)
  }

  // The Realtime token, or null when none can be had. It never triggers a
  // login: a dead session leaves the channel unjoined until the fallback retries.
  async function fetchAccessToken() {
    try {
      return await getAccessToken()
    } catch {
      return null
    }
  }

  function startFallback() {
    fallbackTimer ??= setInterval(fallbackTick, REALTIME_FALLBACK_INTERVAL_MS)
  }

  function stopFallback() {
    clearInterval(fallbackTimer)
    fallbackTimer = null
  }

  // Runs while the channel is not SUBSCRIBED. It retries the join with a fresh
  // token, because a join that never happened, or a channel the server closed,
  // does not recover by itself. Then it refreshes the inbox. The open thread is
  // refetched only if its row changed, not on every tick, because this runs
  // every few minutes for as long as realtime is down.
  function fallbackTick() {
    const userId = store.userId
    if (isAuthenticated.value && userId && client()) subscribe(userId)
    refreshNow()
  }

  function detachChannel() {
    if (channel) detaching = channelClient.removeChannel(channel)
    channel = null
    channelClient = null
  }

  function teardown() {
    lifecycleVersion += 1
    joinAttempt += 1
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    detachChannel()
    stopFallback()
    wasDisconnected = false
    refreshQueued = false
    openThreadDirty = false
    pendingNotificationEventIds.clear()
    for (const timer of notificationRetryTimers) clearTimeout(timer)
    notificationRetryTimers.clear()
  }

  // Joins the user's private inbox channel. The client is authenticated before
  // the join, so the server accepts the subscription. Without a token nothing
  // is joined, and the fallback timer keeps running.
  async function subscribe(userId) {
    const attempt = (joinAttempt += 1)
    detachChannel()
    startFallback()
    try {
      await detaching
      const token = await fetchAccessToken()
      const realtime = client()
      if (attempt !== joinAttempt || !token || !realtime) return
      await realtime.setAuth(token)
      if (attempt !== joinAttempt) return

      const created = realtime
        .channel(`inbox:${userId}`, { config: { private: true } })
        .on('broadcast', { event: 'inbox-changed' }, (event) => {
          const ping = parsePing(event?.payload)
          if (!ping) return
          if (ping.op !== 'UPDATE') openThreadDirty = true
          if (
            ping.op === 'INSERT' &&
            ping.eventId &&
            pendingNotificationEventIds.size < MAX_PENDING_NOTIFICATION_EVENTS
          ) {
            pendingNotificationEventIds.add(ping.eventId)
          }
          scheduleRefresh()
        })
      channel = created
      channelClient = realtime
      created.subscribe((status) => {
        if (channel !== created) return
        if (status === 'SUBSCRIBED') {
          stopFallback()
          // Catch pings missed while offline/reconnecting.
          if (wasDisconnected) catchUp()
          wasDisconnected = false
        } else {
          wasDisconnected = true
          startFallback()
        }
      })
    } catch (error) {
      console.error('Failed to subscribe to the inbox realtime channel:', error)
    }
  }

  watch(
    () => [isAuthenticated.value, store.userId, client()],
    ([authenticated, userId, realtime]) => {
      teardown()
      if (authenticated && userId && realtime) subscribe(userId)
    },
    { immediate: true },
  )

  // Browsers may freeze a background tab without reporting a Realtime
  // disconnect. In that case broadcasts sent while suspended cannot be
  // replayed, so refetch once when the tab resumes — but only after a spell
  // long enough to have been a suspension, not every alt-tab.
  function onVisibilityChange() {
    if (document.hidden) {
      hiddenAt = Date.now()
    } else if (hiddenAt !== null) {
      const hiddenFor = Date.now() - hiddenAt
      hiddenAt = null
      if (hiddenFor >= RESUME_REFRESH_AFTER_MS) catchUp()
    }
  }

  document.addEventListener('visibilitychange', onVisibilityChange)

  onScopeDispose(() => {
    disposed = true
    document.removeEventListener('visibilitychange', onVisibilityChange)
    teardown()
  })
}
