<script setup>
import { computed, defineAsyncComponent, onBeforeUnmount, ref, watch } from 'vue'
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

async function flushEditor() {
  await editorComponent.value?.flushPendingBlocks?.()
  await store.flushPendingSave()
}

onBeforeRouteLeave(flushEditor)
onBeforeRouteUpdate(flushEditor)

// /documents shows the dashboard; /documents/:id opens that document.
watch(
  () => route.params.id,
  (id) => {
    if (route.name !== 'documents') return
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
  if (store.saveState === 'error') return 'Save failed — edits kept locally'
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
        <router-link to="/documents" class="back-link">
          <span class="material-symbols-outlined">arrow_back</span>
          <span>All documents</span>
        </router-link>
        <span class="save-status" :class="`save-${store.saveState}`" role="status">
          {{ saveStatusText }}
        </span>
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

    <!-- Dashboard -->
    <template v-else>
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
  align-items: center;
  justify-content: space-between;
  padding: 10px 24px;
  position: sticky;
  top: 0;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border-color);
  z-index: 5;
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

.save-status {
  font-size: 12px;
  color: var(--text-secondary);
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
</style>
