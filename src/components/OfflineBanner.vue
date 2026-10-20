<script setup>
import { computed } from 'vue'

import { isOnline } from '../lib/connectivity'
import { discardOutboxEntry, outboxFailures, outboxPending, retryOutboxEntry } from '../lib/outbox'

// Shown while the app cannot reach its Workers (lib/connectivity.js). Lists
// then come from the offline cache and flag changes, task edits and
// document edits wait in the outbox (lib/outbox.js); the count here is how
// many of those will be sent once the connection is back.
const pendingText = computed(() => {
  const count = outboxPending.value
  if (!count) return ''
  return count === 1
    ? '1 change will sync when you are back online.'
    : `${count} changes will sync when you are back online.`
})

function discard(entry) {
  if (window.confirm(`Discard the unsynced change "${entry.label}"? This cannot be undone.`))
    void discardOutboxEntry(entry.seq)
}
</script>

<template>
  <aside v-if="!isOnline || outboxPending" class="offline-banner" aria-label="Sync status">
    <span v-if="!isOnline" role="status">
      You are offline. Showing what was saved on this device.
    </span>
    <span v-else role="status">{{ outboxPending }} changes are saved on this device.</span>
    <span v-if="!isOnline && pendingText">{{ pendingText }}</span>
    <details v-if="outboxFailures.length">
      <summary>Review changes that have not synced</summary>
      <ul>
        <li v-for="entry in outboxFailures" :key="entry.seq">
          <span>{{ entry.label }}</span>
          <span>
            {{
              entry.failure === 'authentication'
                ? 'Sign in again to sync.'
                : entry.failure === 'blocked'
                  ? 'The server could not accept this change.'
                  : 'Waiting to retry.'
            }}
          </span>
          <button type="button" @click="retryOutboxEntry(entry.seq)">Retry</button>
          <button type="button" @click="discard(entry)">Discard</button>
        </li>
      </ul>
    </details>
  </aside>
</template>

<style scoped>
.offline-banner {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  padding: 10px 24px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 14px;
}
.offline-banner > span:first-child {
  flex: 1;
}
.offline-banner details {
  flex-basis: 100%;
}
.offline-banner li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-block: 8px;
}
</style>
