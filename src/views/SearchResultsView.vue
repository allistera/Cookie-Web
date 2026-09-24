<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { useSearchStore, DEFAULT_SEARCH_LIMIT } from '../stores/search'
import { useInboxStore, mapEmailRow } from '../stores/inbox'
import { useSavedViewsStore } from '../stores/savedViews'
import {
  SAVED_VIEW_FOLDERS,
  savedViewDraftFromQuery,
  savedViewMatchesRoute,
  savedViewNextPageQuery,
  savedViewPageState,
  savedViewPreviousPageQuery,
  savedViewRoute,
} from '../lib/savedViews'
import EmailRow from '../components/EmailRow.vue'

const route = useRoute()
const router = useRouter()
const store = useSearchStore()
const inboxStore = useInboxStore()
const savedViews = useSavedViewsStore()
const saveDialog = ref(null)
const viewName = ref('')
const viewQuery = ref('')
const viewFolder = ref('all')

watch(
  () => savedViews.ownerSub,
  () => {
    if (saveDialog.value?.open) saveDialog.value.close()
    viewName.value = ''
    viewQuery.value = ''
    viewFolder.value = 'all'
  },
)

const SCOPES = [
  { key: 'all', label: 'All' },
  { key: 'mail', label: 'Mail' },
  { key: 'documents', label: 'Docs' },
  { key: 'tasks', label: 'Tasks' },
]

const currentQuery = computed(() => {
  const value = Array.isArray(route.query.q) ? route.query.q[0] : route.query.q
  return String(value ?? '').trim()
})
const currentScope = computed(() =>
  SCOPES.some((s) => s.key === route.query.scope) ? route.query.scope : 'all',
)
const currentMode = computed(() => (route.query.mode === 'keyword' ? 'keyword' : undefined))
const activeSavedView = computed(() =>
  savedViews.views.find((view) => savedViewMatchesRoute(view, route)),
)
const verifiedPagination = computed(() => Boolean(activeSavedView.value))
const savedPage = computed(() => savedViewPageState(route.query))
const currentPage = computed(() => {
  if (verifiedPagination.value) return savedPage.value.trail.length
  const page = Number(route.query.page)
  return Number.isInteger(page) && page > 0 ? page : 0
})
const currentOffset = computed(() =>
  verifiedPagination.value ? savedPage.value.offset : currentPage.value * DEFAULT_SEARCH_LIMIT,
)
const canGoPrevious = computed(() =>
  verifiedPagination.value ? savedPage.value.trail.length > 0 : currentPage.value > 0,
)
const activeFolder = computed(() =>
  SAVED_VIEW_FOLDERS.find((option) => option.value === activeSavedView.value?.folder),
)

// The route is the source of truth (shareable, back-button friendly): any
// change to q/scope/mode/page re-fetches. clear() on unmount cancels
// whatever is in flight so a slow response can't land after the view is gone.
watch(
  [
    currentQuery,
    currentScope,
    currentMode,
    currentOffset,
    verifiedPagination,
    () => savedViews.ownerSub,
  ],
  () => {
    if (!currentQuery.value || !savedViews.ownerSub) {
      store.clear()
      return
    }
    store.search(currentQuery.value, {
      scope: currentScope.value,
      mode: currentMode.value,
      limit: DEFAULT_SEARCH_LIMIT,
      offset: currentOffset.value,
      verifiedPagination: verifiedPagination.value,
    })
  },
  { immediate: true },
)

onBeforeUnmount(() => store.clear())

function switchScope(scope) {
  if (scope === currentScope.value) return
  router.replace({
    name: 'search',
    query: {
      ...route.query,
      scope,
      page: undefined,
      view: undefined,
      cursor: undefined,
      trail: undefined,
    },
  })
}

function goToPage(page) {
  if (page < 0 || page === currentPage.value || (page > currentPage.value && !store.hasMore)) return
  router.replace({ name: 'search', query: { ...route.query, page: page || undefined } })
}

function goToNextPage() {
  if (!verifiedPagination.value) return goToPage(currentPage.value + 1)
  const query = savedViewNextPageQuery(route.query, store.nextOffset)
  if (query) router.push({ name: 'search', query })
}

function goToPreviousPage() {
  if (!verifiedPagination.value) return goToPage(currentPage.value - 1)
  const query = savedViewPreviousPageQuery(route.query)
  if (query) router.push({ name: 'search', query })
}

function openSaveDialog() {
  const draft = savedViewDraftFromQuery(currentQuery.value)
  viewName.value = ''
  viewQuery.value = draft.query
  viewFolder.value = draft.folder
  savedViews.error = ''
  savedViews.conflict = false
  if (!savedViews.loaded) savedViews.load()
  saveDialog.value?.showModal()
}

async function saveView() {
  const view = {
    id: crypto.randomUUID(),
    name: viewName.value.trim(),
    query: viewQuery.value.trim(),
    folder: viewFolder.value,
  }
  const saved = await savedViews.save([...savedViews.views, view])
  if (!saved) return
  saveDialog.value?.close()
  router.push(savedViewRoute(view))
}

function askAssistant() {
  if (!currentQuery.value) return
  inboxStore.askAssistant(currentQuery.value)
}

// Mail rows arrive in the same raw shape mapEmailRow already normalizes for
// the inbox list, so EmailRow (the inbox's own row component) renders them
// unchanged.
function toEmailRow(row) {
  return mapEmailRow(row)
}

function rowSender(email) {
  return email.isSent ? `To: ${email.to ?? email.address}` : email.sender
}

// There is no per-email route (the reader is keyed off traditionalEmails +
// openEmailId in the inbox store), so opening a mail result reuses that same
// store-selection mechanism and then navigates to the inbox to show it.
function openEmailResult(row) {
  inboxStore.openEmailFromSearch(row)
  router.push('/inbox')
}

function openDocumentResult(row) {
  router.push(`/documents/${row.id}`)
}

// The detail panel resolves a task out of the loaded list, so the route must
// carry the task's own project (null means the Inbox) alongside the task id.
function openTaskResult(row) {
  router.push({ path: '/tasks', query: { project: row.projectId ?? 'inbox', task: row.id } })
}

function formatDue(dueDate) {
  return new Date(`${dueDate}T00:00:00`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  })
}

function formatUpdated(epochMs) {
  return new Date(epochMs).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const errorMessage = computed(() => {
  if (store.error === 'unavailable') return 'Search is temporarily unavailable.'
  if (store.error === 'invalid') return 'Enter a longer search term.'
  if (store.error === 'failed') return 'Search failed. Please try again.'
  return ''
})
</script>

<template>
  <div class="search-results-view">
    <header class="search-results-header">
      <div class="search-results-title-row">
        <h1>{{ activeSavedView?.name || 'Search results' }}</h1>
        <button
          v-if="currentQuery && currentScope === 'mail' && !activeSavedView"
          type="button"
          class="search-save-view"
          @click="openSaveDialog"
        >
          Save as view
        </button>
      </div>
      <p v-if="activeSavedView" class="search-results-subtitle">
        Saved mail view · {{ activeFolder?.label }} · Keyword search
      </p>
      <p v-if="currentQuery" class="search-results-subtitle">
        Showing results for <strong>&ldquo;{{ currentQuery }}&rdquo;</strong>
      </p>
      <p v-if="activeSavedView" class="search-results-subtitle">
        Views can overlap. Saving or deleting a view does not move messages.
      </p>
      <p v-if="!store.loading && !store.error && currentQuery" class="search-results-subtitle">
        About {{ store.estimatedTotalHits }} matching
        {{ currentScope === 'mail' ? 'emails' : 'items' }}
        (search estimate).
      </p>
    </header>

    <div class="search-results-tabs" role="tablist">
      <button
        v-for="scope in SCOPES"
        :key="scope.key"
        type="button"
        role="tab"
        class="search-results-tab"
        :class="{ active: currentScope === scope.key }"
        :aria-selected="currentScope === scope.key"
        @click="switchScope(scope.key)"
      >
        {{ scope.label }}
      </button>
      <button type="button" class="search-results-ask" @click="askAssistant">
        <span class="material-symbols-outlined text-purple" aria-hidden="true">chat_bubble</span>
        <span>Ask the assistant about: &ldquo;{{ currentQuery }}&rdquo;</span>
      </button>
    </div>

    <div v-if="store.loading" class="search-results-loading">
      <div class="spinner"></div>
    </div>

    <div v-else-if="errorMessage" class="search-results-empty">
      <p>{{ errorMessage }}</p>
    </div>

    <div v-else-if="!currentQuery" class="search-results-empty">
      <p>Type a search above to get started.</p>
    </div>

    <div v-else-if="!store.results.length" class="search-results-empty">
      <p v-if="store.scanLimitReached">No live messages found within the verified scan limit.</p>
      <p v-else>No results for &ldquo;{{ currentQuery }}&rdquo;.</p>
    </div>

    <ul v-else class="search-results-list">
      <li v-for="row in store.results" :key="`${row.type}-${row.id}`" class="search-results-item">
        <EmailRow
          v-if="row.type === 'email'"
          :email="toEmailRow(row)"
          :sender="rowSender(toEmailRow(row))"
          :has-ai-summary="toEmailRow(row).hasAiSummary"
          :show-done="false"
          @open="openEmailResult(row)"
        />
        <button
          v-else-if="row.type === 'task'"
          type="button"
          class="search-result-task"
          @click="openTaskResult(row)"
        >
          <span class="material-symbols-outlined search-result-task-icon" aria-hidden="true">
            task_alt
          </span>
          <span class="search-result-task-body">
            <span class="search-result-task-title">{{ row.content }}</span>
            <span v-if="row.description || row.dueDate" class="search-result-task-meta">
              <span v-if="row.dueDate" class="search-result-task-due">
                Due {{ formatDue(row.dueDate) }}
              </span>
              <span v-if="row.description" class="search-result-task-description">
                {{ row.description }}
              </span>
            </span>
          </span>
        </button>
        <button v-else type="button" class="search-result-doc" @click="openDocumentResult(row)">
          <span class="material-symbols-outlined search-result-doc-icon" aria-hidden="true">
            description
          </span>
          <span class="search-result-doc-body">
            <span class="search-result-doc-title">
              {{ row.title || 'Untitled' }}
              <span
                v-if="row.starred"
                class="material-symbols-outlined search-result-doc-star"
                aria-hidden="true"
                >star</span
              >
            </span>
            <span class="search-result-doc-meta">
              <span v-for="tag in row.tags" :key="tag" class="search-result-doc-tag">
                #{{ tag }}
              </span>
              <span class="search-result-doc-date"
                >Updated {{ formatUpdated(row.updated_at) }}</span
              >
            </span>
          </span>
        </button>
      </li>
    </ul>

    <div
      v-if="(store.results.length || canGoPrevious) && (canGoPrevious || store.hasMore)"
      class="search-results-pagination"
    >
      <button type="button" :disabled="!canGoPrevious" @click="goToPreviousPage">Previous</button>
      <span>Page {{ currentPage + 1 }}</span>
      <button type="button" :disabled="!store.hasMore" @click="goToNextPage">Next</button>
    </div>

    <p v-if="store.scanLimitReached" class="search-results-scan-warning" role="alert">
      Search scan limit reached after 1,000 indexed hits. Later mail may exist; this is not a
      confirmed end of results.
    </p>

    <dialog
      ref="saveDialog"
      class="search-save-dialog"
      aria-label="Save mail view"
      @click.stop
      @keydown.stop
    >
      <form method="dialog" @submit.prevent="saveView">
        <h2>Save mail view</h2>
        <p>Saved views use keyword search. Choose the folder explicitly.</p>
        <label>
          Name
          <input v-model="viewName" type="text" maxlength="60" required autofocus />
        </label>
        <label>
          Search query
          <input v-model="viewQuery" type="text" maxlength="470" required />
        </label>
        <label>
          Folder
          <select v-model="viewFolder">
            <option v-for="folder in SAVED_VIEW_FOLDERS" :key="folder.value" :value="folder.value">
              {{ folder.label }}
            </option>
          </select>
        </label>
        <p class="search-save-hint">
          Supported: from:, sender:, to:, tag:, has:attachment, before:YYYY-MM-DD, after:YYYY-MM-DD,
          and words. Use each filter once. AND/OR and is:starred are unsupported.
        </p>
        <p v-if="savedViews.error" class="search-save-error" role="alert">{{ savedViews.error }}</p>
        <button
          v-if="!savedViews.loaded && !savedViews.loading"
          type="button"
          @click="savedViews.load()"
        >
          Retry loading views
        </button>
        <div class="search-save-actions">
          <button type="button" @click="saveDialog?.close()">Cancel</button>
          <button type="submit" :disabled="savedViews.saving || !savedViews.loaded">
            {{ savedViews.conflict ? 'Review latest and save my view' : 'Save view' }}
          </button>
        </div>
      </form>
    </dialog>
  </div>
</template>

<style scoped>
.search-results-view {
  height: 100%;
  overflow-y: auto;
  background: var(--bg-card);
  padding: 24px;
}

.search-results-header h1 {
  margin: 0 0 4px;
  font-size: 20px;
}

.search-results-title-row,
.search-save-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.search-save-view {
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--text-primary);
  padding: 7px 11px;
  cursor: pointer;
}

.search-save-dialog {
  width: min(460px, calc(100vw - 32px));
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 20px;
  background: var(--bg-card);
  color: var(--text-primary);
}

.search-save-dialog::backdrop {
  background: rgb(0 0 0 / 55%);
}

.search-save-dialog h2 {
  margin: 0;
}

.search-save-dialog label {
  display: block;
  margin-top: 14px;
}

.search-save-dialog input,
.search-save-dialog select {
  display: block;
  box-sizing: border-box;
  width: 100%;
  margin-top: 5px;
  padding: 8px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--text-primary);
  font: inherit;
}

.search-save-hint,
.search-save-dialog > p {
  color: var(--text-secondary);
  font-size: 13px;
}

.search-save-error {
  color: var(--text-red, #c53636);
}

.search-results-subtitle {
  margin: 0;
  color: var(--text-secondary);
  font-size: 14px;
}

.search-results-tabs {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 20px 0;
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 12px;
}

.search-results-tab {
  border: 1px solid var(--border-color);
  background: var(--bg-input);
  color: var(--text-secondary);
  border-radius: 999px;
  padding: 6px 14px;
  font-size: 13px;
  cursor: pointer;
}

.search-results-tab.active {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}

.search-results-ask {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-input);
  border-radius: 999px;
  padding: 6px 14px;
  font-size: 13px;
  color: var(--text-primary);
  cursor: pointer;
}

.search-results-ask:hover {
  background-color: var(--bg-hover);
}

.search-results-loading,
.search-results-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 60px 0;
  color: var(--text-secondary);
}

.search-results-list {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  overflow: hidden;
}

.search-results-item + .search-results-item {
  border-top: 1px solid var(--border-color);
}

.search-result-doc {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  padding: 12px 16px;
  background: none;
  border: none;
  text-align: left;
  cursor: pointer;
  color: var(--text-primary);
  font: inherit;
}

.search-result-doc:hover {
  background-color: var(--bg-hover);
}

.search-result-doc-icon {
  color: var(--text-blue);
}

.search-result-doc-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.search-result-doc-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 500;
}

.search-result-doc-star {
  font-size: 16px;
  color: var(--text-yellow, #e5a900);
}

.search-result-doc-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: var(--text-secondary);
}

.search-result-doc-tag {
  color: var(--accent);
}

/* Task rows share the document row's anatomy — icon, title, one-line meta. */
.search-result-task {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  padding: 12px 16px;
  background: none;
  border: none;
  text-align: left;
  cursor: pointer;
  color: var(--text-primary);
  font: inherit;
}

.search-result-task:hover {
  background-color: var(--bg-hover);
}

.search-result-task-icon {
  color: var(--accent);
}

.search-result-task-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.search-result-task-title {
  font-size: 14px;
  font-weight: 500;
}

.search-result-task-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: var(--text-secondary);
  min-width: 0;
}

.search-result-task-due {
  color: var(--accent);
  flex-shrink: 0;
}

/* Descriptions can run long (and multiline); the row shows one line. */
.search-result-task-description {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.search-results-pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  margin-top: 20px;
  font-size: 13px;
  color: var(--text-secondary);
}

.search-results-pagination button {
  border: 1px solid var(--border-color);
  background: var(--bg-input);
  border-radius: 6px;
  padding: 6px 12px;
  cursor: pointer;
  color: var(--text-primary);
}

.search-results-pagination button:disabled {
  opacity: 0.5;
  cursor: default;
}

.search-results-scan-warning {
  margin-top: 16px;
  color: var(--text-yellow, #e5a900);
  font-size: 13px;
}
</style>
