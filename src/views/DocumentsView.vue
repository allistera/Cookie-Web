<script setup>
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'

import { useDocumentsStore } from '../stores/documents'
import NewDocumentDialog from '../components/NewDocumentDialog.vue'
import DocumentCalendarSidebar from '../components/DocumentCalendarSidebar.vue'

// The dashboard only needs document metadata. Keep Editor.js and its tools out
// of that route payload until a specific document is actually opened.
const DocumentEditor = defineAsyncComponent(() => import('../components/DocumentEditor.vue'))

const store = useDocumentsStore()
const route = useRoute()
const router = useRouter()
const editorComponent = ref(null)
const isCopying = ref(false)
const aiPanelOpen = ref(false)
const aiDraft = ref('')
const aiButton = ref(null)
const aiCloseButton = ref(null)

async function toggleAiPanel() {
  if (aiPanelOpen.value) return closeAiPanel()
  aiPanelOpen.value = true
  await nextTick()
  aiCloseButton.value?.focus()
}

function closeAiPanel() {
  aiPanelOpen.value = false
  aiButton.value?.focus()
}

function onAiEscape(event) {
  if (event.key === 'Escape' && !event.defaultPrevented && aiPanelOpen.value) {
    event.preventDefault()
    closeAiPanel()
  }
}
onMounted(() => window.addEventListener('keydown', onAiEscape))
onBeforeUnmount(() => window.removeEventListener('keydown', onAiEscape))

async function flushEditor() {
  await editorComponent.value?.flushPendingBlocks?.()
  return store.flushPendingSave()
}

function warnBeforeUnload(event) {
  if (!['saving', 'error'].includes(store.saveState)) return
  event.preventDefault()
  event.returnValue = ''
}
onMounted(() => window.addEventListener('beforeunload', warnBeforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', warnBeforeUnload))

async function saveCopy() {
  if (isCopying.value) return
  isCopying.value = true
  try {
    await editorComponent.value?.flushPendingBlocks?.()
    const copy = await store.saveConflictAsCopy()
    if (copy) await router.push(`/documents/${copy.id}`)
  } finally {
    isCopying.value = false
  }
}

onBeforeRouteLeave(flushEditor)
onBeforeRouteUpdate(flushEditor)

// /documents shows the dashboard; /documents/:id opens that document.
watch(
  () => route.params.id,
  (id) => {
    if (route.name !== 'documents') return
    aiPanelOpen.value = false
    aiDraft.value = ''
    store.openDocument(id || null)
  },
  { immediate: true },
)

// Leaving the app entirely must not drop an edit still on the debounce timer.
onBeforeUnmount(() => {
  void flushEditor()
})

const starredOnly = ref(false)
const activeTag = computed(() => {
  const value = Array.isArray(route.query.tag) ? route.query.tag[0] : route.query.tag
  return String(value ?? '')
})
// A search in the header replaces the dashboard list with its results (the
// sidebar's folder tree is unaffected — see stores/documents.js's
// searchResults comment); star/tag filters still apply on top of whichever
// list is showing.
const dashboardDocs = computed(() => {
  let documents = store.activeSearchQuery ? store.searchResults : store.documents
  if (starredOnly.value) documents = documents.filter((doc) => doc.starred)
  if (activeTag.value) documents = documents.filter((doc) => doc.tags?.includes(activeTag.value))
  return documents
})

const folderTitles = computed(() => {
  const titles = new Map(store.folders.map((folder) => [folder.id, folder.title]))
  return (doc) => (doc.folder_id ? (titles.get(doc.folder_id) ?? '') : '')
})

const saveStatusText = computed(() => {
  if (store.saveState === 'saving') return 'Saving…'
  if (store.saveState === 'saved') return 'All changes saved'
  if (store.saveConflict) return 'Changed elsewhere — save your edits as a copy'
  if (store.saveState === 'error') return 'Save failed — your edits are still open'
  return ''
})

function formatUpdated(value) {
  return new Date(value).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function newDocument() {
  store.openNewDocumentDialog()
}

async function deleteFromDashboard(doc) {
  await store.deleteDocument(doc.id)
}

function onEditorSave(payload) {
  if (payload.id) store.scheduleContentSave(payload.id, payload)
}
</script>

<template>
  <div class="documents-view">
    <!-- Editor -->
    <template v-if="route.params.id">
      <div class="editor-statusbar">
        <div class="editor-save-navigation">
          <router-link to="/documents" class="back-link" aria-label="Back to all documents">
            <span class="material-symbols-outlined" aria-hidden="true">arrow_back</span>
          </router-link>
          <div class="save-status" :class="`save-${store.saveState}`">
            <button
              ref="aiButton"
              type="button"
              class="document-ai-toggle"
              aria-label="Open document AI"
              title="Open document AI"
              :aria-expanded="aiPanelOpen"
              aria-controls="document-ai-panel"
              @click="toggleAiPanel"
            >
              <svg
                class="save-ai-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="m12 3 2.7 6.3L21 12l-6.3 2.7L12 21l-2.7-6.3L3 12l6.3-2.7L12 3Z" />
                <path d="M20 2v4M18 4h4M4 18v4M2 20h4" />
              </svg>
            </button>
            <span
              role="status"
              :title="saveStatusText"
              :class="{ 'saved-status-text': store.saveState === 'saved' }"
              >{{ saveStatusText }}</span
            >
          </div>
        </div>
        <div v-if="store.saveState === 'error'" class="save-actions">
          <button
            v-if="!store.saveConflict"
            type="button"
            :disabled="isCopying"
            @click="flushEditor"
          >
            Retry save
          </button>
          <button type="button" :disabled="isCopying" @click="saveCopy">
            {{ isCopying ? 'Saving copy…' : 'Save a copy' }}
          </button>
        </div>
      </div>
      <div v-if="store.isOpenDocLoading" class="documents-loading">
        <div class="spinner"></div>
      </div>
      <div v-else-if="store.openDoc" class="editor-with-sidebar">
        <DocumentEditor
          ref="editorComponent"
          class="editor-column"
          :doc="store.openDoc"
          :is-daily-note="Boolean(store.openDocDailyDate)"
          @save="onEditorSave"
          @dirty="store.markContentDirty()"
        />
        <DocumentCalendarSidebar v-if="store.openDocDailyDate" :date="store.openDocDailyDate" />
      </div>
      <div v-else class="documents-empty">
        <p>This document is gone or never existed.</p>
        <router-link to="/documents">Back to all documents</router-link>
      </div>
    </template>

    <Transition name="document-ai-slide">
      <aside
        v-if="aiPanelOpen && route.params.id"
        id="document-ai-panel"
        class="document-ai-panel"
        aria-label="Document AI"
      >
        <header class="document-ai-panel-header">
          <h2>Document AI</h2>
          <button
            ref="aiCloseButton"
            type="button"
            aria-label="Close document AI"
            @click="closeAiPanel"
          >
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </header>
        <div class="document-ai-context">
          <span class="material-symbols-outlined" aria-hidden="true">description</span>
          <span>{{ store.openDoc?.title || 'Untitled' }}</span>
        </div>
        <div class="document-ai-conversation" role="log" aria-label="AI conversation">
          <div class="document-ai-welcome">
            <span class="material-symbols-outlined" aria-hidden="true">auto_awesome</span>
            <h3>A space for your ideas</h3>
            <p>Questions, drafts, and AI responses will appear here.</p>
          </div>
        </div>
        <div class="document-ai-composer">
          <div class="document-ai-input-wrap">
            <textarea
              v-model="aiDraft"
              aria-label="Message document AI"
              aria-describedby="document-ai-availability"
              placeholder="Ask about this document…"
              rows="3"
            ></textarea>
            <div class="document-ai-composer-actions">
              <span>Document context</span>
              <button
                type="button"
                aria-label="Send message"
                disabled
                title="AI chat is not connected yet"
              >
                <span class="material-symbols-outlined" aria-hidden="true">arrow_upward</span>
              </button>
            </div>
          </div>
          <p id="document-ai-availability">
            AI chat is not connected yet. You can draft a message here.
          </p>
        </div>
      </aside>
    </Transition>

    <!-- Dashboard -->
    <template v-if="!route.params.id">
      <header class="documents-header">
        <div>
          <h1>{{ activeTag ? `#${activeTag}` : 'Documents' }}</h1>
          <p class="documents-subtitle">
            {{
              activeTag
                ? `Documents tagged #${activeTag}`
                : 'Notes and docs, organised in folders. Autosaved as you type.'
            }}
          </p>
        </div>
        <div class="documents-header-actions">
          <router-link v-if="activeTag" to="/documents" class="clear-tag-filter">
            Clear tag
          </router-link>
          <button
            class="filter-toggle"
            :class="{ active: starredOnly }"
            :aria-pressed="starredOnly"
            @click="starredOnly = !starredOnly"
          >
            <span class="material-symbols-outlined">star</span>
            <span>Starred</span>
          </button>
          <button class="new-doc-button" @click="newDocument">
            <span class="material-symbols-outlined">note_add</span>
            <span>New document</span>
          </button>
        </div>
      </header>

      <div v-if="store.isLoading && !store.isLoaded" class="documents-loading">
        <div class="spinner"></div>
      </div>

      <div v-else-if="!dashboardDocs.length" class="documents-empty">
        <p v-if="store.activeSearchQuery">No documents match “{{ store.activeSearchQuery }}”.</p>
        <p v-else-if="activeTag">No documents tagged #{{ activeTag }}.</p>
        <p v-else-if="starredOnly">
          No starred documents yet — star one from the list or the sidebar.
        </p>
        <p v-else>No documents yet. Create your first one to get started.</p>
      </div>

      <table v-else class="documents-table">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Folder</th>
            <th scope="col">Updated</th>
            <th scope="col"><span class="visually-hidden">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="doc in dashboardDocs"
            :key="doc.id"
            class="documents-table-row"
            @click="router.push(`/documents/${doc.id}`)"
          >
            <td class="doc-name-cell">
              <span aria-hidden="true">{{ doc.emoji }}</span>
              <span>{{ doc.title || 'Untitled' }}</span>
            </td>
            <td class="doc-folder-cell">{{ folderTitles(doc) }}</td>
            <td class="doc-updated-cell">{{ formatUpdated(doc.updated_at) }}</td>
            <td class="doc-actions-cell" @click.stop>
              <button
                class="table-action-btn"
                :class="{ 'is-starred': doc.starred }"
                :title="doc.starred ? 'Unstar document' : 'Star document'"
                :aria-label="`${doc.starred ? 'Unstar' : 'Star'} ${doc.title || 'Untitled'}`"
                @click="store.toggleStar(doc.id)"
              >
                <span class="material-symbols-outlined">star</span>
              </button>
              <button
                class="table-action-btn"
                :title="`Delete ${doc.title || 'Untitled'}`"
                :aria-label="`Delete ${doc.title || 'Untitled'}`"
                @click="deleteFromDashboard(doc)"
              >
                <span class="material-symbols-outlined">delete</span>
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </template>
    <NewDocumentDialog v-if="store.newDocumentDialogOpen" />
  </div>
</template>

<style scoped>
.documents-view {
  height: 100%;
  overflow-y: auto;
  background: var(--bg-card);
}

.editor-with-sidebar {
  display: flex;
  align-items: stretch;
}

.editor-column {
  flex: 1;
  min-width: 0;
}

.editor-statusbar {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  padding: 10px 24px;
  position: sticky;
  top: 0;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border-color);
  z-index: 5;
}

.editor-save-navigation {
  display: flex;
  flex: 1;
  justify-content: flex-start;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.back-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-secondary);
  text-decoration: none;
  font-size: 13px;
}

.back-link:hover {
  color: var(--text-primary);
}

.back-link .material-symbols-outlined {
  font-size: 16px;
}

.save-actions {
  display: flex;
  gap: 8px;
  margin-left: auto;
}

.save-actions button {
  padding: 5px 10px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.save-actions button:disabled {
  opacity: 0.6;
  cursor: wait;
}

.save-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
}

.save-ai-icon {
  width: 20px;
  height: 20px;
  color: var(--gemini-purple);
}

.saved-status-text {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.save-status.save-error {
  color: #d15c4e;
}

.documents-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 28px 32px 16px;
}

.documents-header h1 {
  font-size: 22px;
  font-weight: 600;
  color: var(--text-primary);
}

.documents-subtitle {
  margin-top: 4px;
  font-size: 13px;
  color: var(--text-secondary);
}

.documents-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.filter-toggle,
.clear-tag-filter,
.new-doc-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font: inherit;
  font-size: 13px;
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid var(--border-color);
  background: var(--bg-card);
  color: var(--text-primary);
  transition: background var(--transition-fast);
  text-decoration: none;
}

.filter-toggle .material-symbols-outlined,
.new-doc-button .material-symbols-outlined {
  font-size: 16px;
}

.filter-toggle:hover,
.clear-tag-filter:hover {
  background: var(--bg-hover);
}

.filter-toggle.active {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}

.new-doc-button {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.new-doc-button:hover {
  background: var(--accent-hover);
}

.documents-loading {
  display: flex;
  justify-content: center;
  padding: 64px 0;
}

.documents-empty {
  padding: 48px 32px;
  color: var(--text-secondary);
  font-size: 14px;
  text-align: center;
}

.documents-table {
  width: calc(100% - 64px);
  margin: 8px 32px 48px;
  border-collapse: collapse;
  font-size: 13.5px;
}

.documents-table th {
  text-align: left;
  font-size: 11.5px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-secondary);
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-color);
}

.documents-table td {
  padding: 10px;
  border-bottom: 1px solid var(--border-color);
  color: var(--text-primary);
}

.documents-table-row {
  cursor: pointer;
}

.documents-table-row:hover td {
  background: var(--bg-hover);
}

.doc-name-cell {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 500;
}

.doc-folder-cell,
.doc-updated-cell {
  color: var(--text-secondary);
  white-space: nowrap;
}

.doc-actions-cell {
  width: 72px;
  text-align: right;
  white-space: nowrap;
}

.table-action-btn {
  border: none;
  background: none;
  padding: 2px;
  cursor: pointer;
  color: var(--text-secondary);
  border-radius: 4px;
}

.table-action-btn:hover {
  color: var(--text-primary);
}

.table-action-btn .material-symbols-outlined {
  font-size: 17px;
}

.table-action-btn.is-starred {
  color: #f5b301;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
.document-ai-toggle,
.document-ai-panel-header button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 6px;
  padding: 4px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}
.document-ai-toggle:hover,
.document-ai-toggle[aria-expanded='true'],
.document-ai-panel-header button:hover {
  background: var(--bg-hover);
}
.document-ai-panel {
  display: flex;
  flex-direction: column;
  position: fixed;
  top: 64px;
  right: 0;
  bottom: 0;
  width: min(380px, 100vw);
  box-sizing: border-box;
  z-index: 1000;
  background: var(--bg-card);
  color: var(--text-primary);
  border-left: 1px solid var(--border-color);
  box-shadow: -8px 0 24px rgb(0 0 0 / 8%);
  overflow: hidden;
}
.document-ai-panel-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color);
}
.document-ai-panel-header h2 {
  margin: 0;
  font-size: 18px;
}
.document-ai-context {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  margin: 12px 16px;
  padding: 8px 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  color: var(--text-secondary);
  font-size: 12px;
}
.document-ai-context > span:last-child {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.document-ai-context .material-symbols-outlined {
  font-size: 16px;
}
.document-ai-conversation {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 24px 20px;
}
.document-ai-welcome {
  margin-top: 24px;
  text-align: center;
}
.document-ai-welcome > span {
  color: var(--gemini-purple);
  font-size: 32px;
}
.document-ai-welcome h3 {
  margin: 12px 0 8px;
  font-size: 16px;
}
.document-ai-welcome p {
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.6;
}
.document-ai-composer {
  flex-shrink: 0;
  padding: 12px 16px 16px;
}
.document-ai-input-wrap {
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background: var(--bg-primary);
  padding: 12px;
}
.document-ai-input-wrap:focus-within {
  border-color: var(--gemini-purple);
}
.document-ai-input-wrap textarea {
  display: block;
  box-sizing: border-box;
  width: 100%;
  resize: none;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: 14px;
  line-height: 1.5;
}
.document-ai-composer-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
  font-size: 11px;
  color: var(--text-secondary);
}
.document-ai-composer-actions button {
  display: inline-flex;
  padding: 6px;
  border: 0;
  border-radius: 8px;
  background: var(--gemini-purple);
  color: white;
  opacity: 0.45;
  cursor: not-allowed;
}
.document-ai-composer > p {
  margin: 8px 0 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-secondary);
}
.document-ai-slide-enter-active,
.document-ai-slide-leave-active {
  transition: transform 200ms ease;
}
.document-ai-slide-enter-from,
.document-ai-slide-leave-to {
  transform: translateX(100%);
}
@media (prefers-reduced-motion: reduce) {
  .document-ai-slide-enter-active,
  .document-ai-slide-leave-active {
    transition: none;
  }
}
</style>
