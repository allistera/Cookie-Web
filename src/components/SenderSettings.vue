<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { normalizeSender, useSendersStore } from '../stores/senders'
import { useInboxStore } from '../stores/inbox'

// Settings > Senders and screening: the screening switch, a form that adds a
// decision, and the searchable list of saved decisions.
const store = useSendersStore()
const inbox = useInboxStore()
const address = ref('')
const decision = ref('accept')
const search = ref('')
const SEARCH_DELAY_MS = 250
let searchTimer = null

// Domain decisions are stored as '@example.com'.
const isDomain = (entry) => entry.address.startsWith('@')
const addressOf = (entry) => (isDomain(entry) ? entry.address.slice(1) : entry.address)
const scopeOf = (entry) => (isDomain(entry) ? 'Domain and its subdomains' : 'Exact address')
const decisionLabel = (entry) => (entry.decision === 'blocked' ? 'Blocked' : 'Accepted')

const needle = computed(() => normalizeSender(search.value))
// The Worker returns the page that matches the search. Filtering again here
// keeps the rows consistent with what was typed while that request is in
// flight, and when a save adds a decision the search does not cover.
const visible = computed(() =>
  store.decisions.filter((entry) => entry.address.includes(needle.value)),
)
const busy = computed(() => !store.loaded || store.saving)
const screeningStatus = computed(() => {
  if (!store.loaded) return 'Loading…'
  return store.enabled
    ? 'New mail from unknown senders waits in New senders until you accept or block it.'
    : 'Off. Mail from unknown senders arrives in the inbox as usual.'
})

function runSearch() {
  clearTimeout(searchTimer)
  searchTimer = null
  if (needle.value !== store.query) void store.load({ query: needle.value })
}
function clearSearch() {
  search.value = ''
  runSearch()
}
watch(search, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(runSearch, SEARCH_DELAY_MS)
})
onBeforeUnmount(() => clearTimeout(searchTimer))

async function change(body) {
  if (await store.update(body)) {
    address.value = ''
    await inbox.refreshSenderMail()
  }
  // A search typed while the decision was saving was not sent; send it now.
  runSearch()
}
watch(
  () => store.ownerSub,
  () => {
    address.value = ''
    decision.value = 'accept'
    search.value = ''
    void store.load({ query: '' })
  },
  { immediate: true },
)
</script>

<template>
  <section class="sender-settings">
    <h3 class="settings-section-title">Screening</h3>
    <label class="settings-row">
      <div class="settings-row-text">
        <span>Screen unknown senders</span>
        <small>{{ screeningStatus }}</small>
      </div>
      <input
        type="checkbox"
        class="settings-switch sender-screening-switch"
        :checked="store.enabled"
        :disabled="busy"
        @change="change({ action: 'settings', enabled: $event.target.checked })"
      />
    </label>
    <p class="settings-section-hint sender-hint">
      Only senders you explicitly Accept are known. Past incoming mail, contacts and sent mail do
      not automatically grant trust. Held mail waits in
      <router-link to="/inbox?filter=screening">New senders</router-link>, and
      <router-link to="/inbox?filter=blocked">Blocked mail</router-link> is kept until you delete
      it. Turning screening off only changes future arrivals.
    </p>
    <details class="sender-details">
      <summary>How decisions are applied</summary>
      <ul>
        <li>
          Accept and Block cover the sender's whole domain and its subdomains: accepting
          news@shop.example also accepts orders@mail.shop.example. Public email providers such as
          gmail.com and outlook.com are the exception; there a decision covers only that exact
          address. A decision saved for an exact address always wins over its domain.
        </li>
        <li>
          Blocking takes precedence over screening and classification. Acceptance bypasses screening
          only; spam decisions, labels, read state, snooze and archive rules remain. Review folders
          show held mail even when a rule archives it, and neither is subject to Spam retention.
        </li>
        <li>
          Blocking applies to future arrivals and already-held mail. Unblock removes the block; with
          screening enabled its held mail returns to New senders. Accept releases all held mail the
          decision covers. Restored mail keeps its existing flags, with no delayed alerts or
          automatic replies.
        </li>
        <li>
          Blocking does not unsubscribe, reject delivery or change your original forwarding. An
          alert or reply already handed off cannot be recalled.
        </li>
      </ul>
    </details>

    <h3 class="settings-section-title sender-heading">Add a sender</h3>
    <form class="sender-form" @submit.prevent="change({ action: decision, address })">
      <label class="sender-field sender-field-address">
        <span>Email address or domain</span>
        <input
          v-model="address"
          type="text"
          required
          maxlength="320"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          placeholder="person@example.com or example.com"
          :disabled="busy"
        />
      </label>
      <label class="sender-field">
        <span>Decision</span>
        <select v-model="decision" class="settings-select" :disabled="busy">
          <option value="accept">Accept sender</option>
          <option value="block">Block sender</option>
        </select>
      </label>
      <button type="submit" class="btn btn-primary" :disabled="busy">Save sender</button>
    </form>

    <div class="sender-list-header">
      <h3 class="settings-section-title sender-heading">
        Saved senders
        <span v-if="store.loaded" class="sender-count" data-testid="sender-count"
          >{{ visible.length }}{{ store.nextCursor ? '+' : '' }}</span
        >
      </h3>
      <div class="sender-list-tools">
        <label class="sender-search">
          <span class="material-symbols-outlined" aria-hidden="true">search</span>
          <input
            v-model="search"
            type="search"
            placeholder="Search senders…"
            aria-label="Search senders"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            @keydown.esc="clearSearch"
          />
          <button
            v-if="search"
            type="button"
            class="ni-action-btn sender-search-clear"
            aria-label="Clear search"
            title="Clear search"
            @click="clearSearch"
          >
            <span class="material-symbols-outlined">close</span>
          </button>
        </label>
        <button
          type="button"
          class="ni-action-btn sender-reload"
          aria-label="Reload senders"
          title="Reload senders"
          :disabled="store.loading || store.saving"
          @click="store.load()"
        >
          <span class="material-symbols-outlined">refresh</span>
        </button>
      </div>
    </div>
    <p v-if="store.error" class="settings-error" role="alert">{{ store.error }}</p>
    <p v-if="store.loading && !store.decisions.length" class="sender-empty" role="status">
      Loading senders…
    </p>
    <p v-else-if="store.loaded && !visible.length" class="sender-empty">
      {{ needle ? `No senders match “${search.trim()}”.` : 'No saved sender decisions yet.' }}
    </p>
    <ul v-else class="sender-list">
      <li v-for="entry in visible" :key="entry.address" class="sender-row" :class="entry.decision">
        <span class="sender-row-icon" aria-hidden="true">
          <span class="material-symbols-outlined">{{
            entry.decision === 'blocked' ? 'block' : 'check'
          }}</span>
        </span>
        <div class="sender-row-text">
          <span class="sender-row-address">{{ addressOf(entry) }}</span>
          <small>{{ scopeOf(entry) }}</small>
        </div>
        <span class="sender-pill">{{ decisionLabel(entry) }}</span>
        <div class="sender-row-actions">
          <template v-if="entry.decision === 'blocked'">
            <button
              type="button"
              class="btn btn-secondary"
              :disabled="store.saving"
              @click="change({ action: 'unblock', address: entry.address })"
            >
              Unblock
            </button>
            <button
              type="button"
              class="btn btn-secondary"
              :disabled="store.saving"
              @click="change({ action: 'accept', address: entry.address })"
            >
              Accept and release
            </button>
          </template>
          <template v-else>
            <button
              type="button"
              class="btn btn-secondary"
              :disabled="store.saving"
              @click="change({ action: 'block', address: entry.address })"
            >
              Block
            </button>
            <button
              type="button"
              class="btn btn-secondary"
              :disabled="store.saving"
              @click="change({ action: 'forget', address: entry.address })"
            >
              Remove acceptance
            </button>
          </template>
        </div>
      </li>
    </ul>
    <button
      v-if="store.nextCursor && visible.length"
      type="button"
      class="btn btn-secondary sender-more"
      :disabled="store.loading || store.saving"
      @click="store.load({ more: true })"
    >
      Load more senders
    </button>
  </section>
</template>

<style scoped>
.sender-settings {
  max-width: 820px;
}
.sender-hint {
  margin-top: 14px;
  line-height: 1.55;
}
.sender-hint a {
  color: var(--text-blue);
}
.sender-details {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--text-secondary);
}
.sender-details summary {
  display: inline-block;
  cursor: pointer;
  color: var(--text-blue);
  font-weight: 500;
}
.sender-details summary:focus-visible {
  outline: 2px solid var(--accent-soft);
  border-radius: 4px;
}
.sender-details ul {
  margin: 10px 0 0;
  padding-left: 18px;
  display: grid;
  gap: 8px;
  line-height: 1.55;
}
.sender-heading {
  margin-top: 30px;
}
.sender-form {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 12px;
}
.sender-field {
  display: grid;
  gap: 6px;
  font-size: 13px;
  color: var(--text-secondary);
}
.sender-field-address {
  flex: 1 1 280px;
}
.sender-field input {
  width: 100%;
  min-height: 38px;
  padding: 8px 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  color: var(--text-primary);
  background: var(--bg-input);
  font: inherit;
  font-size: 14px;
}
.sender-field input:focus-visible,
.sender-search:focus-within {
  outline: 2px solid var(--accent-soft);
  border-color: var(--accent);
}
.sender-field .settings-select {
  min-height: 38px;
}
.sender-form .btn-primary {
  min-height: 38px;
}
.sender-list-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.sender-list-header .sender-heading {
  margin-bottom: 0;
}
.sender-count {
  margin-left: 8px;
  padding: 1px 9px;
  border-radius: 999px;
  background: var(--bg-input);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
  vertical-align: 2px;
}
.sender-list-tools {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1 1 260px;
  justify-content: flex-end;
}
.sender-search {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1 1 200px;
  max-width: 320px;
  height: 36px;
  padding: 0 4px 0 10px;
  border: 1px solid var(--border-color);
  border-radius: 9px;
  background: var(--bg-input);
}
.sender-search .material-symbols-outlined {
  color: var(--text-secondary);
  font-size: 19px;
}
.sender-search input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: 14px;
}
.sender-search input::-webkit-search-cancel-button {
  display: none;
}
.sender-search-clear,
.sender-reload {
  width: 28px;
  height: 28px;
}
.sender-reload:disabled {
  opacity: 0.5;
  cursor: default;
}
.sender-empty {
  margin: 0;
  padding: 36px 16px;
  text-align: center;
  color: var(--text-secondary);
  font-size: 14px;
  border: 1px dashed var(--border-color);
  border-radius: 10px;
}
.sender-list {
  list-style: none;
  margin: 0;
  padding: 0;
  border-top: 1px solid var(--border-color);
}
.sender-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 14px;
  padding: 12px 0;
  border-bottom: 1px solid var(--border-color);
}
.sender-row-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: rgba(76, 183, 130, 0.14);
  color: var(--text-green);
}
.sender-row.blocked .sender-row-icon {
  background: rgba(229, 72, 77, 0.12);
  color: var(--danger-color, #e5484d);
}
.sender-row-icon .material-symbols-outlined {
  font-size: 19px;
}
.sender-row-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.sender-row-address {
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 500;
  overflow-wrap: anywhere;
}
.sender-row-text small {
  color: var(--text-secondary);
  font-size: 12px;
}
.sender-pill {
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  background: rgba(76, 183, 130, 0.14);
  color: var(--text-green);
}
.sender-row.blocked .sender-pill {
  background: rgba(229, 72, 77, 0.12);
  color: var(--danger-color, #e5484d);
}
.sender-row-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}
.sender-more {
  margin-top: 14px;
}
@media (max-width: 640px) {
  .sender-row {
    grid-template-columns: auto minmax(0, 1fr) auto;
  }
  .sender-row-actions {
    grid-column: 2 / -1;
    justify-content: flex-start;
  }
}
</style>
