<script setup>
import { onMounted, ref } from 'vue'
import { fetchSubscriptions, isStillSending, unsubscribeFromSender } from '../lib/subscriptions'
import { useInboxStore } from '../stores/inbox'

const store = useInboxStore()
const subscriptions = ref([])
const isLoading = ref(true)
const loadError = ref('')
// Sender addresses with an unsubscribe request in flight. Working through a
// sender's page can take minutes, so several may run at once.
const pending = ref(new Set())
// Sender address to the page (or unsubscribe mail) the person has to finish
// with, for senders that could not be unsubscribed automatically.
const manualLinks = ref(new Map())

const DATE_FMT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

function formatDate(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : DATE_FMT.format(date)
}

function senderName(subscription) {
  return subscription.name || subscription.address
}

function emailCount(subscription) {
  return subscription.messageCount === 1 ? '1 email' : `${subscription.messageCount} emails`
}

// A sender stays listed until the unsubscribe is confirmed; one that keeps
// writing after that comes back, marked as still sending.
function isListed(subscription) {
  return !subscription.unsubscribedAt || isStillSending(subscription)
}

async function load() {
  isLoading.value = true
  loadError.value = ''
  try {
    subscriptions.value = (await fetchSubscriptions()).filter(isListed)
  } catch (error) {
    console.error('Failed to load subscriptions:', error)
    loadError.value = 'Could not load your subscriptions.'
  } finally {
    isLoading.value = false
  }
}

function setPending(address, isPending) {
  const next = new Set(pending.value)
  if (isPending) next.add(address)
  else next.delete(address)
  pending.value = next
}

async function unsubscribe(subscription) {
  const { address } = subscription
  if (pending.value.has(address)) return
  setPending(address, true)
  try {
    const outcome = await unsubscribeFromSender(subscription)
    if (outcome.status === 'unsubscribed') {
      subscriptions.value = subscriptions.value.filter((entry) => entry.address !== address)
      store.notify(`Unsubscribed from ${senderName(subscription)}.`)
    } else if (outcome.status === 'manual') {
      manualLinks.value = new Map(manualLinks.value).set(address, outcome.href)
      store.notify(
        `Could not unsubscribe from ${senderName(subscription)} automatically. Open their unsubscribe page to finish.`,
        'error',
      )
    } else {
      store.notify(`${senderName(subscription)} offers no way to unsubscribe from here.`, 'error')
    }
  } catch (error) {
    console.error('Unsubscribe failed:', error)
    store.notify(error.userMessage || 'Failed to unsubscribe. Please try again.', 'error')
  } finally {
    setPending(address, false)
  }
}

onMounted(load)
</script>

<template>
  <div class="subscriptions-view" data-testid="subscriptions-view">
    <div class="subscriptions-page">
      <header class="subscriptions-header">
        <h1>Subscriptions</h1>
        <p class="subscriptions-subtitle">
          Newsletters and mailing lists that send you mail, newest first. Unsubscribing asks the
          sender to stop and takes it off this list; mail you already have stays where it is.
        </p>
      </header>

      <!-- Loading, then error, then empty: the empty message must never stand
           in for a request that is still running or that failed. -->
      <div
        v-if="isLoading"
        class="subscriptions-loading"
        role="status"
        aria-label="Loading subscriptions"
      >
        <div class="spinner"></div>
      </div>

      <div v-else-if="loadError" class="subscriptions-error" role="alert">
        <p>{{ loadError }}</p>
        <button type="button" class="btn btn-secondary" @click="load">Try again</button>
      </div>

      <div v-else-if="!subscriptions.length" class="subscriptions-empty">
        No subscriptions left to unsubscribe from.
      </div>

      <ul v-else class="subscriptions-list">
        <li
          v-for="subscription in subscriptions"
          :key="subscription.address"
          class="subscriptions-row"
        >
          <div class="subscriptions-info">
            <span class="subscriptions-name">{{ senderName(subscription) }}</span>
            <span class="subscriptions-meta">
              <template v-if="subscription.name">{{ subscription.address }} · </template
              >{{ emailCount(subscription) }} · last
              {{ formatDate(subscription.lastReceivedAt) }}
            </span>
          </div>
          <span v-if="subscription.unsubscribedAt" class="subscriptions-status">
            Unsubscribed {{ formatDate(subscription.unsubscribedAt) }}, still sending
          </span>
          <a
            v-if="manualLinks.has(subscription.address)"
            class="subscriptions-action"
            :href="manualLinks.get(subscription.address)"
            target="_blank"
            rel="noopener noreferrer"
          >
            Open unsubscribe page
          </a>
          <button
            v-else
            type="button"
            class="subscriptions-action"
            :disabled="pending.has(subscription.address)"
            :aria-label="`Unsubscribe from ${senderName(subscription)}`"
            @click="unsubscribe(subscription)"
          >
            {{ pending.has(subscription.address) ? 'Unsubscribing…' : 'Unsubscribe' }}
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
/* .main-content clips what overflows it, so the view scrolls itself. The
   scroller spans the panel, keeping the scrollbar at the panel's edge. */
.subscriptions-view {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.subscriptions-page {
  max-width: 760px;
  margin: 0 auto;
  padding: 32px 24px;
}

.subscriptions-header h1 {
  margin: 0 0 4px;
  font-size: 22px;
  font-weight: 700;
}

.subscriptions-subtitle {
  margin: 0 0 24px;
  color: var(--text-secondary);
  font-size: 14px;
}

.subscriptions-loading {
  display: flex;
  justify-content: center;
  padding: 48px 0;
}

.subscriptions-error {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  padding: 24px 0;
  color: var(--text-secondary);
}

.subscriptions-error p {
  margin: 0;
}

.subscriptions-empty {
  padding: 32px 0;
  color: var(--text-secondary);
  font-size: 14px;
  text-align: center;
}

.subscriptions-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.subscriptions-row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background: var(--bg-card);
}

.subscriptions-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1 1 auto;
}

.subscriptions-name {
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.subscriptions-meta {
  font-size: 12.5px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.subscriptions-status {
  flex: 0 0 auto;
  font-size: 13px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.subscriptions-action {
  flex: 0 0 auto;
  padding: 6px 14px;
  border: 1px solid var(--border-color);
  border-radius: 100px;
  background: transparent;
  color: var(--text-primary);
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
  cursor: pointer;
}

.subscriptions-action:hover:not(:disabled) {
  background: var(--bg-hover);
}

.subscriptions-action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

@media (max-width: 640px) {
  .subscriptions-row {
    flex-wrap: wrap;
    gap: 8px 16px;
  }

  .subscriptions-info {
    flex-basis: 100%;
  }
}
</style>
