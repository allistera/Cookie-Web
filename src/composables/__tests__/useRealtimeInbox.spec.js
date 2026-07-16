import { effectScope, ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { describe, beforeEach, afterEach, it, expect, vi } from 'vitest'

import { useRealtimeInbox } from '../useRealtimeInbox'
import { useInboxStore } from '../../stores/inbox'

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
    ping() {
      onBroadcast?.({})
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
    vi.useFakeTimers()
    scope = effectScope()
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

  it('does not refresh while a search is active', () => {
    const client = makeMockClient()
    store.userId = 'user-1'
    store.activeSearchQuery = 'birthday'
    mount(client)

    client.ping()
    vi.advanceTimersByTime(2000)

    expect(store.refreshInbox).not.toHaveBeenCalled()
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
