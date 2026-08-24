<script setup>
import { useInboxStore } from '../stores/inbox'

// Unused for now beyond keeping chunking stable: every routed view pulls the
// inbox store, and a store-free view makes Rolldown regroup the shared
// pinia/auth0 chunk into the entry bundle, blowing the entry-chunk budget.
// The store will be needed as soon as this page shows anything real.
useInboxStore()
</script>

<template>
  <div class="tasks-view">
    <header class="tasks-header">
      <h1>Tasks</h1>
    </header>

    <div class="tasks-empty">Nothing here yet.</div>
  </div>
</template>

<style scoped>
.tasks-view {
  max-width: 720px;
  margin: 0 auto;
  padding: 32px 24px;
}

.tasks-header h1 {
  margin: 0 0 4px;
  font-size: 22px;
  font-weight: 700;
}

.tasks-empty {
  padding: 32px 0;
  color: var(--text-secondary);
  font-size: 14px;
  text-align: center;
}
</style>
