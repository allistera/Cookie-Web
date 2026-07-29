import { effectScope, nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { describe, beforeEach, afterEach, it, expect, vi } from 'vitest'

vi.mock('../../lib/appBadge', () => ({
  setAppBadge: vi.fn(),
  clearAppBadge: vi.fn(),
}))

import { useAppBadge } from '../useAppBadge'
import { setAppBadge, clearAppBadge } from '../../lib/appBadge'
import { useInboxStore } from '../../stores/inbox'

describe('useAppBadge', () => {
  let store
  let scope

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useInboxStore()
    scope = effectScope()
    vi.mocked(setAppBadge).mockClear()
    vi.mocked(clearAppBadge).mockClear()
  })

  afterEach(() => {
    scope.stop()
  })

  function mount() {
    scope.run(() => useAppBadge(store))
  }

  it('badges immediately with the current unread count', () => {
    store.unreadInboxCount = 3
    mount()

    expect(setAppBadge).toHaveBeenCalledWith(3)
  })

  it('updates the badge as the unread count changes', async () => {
    store.unreadInboxCount = 0
    mount()

    store.unreadInboxCount = 5
    await nextTick()

    expect(setAppBadge).toHaveBeenLastCalledWith(5)
  })

  it('clears the badge on scope dispose', () => {
    store.unreadInboxCount = 2
    mount()

    scope.stop()

    expect(clearAppBadge).toHaveBeenCalled()
  })
})
