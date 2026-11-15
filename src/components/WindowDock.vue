<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'

import { dockTabRoute, dockTabTitle, isDockTabOpen, isDockVisible } from '../lib/dockTabs'
import { useInboxStore } from '../stores/inbox'

// Tabs along the bottom of the screen, one for each message being written
// and each email kept from the reader, titled by subject. Only one message
// fits the composer and one email the reader, so the rest wait here:
// clicking a tab brings it back, clicking the open one puts it away again.
const store = useInboxStore()
const router = useRouter()

const tabs = computed(() =>
  store.dockTabs.map((tab) => ({
    tab,
    title: dockTabTitle(tab, store),
    open: isDockTabOpen(tab, store),
  })),
)

function toggle({ tab, open }) {
  if (tab.kind === 'compose') {
    if (open) store.minimizeComposer()
    else if (tab.snapshot) store.openComposerTab(tab.key)
    // Restored after a refresh: the message is the draft it was saved as.
    else store.openDraft({ id: tab.stored.draftId, isSummary: true })
    return
  }
  if (open) {
    store.closeReader()
    return
  }
  // The reader opens an email from the list that holds it, so the tab goes
  // back to that folder; the request count opens it even when the route is
  // already there.
  store.emailOpenRequests += 1
  router.push(dockTabRoute(tab))
}

// The message in the composer closes with its tab, saved to Drafts as the
// composer's own close button does. A minimised one is in Drafts already,
// and an email tab is only a way back to its email.
function close({ tab, open }) {
  if (tab.kind === 'compose' && open) store.closeComposer()
  else store.closeDockTab(tab.key)
}
</script>

<template>
  <nav v-if="isDockVisible(store)" class="window-dock" aria-label="Open windows">
    <div
      v-for="entry in tabs"
      :key="entry.tab.key"
      class="window-dock-tab"
      :class="{ open: entry.open }"
      :data-kind="entry.tab.kind"
    >
      <button
        type="button"
        class="window-dock-title"
        :title="entry.title"
        :aria-pressed="entry.open"
        @click="toggle(entry)"
      >
        <span v-if="entry.tab.kind === 'email'" class="material-symbols-outlined" aria-hidden="true"
          >mail</span
        >
        <span v-else class="material-symbols-outlined" aria-hidden="true">edit_square</span>
        <span class="window-dock-label">{{ entry.title }}</span>
      </button>
      <button
        type="button"
        class="window-dock-close"
        title="Close"
        :aria-label="`Close ${entry.title}`"
        @click="close(entry)"
      >
        <span class="material-symbols-outlined" aria-hidden="true">close</span>
      </button>
    </div>
  </nav>
</template>

<style scoped>
/* Bottom right, where the composer floats; main.css moves the composer up
   to sit on top of the tabs (body:has(.window-dock)). */
.window-dock {
  position: fixed;
  right: 20px;
  bottom: 0;
  z-index: var(--z-composer);
  display: flex;
  gap: 6px;
  max-width: calc(100vw - 40px);
  overflow-x: auto;
  scrollbar-width: none;
}

.window-dock-tab {
  display: flex;
  align-items: center;
  flex: 0 1 220px;
  min-width: 112px;
  height: 40px;
  box-sizing: border-box;
  background-color: var(--bg-card);
  border: 1px solid var(--border-color);
  border-bottom: none;
  border-radius: 10px 10px 0 0;
  box-shadow: var(--shadow-sm);
  color: var(--text-secondary);
}

.window-dock-tab.open {
  box-shadow:
    var(--shadow-sm),
    inset 0 2px 0 var(--accent);
  color: var(--text-primary);
}

.window-dock-title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  padding: 0 4px 0 12px;
  border: none;
  background: none;
  border-radius: 10px 0 0 0;
  color: inherit;
  font-family: var(--font-stack);
  font-size: 13px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
}

.window-dock-title .material-symbols-outlined {
  flex: none;
  font-size: 18px;
}

.window-dock-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.window-dock-close {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 28px;
  height: 28px;
  margin-right: 6px;
  padding: 0;
  border: none;
  background: none;
  border-radius: 6px;
  color: var(--text-secondary);
  cursor: pointer;
}

.window-dock-close .material-symbols-outlined {
  font-size: 16px;
}

.window-dock-title:hover,
.window-dock-close:hover {
  color: var(--text-primary);
}

.window-dock-close:hover {
  background-color: var(--bg-hover);
}

.window-dock-title:focus-visible,
.window-dock-close:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
</style>
