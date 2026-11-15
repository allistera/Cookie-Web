import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick } from 'vue'

import { useInboxStore } from '../../stores/inbox'
import {
  DOCK_TABS_TTL_MS,
  dockTabsStorageKey,
  keepDockTabs,
  readDockTabs,
  storableDockTabs,
  writeDockTabs,
} from '../dockTabStorage'

const OWNER = 'auth0|me'
const NOW = Date.UTC(2026, 10, 15, 10, 0)

const emailItem = {
  kind: 'email',
  id: 'm1',
  title: 'Revised floor plan',
  meta: { sender: 'City Construction', folder: 'sent', label: '' },
}
const emailTab = { key: 'email:m1', kind: 'email', item: emailItem }
const storedMessage = { kind: 'compose', draftId: 'draft-1', subject: 'Quarterly numbers' }
const restoredMessage = {
  key: 'compose:draft:draft-1',
  kind: 'compose',
  snapshot: null,
  stored: { draftId: 'draft-1', subject: 'Quarterly numbers' },
}

function stored() {
  return JSON.parse(localStorage.getItem(dockTabsStorageKey(OWNER)))
}

let store
let scope

beforeEach(() => {
  localStorage.clear()
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
  setActivePinia(createPinia())
  store = useInboxStore()
  scope = effectScope()
})

afterEach(() => {
  scope.stop()
  vi.restoreAllMocks()
})

describe('what is stored for the dock', () => {
  it('keeps an email by its item and a message by its draft row and subject', () => {
    store.dockTabs = [
      emailTab,
      {
        key: 'compose:1',
        kind: 'compose',
        snapshot: { draftId: 'draft-1', subject: 'Quarterly numbers', text: 'Up eight percent.' },
      },
      { key: 'compose:2', kind: 'compose', snapshot: null },
      restoredMessage,
    ]
    store.composerTabKey = 'compose:2'
    store.composerDraftId = 'draft-2'
    store.composerSubject = 'Lunch on Friday'

    // Never the message itself: the words stay in Drafts.
    expect(storableDockTabs(store)).toEqual([
      { kind: 'email', item: emailItem },
      storedMessage,
      { kind: 'compose', draftId: 'draft-2', subject: 'Lunch on Friday' },
      storedMessage,
    ])
  })

  it('leaves out a message with no row in Drafts to come back to', () => {
    store.dockTabs = [
      { key: 'compose:1', kind: 'compose', snapshot: { draftId: null, subject: 'Unsaved' } },
      { key: 'compose:2', kind: 'compose', snapshot: null },
    ]
    store.composerTabKey = 'compose:2'

    expect(storableDockTabs(store)).toEqual([])
  })
})

describe('stored dock tabs', () => {
  it('come back as tabs, a message as one that opens its draft', () => {
    writeDockTabs(OWNER, [{ kind: 'email', item: emailItem }, storedMessage], NOW)

    expect(readDockTabs(OWNER, NOW + 1000)).toEqual([emailTab, restoredMessage])
  })

  it('last an hour from when they were stored', () => {
    writeDockTabs(OWNER, [storedMessage], NOW)

    expect(readDockTabs(OWNER, NOW + DOCK_TABS_TTL_MS)).toHaveLength(1)
    expect(readDockTabs(OWNER, NOW + DOCK_TABS_TTL_MS + 1)).toEqual([])
    // Past the hour they are removed, not just skipped.
    expect(localStorage.getItem(dockTabsStorageKey(OWNER))).toBeNull()
  })

  it('belong to one account', () => {
    writeDockTabs(OWNER, [storedMessage], NOW)

    expect(readDockTabs('auth0|someone-else', NOW)).toEqual([])
    expect(readDockTabs(null, NOW)).toEqual([])
  })

  it('remove the stored list once there are no tabs', () => {
    writeDockTabs(OWNER, [storedMessage], NOW)
    writeDockTabs(OWNER, [], NOW)

    expect(localStorage.getItem(dockTabsStorageKey(OWNER))).toBeNull()
  })

  it('ignore anything that does not read as a tab, and repeats', () => {
    localStorage.setItem(
      dockTabsStorageKey(OWNER),
      JSON.stringify({
        savedAt: NOW,
        tabs: [storedMessage, storedMessage, { kind: 'compose' }, { kind: 'email' }, null, 'x'],
      }),
    )
    expect(readDockTabs(OWNER, NOW)).toEqual([restoredMessage])

    localStorage.setItem(dockTabsStorageKey(OWNER), 'not json')
    expect(readDockTabs(OWNER, NOW)).toEqual([])
  })
})

describe('keeping the dock across a refresh', () => {
  it('restores the account’s tabs when it signs in, and stores every change', async () => {
    writeDockTabs(OWNER, [storedMessage], NOW - 60_000)
    scope.run(() => keepDockTabs(store))
    await nextTick()
    expect(store.dockTabs).toEqual([])

    store.composeOwnerSub = OWNER
    await nextTick()
    expect(store.dockTabs).toEqual([restoredMessage])

    store.dockTabs.push(emailTab)
    await nextTick()
    expect(stored()).toEqual({
      savedAt: NOW,
      tabs: [storedMessage, { kind: 'email', item: emailItem }],
    })

    store.closeDockTab('email:m1')
    store.closeDockTab(restoredMessage.key)
    await nextTick()
    expect(localStorage.getItem(dockTabsStorageKey(OWNER))).toBeNull()
  })

  it('stores a minimised message once its save gives it a row', async () => {
    store.composeOwnerSub = OWNER
    scope.run(() => keepDockTabs(store))
    store.dockTabs.push({
      key: 'compose:1',
      kind: 'compose',
      snapshot: { draftId: null, subject: 'Quarterly numbers' },
    })
    await nextTick()
    expect(localStorage.getItem(dockTabsStorageKey(OWNER))).toBeNull()

    store.dockTabs[0].snapshot.draftId = 'draft-1'
    await nextTick()

    expect(stored().tabs).toEqual([storedMessage])
  })

  it('counts the hour from when the page last held the tabs', async () => {
    store.composeOwnerSub = OWNER
    scope.run(() => keepDockTabs(store))
    store.dockTabs.push(emailTab)
    await nextTick()
    expect(stored().savedAt).toBe(NOW)

    // Two hours on the same page, then a refresh: leaving stamps them again.
    Date.now.mockReturnValue(NOW + 2 * DOCK_TABS_TTL_MS)
    window.dispatchEvent(new Event('pagehide'))

    expect(stored().savedAt).toBe(NOW + 2 * DOCK_TABS_TTL_MS)
  })

  it('drops a restored message whose draft is gone once Drafts has loaded', async () => {
    writeDockTabs(OWNER, [storedMessage, { ...storedMessage, draftId: 'draft-2' }], NOW)
    store.composeOwnerSub = OWNER
    scope.run(() => keepDockTabs(store))
    await nextTick()
    expect(store.dockTabs).toHaveLength(2)

    // draft-1 was sent or discarded somewhere else in the meantime.
    store.drafts = [{ id: 'draft-2' }]
    store.draftsLoadedAt = NOW
    await nextTick()

    expect(store.dockTabs.map((tab) => tab.stored.draftId)).toEqual(['draft-2'])
  })

  it('stops with its scope', async () => {
    store.composeOwnerSub = OWNER
    scope.run(() => keepDockTabs(store))
    scope.stop()

    store.dockTabs.push(emailTab)
    await nextTick()
    window.dispatchEvent(new Event('pagehide'))

    expect(localStorage.getItem(dockTabsStorageKey(OWNER))).toBeNull()
  })
})
