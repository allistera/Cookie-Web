<script setup>
import { computed } from 'vue'

import { isOnline } from '../lib/connectivity'
import { outboxPending } from '../lib/outbox'

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
</script>

<template>
  <aside v-if="!isOnline" class="offline-banner" aria-label="Offline status">
    <span role="status">You are offline. Showing what was saved on this device.</span>
    <span v-if="pendingText">{{ pendingText }}</span>
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
</style>
