import { effectScope, nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { describe, beforeEach, afterEach, it, expect, vi } from 'vitest'

import { useAppBadge } from '../useAppBadge'
import { useInboxStore } from '../../stores/inbox'

describe('useAppBadge', () => {
  let store
  let scope
  let set
  let clear

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useInboxStore()
    scope = effectScope()
    set = vi.fn()
    clear = vi.fn()
  })

  afterEach(() => {
    scope.stop()
  })

  function mount() {
    scope.run(() => useAppBadge(store, { set, clear }))
  }

  it('badges immediately with the current unread count', () => {
    store.unreadInboxCount = 3
    mount()

    expect(set).toHaveBeenCalledWith(3)
  })

  it('updates the badge as the unread count changes', async () => {
    store.unreadInboxCount = 0
    mount()

    store.unreadInboxCount = 5
    await nextTick()

    expect(set).toHaveBeenLastCalledWith(5)
  })

  it('clears the badge on scope dispose', () => {
    store.unreadInboxCount = 2
    mount()

    scope.stop()

    expect(clear).toHaveBeenCalled()
  })
})
