<script setup>
import { onMounted } from 'vue'
import { formatEmailDate, useInboxStore } from '../stores/inbox'

const store = useInboxStore()

onMounted(() => {
  store.loadDrafts({ force: true })
  store.loadDraftRecoveries()
})

// The date column reads the way it does in every other mail list. A draft
// with a missing or unreadable save time shows nothing rather than throwing.
function formatUpdatedAt(updatedAt) {
  return Number.isNaN(new Date(updatedAt).getTime()) ? '' : formatEmailDate(updatedAt)
}

// The opening words follow the subject on the row, so a draft with no subject
// yet can still be told apart from the others.
function draftPreview(draft) {
  const text = String(draft.preview ?? draft.text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > 140 ? `${text.slice(0, 140)}…` : text
}

// Sent rows put "To: …" in the sender column; a draft does the same once it
// has someone to go to.
function recipient(draft) {
  return draft.to ? `To: ${draft.to}` : 'No recipient yet'
}

function attachmentCount(draft) {
  return draft.attachmentCount ?? draft.attachments?.length ?? 0
}

function attachmentTitle(draft) {
  const count = attachmentCount(draft)
  return count === 1 ? '1 attachment' : `${count} attachments`
}

async function discard(draft) {
  await store.discardDraft(draft.id)
  // Reopening the composer on a row that no longer exists would silently
  // create a second draft, so close it if this was the one being edited.
  if (store.composerDraftId === draft.id) store.closeComposer({ save: false })
}

function discardRecovery(record) {
  if (window.confirm('Discard this local recovery copy? This cannot be undone.')) {
    if (store.composerRecoveryId === record.id) store.closeComposer({ save: false })
    store.discardComposerRecovery(record.id, record.owner)
  }
}
</script>

<template>
  <!-- The same panel, header and rows as the Sent and label folders (the
       global .ni-* classes in main.css), so Drafts reads as one more mail
       list rather than a page of its own. -->
  <div class="view-panel active drafts-view">
    <div class="ni-header">
      <div class="ni-title">
        <span class="material-symbols-outlined ni-title-icon" aria-hidden="true">draft</span>
        <h1>Drafts</h1>
      </div>
    </div>

    <div class="ni-list">
      <section v-if="store.draftRecoveries.length" aria-labelledby="recovered-drafts-title">
        <h2 id="recovered-drafts-title" class="ni-group-header drafts-group">
          Recoverable local drafts
        </h2>
        <p class="drafts-note">
          These edits have not been saved to your account. Open a copy to review and retry. Local
          copies are removed when you log out.
        </p>
        <div
          v-for="record in store.draftRecoveries"
          :key="record.id"
          class="ni-row drafts-row"
          role="button"
          tabindex="0"
          :aria-label="`${recipient(record.snapshot)}: ${record.snapshot.subject || '(no subject)'}`"
          @click="store.openRecoveredDraft(record)"
          @keydown.enter.self.prevent="store.openRecoveredDraft(record)"
        >
          <div class="ni-lead"></div>
          <div class="ni-sender">{{ recipient(record.snapshot) }}</div>
          <div class="ni-subject">
            <span class="ni-subject-text">
              {{ record.snapshot.subject || '(no subject)' }}
              <span v-if="draftPreview(record.snapshot)" class="drafts-preview">{{
                draftPreview(record.snapshot)
              }}</span>
            </span>
          </div>
          <div class="ni-date">
            {{
              record.durable ? 'Saved on this device' : 'Storage unavailable — keep this tab open'
            }}
          </div>
          <div class="ni-actions" @click.stop>
            <button
              type="button"
              class="ni-action-btn"
              title="Discard"
              :aria-label="`Discard local copy of ${record.snapshot.subject || 'draft'}`"
              @click="discardRecovery(record)"
            >
              <span class="material-symbols-outlined" aria-hidden="true">delete</span>
            </button>
          </div>
        </div>
      </section>

      <div v-if="store.isDraftsLoading && !store.draftCount" class="ni-empty" role="status">
        Loading your drafts…
      </div>

      <div v-else-if="!store.draftCount" class="ni-empty">
        Nothing saved. Anything you start writing shows up here.
      </div>

      <template v-else-if="store.drafts.length">
        <!-- Only needed to part the two kinds of draft; alone, the page
             heading already says what the rows are. -->
        <h2 v-if="store.draftRecoveries.length" class="ni-group-header drafts-group">
          Saved to your account
        </h2>
        <div
          v-for="draft in store.drafts"
          :key="draft.id"
          class="ni-row drafts-row"
          role="button"
          tabindex="0"
          :aria-label="`${recipient(draft)}: ${draft.subject || '(no subject)'}`"
          @click="store.openDraft(draft)"
          @keydown.enter.self.prevent="store.openDraft(draft)"
        >
          <div class="ni-lead"></div>
          <div class="ni-sender">{{ recipient(draft) }}</div>
          <div class="ni-subject">
            <span class="ni-subject-text">
              {{ draft.subject || '(no subject)' }}
              <span v-if="draftPreview(draft)" class="drafts-preview">{{
                draftPreview(draft)
              }}</span>
            </span>
          </div>
          <div class="ni-date">
            <span
              v-if="attachmentCount(draft)"
              class="material-symbols-outlined ni-row-attachment-icon"
              :title="attachmentTitle(draft)"
              :aria-label="attachmentTitle(draft)"
              >attach_file</span
            >
            <span class="drafts-time">{{ formatUpdatedAt(draft.updatedAt) }}</span>
          </div>
          <div class="ni-actions" @click.stop>
            <button
              type="button"
              class="ni-action-btn"
              title="Discard"
              :aria-label="`Discard ${draft.subject || 'draft'}`"
              @click="discard(draft)"
            >
              <span class="material-symbols-outlined" aria-hidden="true">delete</span>
            </button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* The band that names a group of drafts. It borrows the inbox's day-group
   look but is a plain heading: there is nothing to collapse. */
.drafts-group {
  cursor: default;
}

.drafts-note {
  margin: 0;
  padding: 4px 16px 8px;
  color: var(--text-secondary);
  font-size: 12.5px;
}

.drafts-preview {
  margin-left: 6px;
  opacity: 0.7;
}

/* The inbox has keyboard shortcuts for its row actions; here Discard is the
   only one, so tabbing onto a row brings it within reach as hovering does. */
.drafts-row:focus-within .ni-actions {
  display: flex;
}

.drafts-row:focus-within .ni-date {
  display: none;
}
</style>
