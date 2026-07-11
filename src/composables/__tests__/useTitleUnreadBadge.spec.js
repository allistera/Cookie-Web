import { nextTick, effectScope } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { describe, beforeEach, afterEach, it, expect } from 'vitest'

import { useTitleUnreadBadge } from '../useTitleUnreadBadge'
import { useInboxStore } from '../../stores/inbox'

const BASE_TITLE = 'Cookie AI Inbox - Workspace Intelligence'

// jsdom has no real tab visibility; stub the readonly properties and fire the
// event the composable listens for.
function defineVisibility(state) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  })
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => state === 'hidden',
  })
}

function setVisibility(state) {
  defineVisibility(state)
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('useTitleUnreadBadge', () => {
  let store
  let scope

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useInboxStore()
    document.title = BASE_TITLE
    defineVisibility('visible')
    scope = effectScope()
  })

  afterEach(() => {
    scope.stop()
  })

  function mount() {
    scope.run(() => useTitleUnreadBadge(store))
  }

  it('badges the title with the number of new unread emails while hidden', async () => {
    store.unreadInboxCount = 3
    mount()

    setVisibility('hidden')
    store.unreadInboxCount = 5
    await nextTick()

    expect(document.title).toBe(`(2) ${BASE_TITLE}`)
  })

  it('does not badge while the tab is visible', async () => {
    store.unreadInboxCount = 3
    mount()

    store.unreadInboxCount = 5
    await nextTick()

    expect(document.title).toBe(BASE_TITLE)
  })

  it('restores the plain title when the tab becomes visible again', async () => {
    store.unreadInboxCount = 0
    mount()

    setVisibility('hidden')
    store.unreadInboxCount = 2
    await nextTick()
    expect(document.title).toBe(`(2) ${BASE_TITLE}`)

    setVisibility('visible')
    expect(document.title).toBe(BASE_TITLE)
  })

  it('shrinks the badge when messages are read elsewhere while hidden', async () => {
    store.unreadInboxCount = 3
    mount()

    setVisibility('hidden')
    store.unreadInboxCount = 5
    await nextTick()
    expect(document.title).toBe(`(2) ${BASE_TITLE}`)

    store.unreadInboxCount = 4
    await nextTick()
    expect(document.title).toBe(`(1) ${BASE_TITLE}`)

    store.unreadInboxCount = 3
    await nextTick()
    expect(document.title).toBe(BASE_TITLE)
  })

  it('starts counting immediately when mounted in a hidden tab', async () => {
    defineVisibility('hidden')
    store.unreadInboxCount = 1
    mount()

    store.unreadInboxCount = 2
    await nextTick()

    expect(document.title).toBe(`(1) ${BASE_TITLE}`)
  })

  it('restores the title and stops listening on scope dispose', async () => {
    store.unreadInboxCount = 0
    mount()

    setVisibility('hidden')
    store.unreadInboxCount = 2
    await nextTick()
    expect(document.title).toBe(`(2) ${BASE_TITLE}`)

    scope.stop()
    expect(document.title).toBe(BASE_TITLE)

    store.unreadInboxCount = 9
    await nextTick()
    document.dispatchEvent(new Event('visibilitychange'))
    expect(document.title).toBe(BASE_TITLE)
  })
})
