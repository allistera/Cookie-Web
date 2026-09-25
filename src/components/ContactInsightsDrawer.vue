<script setup>
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'

import { useContactInsightsStore } from '../stores/contactInsights'
import { formatEmailDate } from '../stores/inbox'

const store = useContactInsightsStore()
const draft = reactive({ company: '', role: '', linkedinUrl: '', notes: '' })
const lastSaved = ref('')
const isDirty = ref(false)
let saveTimer
let saveChain = Promise.resolve(true)
let isClosing = false
// App.vue keys the drawer by contact address, so switching contacts unmounts
// this instance — but by then the store already points at the next contact.
// Pin the address this draft belongs to at first sync so persist() always
// PATCHes the owner, never whichever contact is live at unmount time.
let ownerAddress = null

const contact = computed(() => store.contact)
const displayName = computed(() => contact.value?.name || contact.value?.address || 'Contact')
const initials = computed(() => {
  const source = contact.value?.name || contact.value?.address?.split('@')[0] || ''
  return (
    source
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || '?'
  )
})

function snapshot() {
  return JSON.stringify(draft)
}

function syncDraft(value) {
  if (!value || isDirty.value) return
  // A live-contact change to a different address means this instance is
  // being replaced; never let the next contact's data into this draft.
  if (ownerAddress && value.address !== ownerAddress) return
  ownerAddress = value.address
  draft.company = value.company || ''
  draft.role = value.role || ''
  draft.linkedinUrl = value.linkedinUrl || ''
  draft.notes = value.notes || ''
  lastSaved.value = snapshot()
}

watch(contact, syncDraft, { immediate: true })

function persist() {
  window.clearTimeout(saveTimer)
  const address = ownerAddress
  const fields = { ...draft }
  const value = JSON.stringify(fields)
  if (!address || !isDirty.value || value === lastSaved.value) return Promise.resolve(true)
  isDirty.value = false
  // Don't flag the next contact as saving when this draft is flushed on unmount.
  if (store.contact?.address === address) store.saveState = 'saving'
  saveChain = saveChain.then(async () => {
    if (await store.saveContact(address, fields)) {
      lastSaved.value = value
      return true
    }
    if (snapshot() === value) isDirty.value = true
    return false
  })
  return saveChain
}

function scheduleSave() {
  isDirty.value = true
  store.saveState = 'saving'
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => void persist(), 700)
}

// Repeat calls (double-click, Escape while a close is pending) share one
// attempt, so a second call can't see the retry's cleared dirty flag and
// close the drawer before that retry has saved.
let closeTask = null

function close() {
  closeTask ??= closeAfterSaving().finally(() => {
    closeTask = null
  })
  return closeTask
}

async function closeAfterSaving() {
  isClosing = true
  window.clearTimeout(saveTimer)
  // Wait for any in-flight save (e.g. from blur) and the final save before
  // closing: if either fails, keep the drawer open with the error state
  // visible and the draft dirty so the next persist (typing, blur, or
  // closing again) retries it.
  await saveChain
  if (!(await persist())) {
    isClosing = false
    return
  }
  store.close()
}

function onKeydown(event) {
  if (event.key === 'Escape') void close()
}

onBeforeUnmount(() => {
  window.clearTimeout(saveTimer)
  if (!isClosing) void persist()
})
</script>

<template>
  <aside class="contact-insights-drawer" aria-label="Contact insights" @keydown="onKeydown">
    <header class="contact-insights-header">
      <h2>Contact insights</h2>
      <button type="button" aria-label="Close contact insights" @click="close">
        <span class="material-symbols-outlined" aria-hidden="true">close</span>
      </button>
    </header>

    <div v-if="store.isLoading" class="contact-insights-loading" role="status">
      <span class="spinner" aria-hidden="true"></span>
      Loading contact…
    </div>

    <div v-else-if="contact" class="contact-insights-content">
      <section class="contact-identity">
        <span class="contact-insights-avatar" aria-hidden="true">{{ initials }}</span>
        <span>
          <strong>{{ displayName }}</strong>
          <span>{{ contact.address }}</span>
        </span>
      </section>

      <section class="contact-profile" aria-label="Contact profile">
        <label>
          <span>Company</span>
          <input
            v-model="draft.company"
            maxlength="200"
            placeholder="Add company"
            @input="scheduleSave"
            @blur="persist"
          />
        </label>
        <label>
          <span>Role</span>
          <input
            v-model="draft.role"
            maxlength="200"
            placeholder="Add role"
            @input="scheduleSave"
            @blur="persist"
          />
        </label>
        <label>
          <span>LinkedIn</span>
          <span class="contact-social-input">
            <span class="contact-linkedin-mark" aria-hidden="true">in</span>
            <input
              v-model="draft.linkedinUrl"
              type="url"
              maxlength="500"
              placeholder="https://linkedin.com/in/…"
              @input="scheduleSave"
              @blur="persist"
            />
            <a
              v-if="contact.linkedinUrl"
              :href="contact.linkedinUrl"
              target="_blank"
              rel="noreferrer"
              aria-label="Open LinkedIn profile"
            >
              <span class="material-symbols-outlined" aria-hidden="true">open_in_new</span>
            </a>
          </span>
        </label>
      </section>

      <section class="contact-insights-section">
        <div class="contact-section-heading">
          <span>
            <h3>Private notes</h3>
            <small>Only visible to you</small>
          </span>
          <small
            class="contact-save-state"
            :class="{ error: store.saveState === 'error' }"
            role="status"
          >
            {{
              store.saveState === 'saving'
                ? 'Saving…'
                : store.saveState === 'saved'
                  ? 'Saved'
                  : store.saveState === 'error'
                    ? 'Save failed'
                    : ''
            }}
          </small>
        </div>
        <textarea
          v-model="draft.notes"
          maxlength="10000"
          rows="5"
          placeholder="Add a private note about this contact…"
          @input="scheduleSave"
          @blur="persist"
        ></textarea>
      </section>

      <section class="contact-insights-section">
        <div class="contact-section-heading">
          <h3>Recent emails</h3>
          <small>Newest first</small>
        </div>
        <p v-if="store.loadError" class="contact-history-state">{{ store.loadError }}</p>
        <p v-else-if="!store.history.length" class="contact-history-state">
          No previous emails with this contact.
        </p>
        <div v-else class="contact-history-list">
          <button
            v-for="message in store.history"
            :key="message.id"
            type="button"
            class="contact-history-row"
            @click="store.openHistoryEmail(message)"
          >
            <span class="contact-history-main">
              <strong>{{ message.subject || '(No subject)' }}</strong>
              <span>{{ message.is_sent ? 'To ' + displayName : 'From ' + displayName }}</span>
              <small>{{ message.snippet || 'No preview available' }}</small>
            </span>
            <time :datetime="message.sent_at">{{ formatEmailDate(message.sent_at) }}</time>
          </button>
        </div>
        <button
          v-if="store.nextCursor"
          type="button"
          class="contact-history-more"
          :disabled="store.isLoadingMore"
          @click="store.loadContact({ more: true })"
        >
          {{ store.isLoadingMore ? 'Loading…' : 'Load more' }}
        </button>
      </section>
    </div>
  </aside>
</template>

<style scoped>
.contact-insights-drawer {
  width: 380px;
  min-width: 380px;
  height: 100%;
  overflow-y: auto;
  border: 1px solid var(--border-color);
  border-left: 0;
  border-radius: 0 8px 8px 0;
  background: var(--bg-card);
  box-shadow: -12px 0 32px rgba(0, 0, 0, 0.08);
  color: var(--text-primary);
}

.contact-insights-header {
  position: sticky;
  top: 0;
  z-index: var(--z-header);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 17px 20px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-card);
}

.contact-insights-header h2 {
  margin: 0;
  font-size: 17px;
}

.contact-insights-header button {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.contact-insights-header button:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.contact-insights-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 180px;
  color: var(--text-secondary);
  font-size: 14px;
}

.contact-insights-content {
  padding: 20px;
}

.contact-identity {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 20px;
}

.contact-identity > span:last-child {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}

.contact-identity strong {
  overflow: hidden;
  font-size: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.contact-identity span span {
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.contact-insights-avatar {
  display: grid;
  width: 48px;
  height: 48px;
  flex-shrink: 0;
  place-items: center;
  border-radius: 50%;
  background: var(--accent-soft);
  color: var(--text-blue);
  font-size: 16px;
  font-weight: 700;
}

.contact-profile {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-bottom: 20px;
}

.contact-profile label {
  display: grid;
  grid-template-columns: 82px minmax(0, 1fr);
  align-items: center;
  min-height: 36px;
  color: var(--text-secondary);
  font-size: 13px;
}

.contact-profile input {
  min-width: 0;
  padding: 7px 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
}

.contact-profile input:hover,
.contact-profile input:focus {
  border-color: var(--border-color);
  background: var(--bg-hover);
  outline: none;
}

.contact-social-input {
  display: flex;
  min-width: 0;
  align-items: center;
}

.contact-social-input input {
  flex: 1;
}

.contact-linkedin-mark {
  display: grid;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  place-items: center;
  border-radius: 3px;
  background: #0a66c2;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
}

.contact-social-input a {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  color: var(--text-blue);
}

.contact-social-input .material-symbols-outlined {
  font-size: 17px;
}

.contact-insights-section {
  padding: 20px 0;
  border-top: 1px solid var(--border-color);
}

.contact-section-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.contact-section-heading > span {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.contact-section-heading h3 {
  margin: 0;
  font-size: 14px;
}

.contact-section-heading small {
  color: var(--text-secondary);
  font-size: 11px;
}

.contact-save-state.error {
  color: var(--danger, #e5484d);
}

.contact-insights-section textarea {
  width: 100%;
  resize: vertical;
  padding: 10px 11px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-card);
  color: var(--text-primary);
  font: inherit;
  font-size: 13px;
  line-height: 1.5;
}

.contact-insights-section textarea:focus {
  border-color: var(--text-blue);
  box-shadow: 0 0 0 3px var(--accent-soft);
  outline: none;
}

.contact-history-list {
  display: flex;
  flex-direction: column;
}

.contact-history-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  padding: 11px 2px;
  border: 0;
  border-bottom: 1px solid var(--border-color);
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.contact-history-row:hover {
  background: var(--bg-hover);
}

.contact-history-main {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 3px;
}

.contact-history-main strong,
.contact-history-main small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.contact-history-main strong {
  font-size: 13px;
}

.contact-history-main span,
.contact-history-main small,
.contact-history-row time {
  color: var(--text-secondary);
  font-size: 11px;
}

.contact-history-row time {
  flex-shrink: 0;
}

.contact-history-state {
  margin: 24px 0;
  color: var(--text-secondary);
  font-size: 13px;
  text-align: center;
}

.contact-history-more {
  width: 100%;
  margin-top: 14px;
  padding: 8px;
  border: 1px solid var(--border-color);
  border-radius: 7px;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.contact-history-more:hover:not(:disabled) {
  background: var(--bg-hover);
}

@media (max-width: 700px) {
  .contact-insights-drawer {
    position: fixed;
    inset: 52px 0 0;
    z-index: var(--z-drawer);
    width: 100%;
    min-width: 0;
    height: auto;
    border: 0;
    border-radius: 0;
  }
}
</style>
