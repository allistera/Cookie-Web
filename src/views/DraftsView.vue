<script setup>
import { computed, onMounted, ref } from 'vue'
import { formatEmailDate, useInboxStore } from '../stores/inbox'

const store = useInboxStore()
const discardingIds = ref(new Set())

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

const recoveryRows = computed(() =>
  store.draftRecoveries.map((record) => ({
    record,
    recipient: recipient(record.snapshot),
    preview: draftPreview(record.snapshot),
  })),
)

const draftRows = computed(() =>
  store.drafts.map((draft) => ({
    draft,
    recipient: recipient(draft),
    preview: draftPreview(draft),
    attachments: attachmentCount(draft),
    attachmentLabel: attachmentTitle(draft),
    updatedLabel: formatUpdatedAt(draft.updatedAt),
  })),
)

async function discard(draft) {
  if (discardingIds.value.has(draft.id)) return
  discardingIds.value = new Set(discardingIds.value).add(draft.id)
  // Close the composer before awaiting deletion so a pending debounced
  // autosave cannot recreate the draft while DELETE is in flight.
  if (store.composerDraftId === draft.id) store.closeComposer({ save: false })
  const tab = store.dockTabs.find((entry) => (entry.snapshot ?? entry.stored)?.draftId === draft.id)
  if (tab) store.closeDockTab(tab.key)
  try {
    await store.discardDraft(draft.id)
  } catch (error) {
    console.error('Failed to discard draft:', error)
    store.notify('Failed to discard draft.', 'error')
  } finally {
    const next = new Set(discardingIds.value)
    next.delete(draft.id)
    discardingIds.value = next
  }
}

function discardRecovery(record) {
  if (window.confirm('Discard this local recovery copy? This cannot be undone.')) {
    if (store.composerRecoveryId === record.id) store.closeComposer({ save: false })
    const tab = store.dockTabs.find((entry) => entry.snapshot?.recoveryId === record.id)
    if (tab) store.closeDockTab(tab.key)
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
          v-for="row in recoveryRows"
          :key="row.record.id"
          class="ni-row drafts-row"
          role="button"
          tabindex="0"
          :aria-label="`${row.recipient}: ${row.record.snapshot.subject || '(no subject)'}`"
          @click="store.openRecoveredDraft(row.record)"
          @keydown.enter.self.prevent="store.openRecoveredDraft(row.record)"
          @keydown.space.self.prevent="store.openRecoveredDraft(row.record)"
        >
          <div class="ni-lead"></div>
          <div class="ni-sender">{{ row.recipient }}</div>
          <div class="ni-subject">
            <span class="ni-subject-text">
              {{ row.record.snapshot.subject || '(no subject)' }}
              <span v-if="row.preview" class="drafts-preview">{{ row.preview }}</span>
            </span>
          </div>
          <div class="ni-date">
            {{
              row.record.durable
                ? 'Saved on this device'
                : 'Storage unavailable — keep this tab open'
            }}
          </div>
          <div class="ni-actions" @click.stop>
            <button
              type="button"
              class="ni-action-btn"
              title="Discard"
              :aria-label="`Discard local copy of ${row.record.snapshot.subject || 'draft'}`"
              @click="discardRecovery(row.record)"
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
          v-for="row in draftRows"
          :key="row.draft.id"
          class="ni-row drafts-row"
          role="button"
          tabindex="0"
          :aria-label="`${row.recipient}: ${row.draft.subject || '(no subject)'}`"
          @click="store.openDraft(row.draft)"
          @keydown.enter.self.prevent="store.openDraft(row.draft)"
          @keydown.space.self.prevent="store.openDraft(row.draft)"
        >
          <div class="ni-lead"></div>
          <div class="ni-sender">{{ row.recipient }}</div>
          <div class="ni-subject">
            <span class="ni-subject-text">
              {{ row.draft.subject || '(no subject)' }}
              <span v-if="row.preview" class="drafts-preview">{{ row.preview }}</span>
            </span>
          </div>
          <div class="ni-date">
            <span
              v-if="row.attachments"
              class="material-symbols-outlined ni-row-attachment-icon"
              :title="row.attachmentLabel"
              :aria-label="row.attachmentLabel"
              >attach_file</span
            >
            <span class="drafts-time">{{ row.updatedLabel }}</span>
          </div>
          <div class="ni-actions" @click.stop>
            <button
              type="button"
              class="ni-action-btn"
              title="Discard"
              :aria-label="`Discard ${row.draft.subject || 'draft'}`"
              :disabled="discardingIds.has(row.draft.id)"
              @click="discard(row.draft)"
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
