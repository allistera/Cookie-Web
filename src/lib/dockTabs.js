// The window dock: tabs along the bottom of the screen for the messages
// being written and the emails kept from the reader, so several can be open
// at once (components/WindowDock.vue). The tabs live in the inbox store's
// dockTabs; these are the parts that need nothing from the store itself.

import { bucketItemRoute } from './bucketItems.js'

// A tab for the email open in the reader. `item` is its bucket item
// (emailBucketItem), which carries the folder it is open in: the reader only
// opens an email its lists hold, so the tab routes back there, exactly as
// the bucket does.
export function emailDockTab(item) {
  return { key: `email:${item.id}`, kind: 'email', item }
}

export function dockTabRoute(tab) {
  return bucketItemRoute(tab.item)
}

// The subject, as the tab's title. `composer` is the inbox store: the
// message in the composer is titled from what is being typed, a minimised
// one from what it held, and one restored after a refresh
// (lib/dockTabStorage.js) from the subject stored with it.
export function dockTabTitle(tab, composer) {
  if (tab.kind === 'email') return tab.item.title
  const subject =
    tab.key === composer.composerTabKey
      ? composer.composerSubject
      : (tab.snapshot ?? tab.stored)?.subject
  return String(subject ?? '').trim() || 'New message'
}

// Open in the reader or the composer right now. A bucket item's id is a
// string whatever the email's own id is.
export function isDockTabOpen(tab, store) {
  return tab.kind === 'email'
    ? String(store.openEmailId ?? '') === tab.item.id
    : store.composerTabKey === tab.key
}

// A lone message that is already open in the composer needs no tab under
// it; the dock appears once there is something to switch to.
export function isDockVisible(store) {
  const tabs = store.dockTabs
  return tabs.length > 1 || (tabs.length === 1 && !isDockTabOpen(tabs[0], store))
}
