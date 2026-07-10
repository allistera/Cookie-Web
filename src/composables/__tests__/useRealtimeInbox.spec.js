import { ref } from 'vue'
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

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useInboxStore()
    vi.spyOn(store, 'refreshInbox').mockResolvedValue(undefined)
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('refreshes the inbox after a debounce once a ping arrives', () => {
    const client = makeMockClient()
    store.userId = 'user-1'
    useRealtimeInbox(store, client, ref(true))

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
    useRealtimeInbox(store, client, ref(true))

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
    useRealtimeInbox(store, client, ref(true))

    client.ping()
    vi.advanceTimersByTime(2000)

    expect(store.refreshInbox).not.toHaveBeenCalled()
  })

  it('refreshes once when the channel reaches SUBSCRIBED after being disconnected', () => {
    const client = makeMockClient()
    store.userId = 'user-1'
    useRealtimeInbox(store, client, ref(true))

    client.setStatus('SUBSCRIBED')
    expect(store.refreshInbox).not.toHaveBeenCalled()

    client.setStatus('CHANNEL_ERROR')
    client.setStatus('SUBSCRIBED')
    expect(store.refreshInbox).toHaveBeenCalledTimes(1)
  })

  it('does nothing when the supabase client is null', () => {
    store.userId = 'user-1'
    expect(() => useRealtimeInbox(store, null, ref(true))).not.toThrow()
    expect(store.refreshInbox).not.toHaveBeenCalled()
  })

  it('does not subscribe when unauthenticated or userId is unknown', () => {
    const client = makeMockClient()
    useRealtimeInbox(store, client, ref(false))
    expect(client.channel).not.toHaveBeenCalled()
  })
})
