// Keeps the window dock's tabs (components/WindowDock.vue) across a page
// refresh: one list per account in localStorage, dropped an hour after the
// page last held it.
//
// Only what brings a tab back is stored, never a message itself. An email
// tab is its bucket-style item (id, subject, sender, folder). A message is
// the id of its row in Drafts and its subject: minimising saves it there, so
// the restored tab opens that draft. A message with no row yet (nothing
// written, or a save that did not reach the server) is not kept.

import { onScopeDispose, watch } from 'vue'

const STORAGE_PREFIX = 'cookie.dockTabs.'

export const DOCK_TABS_TTL_MS = 60 * 60 * 1000

export function dockTabsStorageKey(owner) {
  return `${STORAGE_PREFIX}${owner}`
}

// The row in Drafts and the subject a message tab stands for right now: the
// composer's own while it is open, else what it was minimised or restored
// with.
function tabDraft(tab, store) {
  if (tab.key === store.composerTabKey) {
    return { draftId: store.composerDraftId, subject: store.composerSubject }
  }
  return tab.snapshot ?? tab.stored ?? {}
}

// What to store for the tabs the store holds, in their order.
export function storableDockTabs(store) {
  const stored = []
  for (const tab of store.dockTabs) {
    if (tab.kind === 'email') {
      stored.push({ kind: 'email', item: tab.item })
      continue
    }
    const { draftId, subject } = tabDraft(tab, store)
    if (draftId) stored.push({ kind: 'compose', draftId, subject: String(subject ?? '') })
  }
  return stored
}

// A stored entry as a dock tab, or null when it does not read as one. A
// restored message has no snapshot: `stored` names the draft its tab opens.
function restoredTab(raw) {
  if (raw?.kind === 'email') {
    const id = String(raw.item?.id ?? '')
    const meta = raw.item?.meta && !Array.isArray(raw.item.meta) ? raw.item.meta : {}
    if (!id) return null
    return {
      key: `email:${id}`,
      kind: 'email',
      item: { kind: 'email', id, title: String(raw.item.title ?? ''), meta: { ...meta } },
    }
  }
  if (raw?.kind === 'compose' && raw.draftId) {
    const draftId = String(raw.draftId)
    return {
      key: `compose:draft:${draftId}`,
      kind: 'compose',
      snapshot: null,
      stored: { draftId, subject: String(raw.subject ?? '') },
    }
  }
  return null
}

export function readDockTabs(owner, now = Date.now()) {
  if (!owner) return []
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(dockTabsStorageKey(owner)) ?? 'null')
    const savedAt = Number(raw?.savedAt)
    if (!Number.isFinite(savedAt) || now - savedAt > DOCK_TABS_TTL_MS) {
      globalThis.localStorage?.removeItem(dockTabsStorageKey(owner))
      return []
    }
    const seen = new Set()
    const tabs = []
    for (const entry of Array.isArray(raw.tabs) ? raw.tabs : []) {
      const tab = restoredTab(entry)
      if (!tab || seen.has(tab.key)) continue
      seen.add(tab.key)
      tabs.push(tab)
    }
    return tabs
  } catch {
    return []
  }
}

export function writeDockTabs(owner, tabs, now = Date.now()) {
  if (!owner) return
  try {
    if (tabs.length) {
      globalThis.localStorage?.setItem(
        dockTabsStorageKey(owner),
        JSON.stringify({ savedAt: now, tabs }),
      )
    } else {
      globalThis.localStorage?.removeItem(dockTabsStorageKey(owner))
    }
  } catch {
    // Private mode or a full quota: the tabs still work until the refresh.
  }
}

// Restores the signed-in account's tabs and stores them from then on.
// `store` is the inbox store. Call it inside an effect scope (a component's,
// or effectScope()): it stops when that scope does.
export function keepDockTabs(store) {
  const save = () => writeDockTabs(store.composeOwnerSub, storableDockTabs(store))

  // A restored message whose draft has since been sent or discarded (from
  // another tab or device) has nothing to open. The drafts list is complete,
  // so once it has loaded, a draft missing from it is gone.
  function dropMissingDrafts() {
    if (!store.draftsLoadedAt) return
    const live = new Set(store.drafts.map((draft) => draft.id))
    const kept = store.dockTabs.filter(
      (tab) =>
        tab.kind !== 'compose' ||
        tab.snapshot ||
        tab.key === store.composerTabKey ||
        live.has(tab.stored?.draftId),
    )
    if (kept.length !== store.dockTabs.length) store.dockTabs = kept
  }

  watch(
    () => [store.composeOwnerSub, JSON.stringify(storableDockTabs(store))],
    ([owner], [previousOwner] = []) => {
      if (owner === previousOwner) {
        save()
        return
      }
      // Another account (or the first look at this one): its stored tabs go
      // ahead of anything opened in the moment this module took to load.
      const open = new Set(store.dockTabs.map((tab) => tab.key))
      const restored = readDockTabs(owner).filter((tab) => !open.has(tab.key))
      if (restored.length) store.dockTabs = [...restored, ...store.dockTabs]
      dropMissingDrafts()
      save()
    },
    { immediate: true },
  )
  watch(() => store.draftsLoadedAt, dropMissingDrafts)

  // The hour runs from when the page last held the tabs, not from when they
  // last changed: leaving stamps them once more. 'hidden' is the last event
  // a mobile browser reliably delivers.
  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') save()
  }
  window.addEventListener('pagehide', save)
  document.addEventListener('visibilitychange', onVisibilityChange)
  onScopeDispose(() => {
    window.removeEventListener('pagehide', save)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  })
}
