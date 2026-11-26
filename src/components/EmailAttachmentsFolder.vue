<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { fileIcon, fileKind, formatBytes } from '../lib/documentFiles'
import {
  attachmentDate,
  attachmentEmailRow,
  attachmentSummary,
  EMAIL_ATTACHMENTS_TITLE,
  fetchEmailAttachments,
  groupAttachmentsByMonth,
} from '../lib/emailAttachments'
import { useInboxStore } from '../stores/inbox'

// The Email attachments folder of the Documents area: every file the mailbox
// received or sent, newest first under a heading per month. The files stay
// with their emails; this is a way to find them, so nothing here renames,
// moves or deletes.
const inbox = useInboxStore()
const router = useRouter()

const DIRECTIONS = [
  { id: 'all', label: 'All' },
  { id: 'received', label: 'Received' },
  { id: 'sent', label: 'Sent' },
]
const direction = ref('all')
// Logos, signatures and other pictures that belong to an email's body are
// most of what mail carries, so they stay out unless asked for.
const showEmbedded = ref(false)

const attachments = ref([])
const nextCursor = ref(null)
const isLoading = ref(true)
const isLoadingOlder = ref(false)
const loadError = ref('')
// Bumped by every fresh load, so a slower answer for the previous tab (or an
// older page of it) is dropped instead of landing in the new list.
let listGeneration = 0

async function load() {
  const generation = ++listGeneration
  isLoading.value = true
  loadError.value = ''
  try {
    const page = await fetchEmailAttachments({
      direction: direction.value,
      embedded: showEmbedded.value,
    })
    if (generation !== listGeneration) return
    attachments.value = page.attachments
    nextCursor.value = page.nextCursor
  } catch (error) {
    if (generation !== listGeneration) return
    console.error('Failed to load email attachments:', error)
    attachments.value = []
    nextCursor.value = null
    loadError.value = 'Could not load your email attachments.'
  } finally {
    if (generation === listGeneration) isLoading.value = false
  }
}

async function loadOlder() {
  if (!nextCursor.value || isLoadingOlder.value) return
  const generation = listGeneration
  isLoadingOlder.value = true
  try {
    const page = await fetchEmailAttachments({
      direction: direction.value,
      embedded: showEmbedded.value,
      before: nextCursor.value,
    })
    if (generation !== listGeneration) return
    attachments.value = [...attachments.value, ...page.attachments]
    nextCursor.value = page.nextCursor
  } catch (error) {
    console.error('Failed to load older email attachments:', error)
    if (generation === listGeneration) {
      inbox.notify('Could not load older attachments. Please try again.', 'error')
    }
  } finally {
    isLoadingOlder.value = false
  }
}

function setDirection(id) {
  if (direction.value === id) return
  direction.value = id
  void load()
}

function onEmbeddedChange(event) {
  showEmbedded.value = event.target.checked
  void load()
}

onMounted(load)

const groups = computed(() => groupAttachmentsByMonth(attachments.value))

const emptyText = computed(() => {
  if (direction.value === 'received') return 'No files received by email yet.'
  if (direction.value === 'sent') return 'No files sent by email yet.'
  return 'No email attachments yet. Files you receive or send by email appear here.'
})

const DAY_FMT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' })
function formatDay(attachment) {
  const date = attachmentDate(attachment)
  return date ? DAY_FMT.format(date) : ''
}

function fileName(attachment) {
  return attachment.filename || 'Untitled attachment'
}

function kindLabel(attachment) {
  return attachment.embedded ? 'Picture in email' : fileKind(attachment.contentType)
}

function sizeLabel(attachment) {
  return (attachment.sizeBytes ?? null) === null ? '' : formatBytes(attachment.sizeBytes)
}

function download(attachment) {
  return inbox.downloadAttachment({
    id: attachment.id,
    downloadable: attachment.downloadable,
    filename: fileName(attachment),
  })
}

// The reader has no route of its own: the inbox store opens the email and
// the inbox view shows it, as it does for a search result.
function openEmail(attachment) {
  inbox.openEmailFromSearch(attachmentEmailRow(attachment))
  return router.push('/inbox')
}
</script>

<template>
  <section
    class="email-attachments"
    :aria-label="EMAIL_ATTACHMENTS_TITLE"
    data-testid="email-attachments"
  >
    <header class="attachments-toolbar">
      <nav class="attachments-breadcrumb" aria-label="Folder path">
        <button type="button" class="attachments-refresh" aria-label="Refresh" @click="load">
          <span class="material-symbols-outlined" aria-hidden="true">refresh</span>
        </button>
        <router-link to="/documents">Documents</router-link>
        <span class="crumb-separator" aria-hidden="true">›</span>
        <span aria-current="location">{{ EMAIL_ATTACHMENTS_TITLE }}</span>
      </nav>
      <div class="attachments-directions" role="group" aria-label="Show">
        <button
          v-for="option in DIRECTIONS"
          :key="option.id"
          type="button"
          :class="{ active: direction === option.id }"
          :aria-pressed="direction === option.id"
          :data-direction="option.id"
          @click="setDirection(option.id)"
        >
          {{ option.label }}
        </button>
      </div>
    </header>

    <div class="attachments-options">
      <p class="attachments-hint">
        Files from your email, newest first. Select a file to download it, or open the email it came
        with.
      </p>
      <label class="attachments-embedded">
        <input type="checkbox" :checked="showEmbedded" @change="onEmbeddedChange" />
        <span>Show pictures from email bodies</span>
      </label>
    </div>

    <!-- Loading, then error, then empty: the empty message must never stand
         in for a request that is still running or that failed. -->
    <div
      v-if="isLoading"
      class="attachments-loading"
      role="status"
      aria-label="Loading email attachments"
    >
      <div class="spinner"></div>
    </div>

    <div v-else-if="loadError" class="attachments-error" role="alert">
      <p>{{ loadError }}</p>
      <button type="button" class="btn btn-secondary" @click="load">Try again</button>
    </div>

    <p v-else-if="!attachments.length" class="attachments-empty">{{ emptyText }}</p>

    <template v-else>
      <section
        v-for="group in groups"
        :key="group.key"
        class="attachments-month"
        :aria-label="group.label"
      >
        <h2 class="attachments-month-heading">{{ group.label }}</h2>
        <ul class="attachments-list">
          <li
            v-for="attachment in group.attachments"
            :key="attachment.id"
            class="attachment-row"
            :data-direction="attachment.direction"
          >
            <span class="material-symbols-outlined attachment-icon" aria-hidden="true">{{
              fileIcon(attachment.contentType)
            }}</span>
            <div class="attachment-main">
              <button
                v-if="attachment.downloadable"
                type="button"
                class="attachment-name"
                :title="`Download ${fileName(attachment)}`"
                @click="download(attachment)"
              >
                {{ fileName(attachment) }}
              </button>
              <span v-else class="attachment-name" :title="fileName(attachment)">{{
                fileName(attachment)
              }}</span>
              <span class="attachment-meta">
                <span v-if="direction === 'all'" class="attachment-direction">{{
                  attachment.direction === 'sent' ? 'Sent' : 'Received'
                }}</span>
                {{ attachmentSummary(attachment) }}
              </span>
            </div>
            <span class="attachment-kind">{{ kindLabel(attachment) }}</span>
            <span class="attachment-size">{{ sizeLabel(attachment) }}</span>
            <span class="attachment-date">{{ formatDay(attachment) }}</span>
            <span class="attachment-actions">
              <button
                type="button"
                class="attachment-action"
                :aria-label="`Open the email with ${fileName(attachment)}`"
                title="Open email"
                @click="openEmail(attachment)"
              >
                <span class="material-symbols-outlined" aria-hidden="true">mail</span>
              </button>
              <button
                v-if="attachment.downloadable"
                type="button"
                class="attachment-action"
                :aria-label="`Download ${fileName(attachment)}`"
                title="Download"
                @click="download(attachment)"
              >
                <span class="material-symbols-outlined" aria-hidden="true">download</span>
              </button>
              <button
                v-else
                type="button"
                class="attachment-action"
                disabled
                :aria-label="`${fileName(attachment)} was not stored and cannot be downloaded`"
                title="Not stored: this file cannot be downloaded"
              >
                <span class="material-symbols-outlined" aria-hidden="true">download</span>
              </button>
            </span>
          </li>
        </ul>
      </section>

      <div v-if="nextCursor" class="attachments-pagination">
        <button
          type="button"
          class="btn btn-secondary"
          :disabled="isLoadingOlder"
          @click="loadOlder"
        >
          {{ isLoadingOlder ? 'Loading…' : 'Older attachments' }}
        </button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.email-attachments {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 60vh;
}
.attachments-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 10px 14px;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 12px;
}
.attachments-breadcrumb {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 16px;
  color: var(--text-primary);
}
.attachments-breadcrumb a {
  color: var(--text-secondary);
  text-decoration: none;
}
.attachments-breadcrumb a:hover {
  color: var(--text-primary);
  text-decoration: underline;
}
.crumb-separator {
  color: var(--text-secondary);
}
.attachments-refresh,
.attachment-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}
.attachments-refresh:hover,
.attachment-action:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.attachment-action:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.attachments-directions {
  display: inline-flex;
  padding: 2px;
  border-radius: 8px;
  background: var(--bg-hover);
}
.attachments-directions button {
  padding: 6px 14px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.attachments-directions button:hover {
  color: var(--text-primary);
}
.attachments-directions button.active {
  background: var(--accent);
  color: #fff;
}
.attachments-options {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px 24px;
  flex-wrap: wrap;
  padding: 0 14px;
  font-size: 13px;
  color: var(--text-secondary);
}
.attachments-hint {
  margin: 0;
}
.attachments-embedded {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
  cursor: pointer;
}
.attachments-loading {
  display: flex;
  justify-content: center;
  padding: 48px 0;
}
.attachments-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 24px;
  color: var(--text-secondary);
}
.attachments-error p,
.attachments-empty {
  margin: 0;
}
.attachments-empty {
  padding: 24px;
  color: var(--text-secondary);
  text-align: center;
}
.attachments-month-heading {
  margin: 4px 14px 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
}
.attachments-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.attachment-row {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) 120px 80px 64px 72px;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  margin-bottom: 6px;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 8px;
}
.attachment-row:hover {
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08);
}
.attachment-icon {
  font-size: 24px;
  text-align: center;
  color: var(--text-secondary);
}
.attachment-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.attachment-name {
  max-width: 100%;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-weight: 600;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
button.attachment-name {
  align-self: flex-start;
  cursor: pointer;
}
button.attachment-name:hover {
  text-decoration: underline;
}
.attachment-meta {
  font-size: 12.5px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.attachment-direction {
  margin-right: 6px;
  padding: 1px 8px;
  border-radius: 100px;
  background: var(--bg-hover);
  font-size: 11.5px;
}
.attachment-kind,
.attachment-size,
.attachment-date {
  font-size: 13px;
  color: var(--text-secondary);
  white-space: nowrap;
}
.attachment-size,
.attachment-date {
  text-align: right;
}
.attachment-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
}
.attachments-pagination {
  display: flex;
  justify-content: center;
  padding: 8px 0 16px;
}
@media (max-width: 640px) {
  .attachment-row {
    grid-template-columns: 28px minmax(0, 1fr) 72px;
  }
  .attachment-kind,
  .attachment-size,
  .attachment-date {
    display: none;
  }
}
</style>
