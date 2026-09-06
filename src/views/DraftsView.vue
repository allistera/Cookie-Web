<script setup>
import { onMounted } from 'vue'
import { useInboxStore } from '../stores/inbox'

const store = useInboxStore()

onMounted(() => {
  store.loadDrafts()
})

// Drafts are edited constantly, so "when" is more usefully relative than
// absolute: an exact timestamp on something saved 20 seconds ago reads as
// noise.
function formatUpdatedAt(updatedAt) {
  const saved = new Date(updatedAt)
  if (Number.isNaN(saved.getTime())) return ''
  const minutes = Math.round((Date.now() - saved.getTime()) / 60_000)
  if (minutes < 1) return 'Saved just now'
  if (minutes < 60) return `Saved ${minutes}m ago`
  if (minutes < 60 * 24) return `Saved ${Math.round(minutes / 60)}h ago`
  return `Saved ${saved.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
}

// A draft's first line stands in for a subject when there isn't one, the way
// the mail list falls back to a snippet.
function draftPreview(draft) {
  const text = String(draft.preview ?? draft.text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > 140 ? `${text.slice(0, 140)}…` : text
}

async function openDraft(draft) {
  await store.openDraft(draft)
}

async function discard(draft) {
  await store.discardDraft(draft.id)
  // Reopening the composer on a row that no longer exists would silently
  // create a second draft, so close it if this was the one being edited.
  if (store.composerDraftId === draft.id) store.closeComposer({ save: false })
}
</script>

<template>
  <div class="drafts-view">
    <header class="drafts-header">
      <h1>Drafts</h1>
      <p class="drafts-subtitle">
        Unsent messages, saved as you type. Open one to pick up where you left off.
      </p>
    </header>

    <div v-if="store.isDraftsLoading && !store.drafts.length" class="drafts-empty">
      Loading your drafts…
    </div>

    <div v-else-if="!store.drafts.length" class="drafts-empty">
      Nothing saved. Anything you start writing shows up here.
    </div>

    <ul v-else class="drafts-list">
      <li v-for="draft in store.drafts" :key="draft.id" class="drafts-row">
        <button type="button" class="drafts-open" @click="openDraft(draft)">
          <span class="drafts-line">
            <span class="drafts-subject">{{ draft.subject || '(no subject)' }}</span>
            <span
              v-if="draft.attachmentCount ?? draft.attachments?.length"
              class="drafts-attachments"
            >
              <span class="material-symbols-outlined" aria-hidden="true">attach_file</span>
              {{ draft.attachmentCount ?? draft.attachments.length }}
            </span>
          </span>
          <span class="drafts-to">{{ draft.to || 'No recipient yet' }}</span>
          <span v-if="draftPreview(draft)" class="drafts-preview">{{ draftPreview(draft) }}</span>
        </button>
        <span class="drafts-time">{{ formatUpdatedAt(draft.updatedAt) }}</span>
        <button
          type="button"
          class="drafts-discard"
          :aria-label="`Discard ${draft.subject || 'draft'}`"
          @click="discard(draft)"
        >
          Discard
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.drafts-view {
  max-width: 720px;
  margin: 0 auto;
  padding: 32px 24px;
}

.drafts-header h1 {
  margin: 0 0 4px;
  font-size: 22px;
  font-weight: 700;
}

.drafts-subtitle {
  margin: 0 0 24px;
  color: var(--text-secondary);
  font-size: 14px;
}

.drafts-empty {
  padding: 32px 0;
  color: var(--text-secondary);
  font-size: 14px;
  text-align: center;
}

.drafts-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.drafts-row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background: var(--bg-card);
}

.drafts-open {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1 1 auto;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}

.drafts-line {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.drafts-subject {
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.drafts-attachments {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
  color: var(--text-secondary);
  font-size: 12px;
}

.drafts-attachments > .material-symbols-outlined {
  font-size: 15px;
}

.drafts-to,
.drafts-preview {
  font-size: 12.5px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.drafts-time {
  flex: 0 0 auto;
  font-size: 13px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.drafts-discard {
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

.drafts-discard:hover {
  background: var(--bg-hover);
}
</style>
