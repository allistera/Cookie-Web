import { effectScope, nextTick, ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { describe, beforeEach, afterEach, it, expect, vi } from 'vitest'

import { useRealtimeInbox } from '../useRealtimeInbox'
import { useTitleUnreadBadge } from '../useTitleUnreadBadge'
import { useInboxStore } from '../../stores/inbox'
import { NOTIFICATIONS_API_URL } from '../../lib/apiWorkers'

const BASE_TITLE = 'Cookie AI Inbox - Workspace Intelligence'

// Minimal chainable stand-in for the supabase-js RealtimeChannel API used by
// the composable: .channel(name).on('broadcast', ...).subscribe(statusCb).
function makeMockClient() {
  let onBroadcast
  let onStatus
  const channelObj = {
    on: vi.fn((type, _filter, cb) => {
      if (type === 'broadcast') onBroadcast = cb
      return channelObj
    }),
    subscribe: vi.fn((cb) => {
      onStatus = cb
      return channelObj
    }),
  }
  return {
    channel: vi.fn(() => channelObj),
    removeChannel: vi.fn(),
    channelObj,
    ping(payload = {}) {
      onBroadcast?.({ payload })
    },
    setStatus(status) {
      onStatus?.(status)
    },
  }
}

describe('useRealtimeInbox', () => {
  let store
  let scope
  let originalHiddenDescriptor

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useInboxStore()
    vi.spyOn(store, 'refreshInbox').mockResolvedValue(undefined)
    vi.spyOn(store, 'refreshOpenThread').mockResolvedValue(undefined)
    vi.spyOn(store, 'authHeaders').mockResolvedValue({})
    vi.useFakeTimers()
    scope = effectScope()
    localStorage.clear()
    originalHiddenDescriptor = Object.getOwnPropertyDescriptor(document, 'hidden')
  })

  afterEach(() => {
    scope.stop()
    if (originalHiddenDescriptor) {
      Object.defineProperty(document, 'hidden', originalHiddenDescriptor)
    } else {
      delete document.hidden
    }
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function mount(client, isAuthenticated = ref(true)) {
    scope.run(() => useRealtimeInbox(store, client, isAuthenticated))
  }

  function setHidden(hidden, dispatch = true) {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: hidden,
    })
    if (dispatch) document.dispatchEvent(new Event('visibilitychange'))
  }

  it('refreshes the inbox after a debounce once a ping arrives', () => {
    const client = makeMockClient()
    store.userId = 'user-1'
    mount(client)

    expect(client.channel).toHaveBeenCalledWith('inbox:user-1')
    client.ping()
    expect(store.refreshInbox).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1499)
    expect(store.refreshInbox).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(store.refreshInbox).toHaveBeenCalledTimes(1)
  })

  // Regression check for the debounce itself: a naive implementation that
  // refreshes immediately on every ping (no debounce) would fail this
  // "one refresh for many rapid pings" assertion.
  it('collapses multiple rapid pings into a single refresh', () => {
    const client = makeMockClient()
    store.userId = 'user-1'
    mount(client)

    client.ping()
    vi.advanceTimersByTime(500)
    client.ping()
    vi.advanceTimersByTime(500)
    client.ping()
    vi.advanceTimersByTime(1500)

    expect(store.refreshInbox).toHaveBeenCalledTimes(1)
  })

  it('refreshes and badges the title without a timer when a ping arrives while hidden', async () => {
    const client = makeMockClient()
    store.userId = 'user-1'
    store.unreadInboxCount = 3
    document.title = BASE_TITLE
    store.refreshInbox.mockImplementation(async () => {
      store.unreadInboxCount = 4
    })
    mount(client)
    scope.run(() => useTitleUnreadBadge(store))

    setHidden(true)
    client.ping()
    await nextTick()

    expect(store.refreshInbox).toHaveBeenCalledTimes(1)
    expect(document.title).toBe(`(1) ${BASE_TITLE}`)
  })

  it('claims an inbound insert event and acknowledges a browser notification while hidden', async () => {
    const client = makeMockClient()
    store.userId = '11111111-1111-1111-1111-111111111111'
    localStorage.setItem(
      `cookie-browser-notifications:${store.userId}`,
      JSON.stringify({ enabled: true }),
    )
    const close = vi.fn()
    const NotificationMock = vi.fn(function Notification(title, options) {
      this.title = title
      this.options = options
      this.close = close
    })
    NotificationMock.permission = 'granted'
    vi.stubGlobal('Notification', NotificationMock)
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            eventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            claimToken: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            message: { id: 'message-1', sender: 'City Construction', subject: 'Kitchen update' },
          }),
        })
        .mockResolvedValueOnce({ ok: true, status: 204 }),
    )
    mount(client)

    setHidden(true)
    client.ping({ op: 'INSERT', event_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })
    await vi.waitFor(() => expect(NotificationMock).toHaveBeenCalledTimes(1))

    expect(NotificationMock).toHaveBeenCalledWith('New email from City Construction', {
      body: 'Kitchen update',
      icon: '/icons/icon-192.png',
      tag: 'cookie-email-message-1',
    })
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      `${NOTIFICATIONS_API_URL}/notification-event`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          action: 'claim',
          eventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        }),
      }),
    )
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      `${NOTIFICATIONS_API_URL}/notification-event`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          action: 'ack',
          eventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          claimToken: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        }),
      }),
    )
  })

  it('never requests browser notification content for an update ping', async () => {
    const client = makeMockClient()
    store.userId = '11111111-1111-1111-1111-111111111111'
    localStorage.setItem(
      `cookie-browser-notifications:${store.userId}`,
      JSON.stringify({ enabled: true }),
    )
    vi.stubGlobal('Notification', Object.assign(vi.fn(), { permission: 'granted' }))
    vi.stubGlobal('fetch', vi.fn())
    mount(client)

    setHidden(true)
    client.ping({ op: 'UPDATE', event_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })
    await Promise.resolve()
    await Promise.resolve()

    expect(fetch).not.toHaveBeenCalled()
    expect(Notification).not.toHaveBeenCalled()
  })

  // Regression check for an installed standalone PWA: its window can sit
  // visible on screen (document.hidden stays false) while the user works in
  // another app, so hasFocus() — not just document.hidden — must also gate
  // notifications, or an installed app never notifies at all.
  it('shows a notification when the window is visible but unfocused', async () => {
    const client = makeMockClient()
    store.userId = '11111111-1111-1111-1111-111111111111'
    localStorage.setItem(
      `cookie-browser-notifications:${store.userId}`,
      JSON.stringify({ enabled: true }),
    )
    const NotificationMock = vi.fn(function Notification(title, options) {
      this.title = title
      this.options = options
      this.close = vi.fn()
    })
    NotificationMock.permission = 'granted'
    vi.stubGlobal('Notification', NotificationMock)
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            eventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            claimToken: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            message: { id: 'message-1', sender: 'City Construction', subject: 'Kitchen update' },
          }),
        })
        .mockResolvedValueOnce({ ok: true, status: 204 }),
    )
    mount(client)

    setHidden(false)
    client.ping({ op: 'INSERT', event_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })
    await vi.advanceTimersByTimeAsync(1500)

    await vi.waitFor(() => expect(NotificationMock).toHaveBeenCalledTimes(1))
  })

  it('does not show a notification while the window is visible and focused', async () => {
    const client = makeMockClient()
    store.userId = '11111111-1111-1111-1111-111111111111'
    localStorage.setItem(
      `cookie-browser-notifications:${store.userId}`,
      JSON.stringify({ enabled: true }),
    )
    vi.stubGlobal('Notification', Object.assign(vi.fn(), { permission: 'granted' }))
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          eventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          claimToken: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          message: { id: 'message-1', sender: 'City Construction', subject: 'Kitchen update' },
        }),
      }),
    )
    mount(client)

    setHidden(false)
    client.ping({ op: 'INSERT', event_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })
    await vi.advanceTimersByTimeAsync(1500)

    expect(Notification).not.toHaveBeenCalled()
  })

  it('does not refresh while a search is active', () => {
    const client = makeMockClient()
    store.userId = 'user-1'
    store.activeSearchQuery = 'birthday'
    mount(client)

    client.ping()
    vi.advanceTimersByTime(2000)

    expect(store.refreshInbox).not.toHaveBeenCalled()
  })

  it('refreshes an open thread while search results remain stable', () => {
    const client = makeMockClient()
    store.userId = 'user-1'
    store.openEmailId = 'message-1'
    store.activeSearchQuery = 'kitchen'
    mount(client)

    client.ping({ op: 'INSERT' })
    vi.advanceTimersByTime(1500)

    expect(store.refreshInbox).not.toHaveBeenCalled()
    expect(store.refreshOpenThread).toHaveBeenCalledTimes(1)
  })

  it('refreshes once when the channel reaches SUBSCRIBED after being disconnected', () => {
    const client = makeMockClient()
    store.userId = 'user-1'
    mount(client)

    client.setStatus('SUBSCRIBED')
    expect(store.refreshInbox).not.toHaveBeenCalled()

    client.setStatus('CHANNEL_ERROR')
    client.setStatus('SUBSCRIBED')
    expect(store.refreshInbox).toHaveBeenCalledTimes(1)
  })

  it('does nothing when the supabase client is null', () => {
    store.userId = 'user-1'
    expect(() => mount(null)).not.toThrow()
    expect(store.refreshInbox).not.toHaveBeenCalled()
  })

  it('subscribes when a deferred client becomes available and removes its channel on logout', async () => {
    const client = makeMockClient()
    const clientRef = ref(null)
    const isAuthenticated = ref(true)
    store.userId = 'user-1'
    mount(clientRef, isAuthenticated)

    expect(client.channel).not.toHaveBeenCalled()
    clientRef.value = client
    await nextTick()
    expect(client.channel).toHaveBeenCalledWith('inbox:user-1')

    isAuthenticated.value = false
    clientRef.value = null
    await nextTick()
    expect(client.removeChannel).toHaveBeenCalledWith(client.channelObj)
  })

  it('does not subscribe when unauthenticated or userId is unknown', () => {
    const client = makeMockClient()
    mount(client, ref(false))
    expect(client.channel).not.toHaveBeenCalled()
  })

  it('catches up once when a suspended background tab becomes visible', () => {
    const client = makeMockClient()
    store.userId = 'user-1'
    mount(client)

    setHidden(true)
    setHidden(false)
    setHidden(false)

    expect(store.refreshInbox).toHaveBeenCalledTimes(1)
  })

  it('cancels a pending broadcast refresh when visibility catch-up refreshes immediately', () => {
    const client = makeMockClient()
    store.userId = 'user-1'
    mount(client)

    client.ping()
    setHidden(true)
    setHidden(false)
    vi.advanceTimersByTime(1500)

    expect(store.refreshInbox).toHaveBeenCalledTimes(1)
  })

  it('serializes visibility and reconnect catch-up refreshes', async () => {
    let finishVisibilityRefresh
    store.refreshInbox.mockImplementationOnce(
      () => new Promise((resolve) => (finishVisibilityRefresh = resolve)),
    )
    const client = makeMockClient()
    store.userId = 'user-1'
    mount(client)

    setHidden(true)
    setHidden(false)
    client.setStatus('CHANNEL_ERROR')
    client.setStatus('SUBSCRIBED')

    expect(store.refreshInbox).toHaveBeenCalledTimes(1)

    finishVisibilityRefresh()
    await Promise.resolve()
    await Promise.resolve()

    expect(store.refreshInbox).toHaveBeenCalledTimes(2)
  })

  it('runs a trailing refresh when a broadcast arrives during a slow catch-up', async () => {
    let finishCatchUp
    store.refreshInbox.mockImplementationOnce(
      () => new Promise((resolve) => (finishCatchUp = resolve)),
    )
    const client = makeMockClient()
    store.userId = 'user-1'
    mount(client)

    setHidden(true)
    setHidden(false)
    client.ping()
    vi.advanceTimersByTime(1500)
    expect(store.refreshInbox).toHaveBeenCalledTimes(1)

    finishCatchUp()
    await Promise.resolve()
    await Promise.resolve()

    expect(store.refreshInbox).toHaveBeenCalledTimes(2)
  })

  it('runs a trailing refresh when the tab resumes during a slow broadcast refresh', async () => {
    let finishBroadcastRefresh
    store.refreshInbox.mockImplementationOnce(
      () => new Promise((resolve) => (finishBroadcastRefresh = resolve)),
    )
    const client = makeMockClient()
    store.userId = 'user-1'
    mount(client)

    client.ping()
    vi.advanceTimersByTime(1500)
    setHidden(true)
    setHidden(false)
    expect(store.refreshInbox).toHaveBeenCalledTimes(1)

    finishBroadcastRefresh()
    await Promise.resolve()
    await Promise.resolve()

    expect(store.refreshInbox).toHaveBeenCalledTimes(2)
  })

  it('runs a trailing refresh after a second resume episode during a slow catch-up', async () => {
    let finishFirstCatchUp
    store.refreshInbox.mockImplementationOnce(
      () => new Promise((resolve) => (finishFirstCatchUp = resolve)),
    )
    const client = makeMockClient()
    store.userId = 'user-1'
    mount(client)

    setHidden(true)
    setHidden(false)
    setHidden(true)
    setHidden(false)
    expect(store.refreshInbox).toHaveBeenCalledTimes(1)

    finishFirstCatchUp()
    await Promise.resolve()
    await Promise.resolve()

    expect(store.refreshInbox).toHaveBeenCalledTimes(2)
  })

  it("does not let an old user's slow refresh suppress a new user's catch-up", () => {
    let finishOldRefresh
    store.refreshInbox.mockImplementationOnce(
      () => new Promise((resolve) => (finishOldRefresh = resolve)),
    )
    const client = makeMockClient()
    store.userId = 'user-1'
    mount(client)

    setHidden(true)
    setHidden(false)
    store.userId = 'user-2'
    setHidden(true)
    setHidden(false)

    expect(store.refreshInbox).toHaveBeenCalledTimes(2)
    finishOldRefresh()
  })

  it('removes the visibility listener on scope dispose', () => {
    const client = makeMockClient()
    store.userId = 'user-1'
    mount(client)
    scope.stop()

    setHidden(true)
    setHidden(false)

    expect(store.refreshInbox).not.toHaveBeenCalled()
  })
})
