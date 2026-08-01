<script setup>
import { onMounted } from 'vue'
import { useInboxStore } from '../stores/inbox'

const store = useInboxStore()

onMounted(() => {
  store.loadScheduledSends()
})

function formatScheduledFor(scheduledFor) {
  return new Date(scheduledFor).toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Cancelling reopens the draft in the composer (see store.cancelScheduledSend),
// so a failure here just needs to tell the user — nothing to roll back
// locally, the row is still in the list either way.
async function cancel(scheduledSend) {
  try {
    await store.cancelScheduledSend(scheduledSend)
  } catch (error) {
    console.error('Failed to cancel scheduled send:', error)
    store.notify('Failed to cancel scheduled send.', 'error')
  }
}
</script>

<template>
  <div class="scheduled-sends-view">
    <header class="scheduled-sends-header">
      <h1>Scheduled</h1>
      <p class="scheduled-sends-subtitle">
        Mail queued to send later. Cancel any time before it goes out to edit or discard it.
      </p>
    </header>

    <div v-if="!store.scheduledSends.length" class="scheduled-sends-empty">
      Nothing is scheduled to send later.
    </div>

    <ul v-else class="scheduled-sends-list">
      <li v-for="item in store.scheduledSends" :key="item.id" class="scheduled-sends-row">
        <div class="scheduled-sends-info">
          <span class="scheduled-sends-subject">{{ item.subject || '(no subject)' }}</span>
          <span class="scheduled-sends-to">To: {{ item.toAddresses }}</span>
        </div>
        <span class="scheduled-sends-time" :class="{ 'is-failed': item.status === 'failed' }">
          {{ item.status === 'failed' ? 'Failed to send' : formatScheduledFor(item.scheduledFor) }}
        </span>
        <button type="button" class="scheduled-sends-cancel" @click="cancel(item)">Cancel</button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.scheduled-sends-view {
  max-width: 720px;
  margin: 0 auto;
  padding: 32px 24px;
}

.scheduled-sends-header h1 {
  margin: 0 0 4px;
  font-size: 22px;
  font-weight: 700;
}

.scheduled-sends-subtitle {
  margin: 0 0 24px;
  color: var(--text-secondary);
  font-size: 14px;
}

.scheduled-sends-empty {
  padding: 32px 0;
  color: var(--text-secondary);
  font-size: 14px;
  text-align: center;
}

.scheduled-sends-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.scheduled-sends-row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background: var(--bg-card);
}

.scheduled-sends-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1 1 auto;
}

.scheduled-sends-subject {
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.scheduled-sends-to {
  font-size: 12.5px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.scheduled-sends-time {
  flex: 0 0 auto;
  font-size: 13px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.scheduled-sends-time.is-failed {
  color: var(--text-danger, #e5484d);
  font-weight: 600;
}

.scheduled-sends-cancel {
  flex: 0 0 auto;
  padding: 6px 14px;
  border: 1px solid var(--border-color);
  border-radius: 100px;
  background: transparent;
  color: var(--text-primary);
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.scheduled-sends-cancel:hover {
  background: var(--bg-hover);
}
</style>
