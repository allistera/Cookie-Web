<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useDocumentsStore } from '../stores/documents'
import { confirmDocumentDelete } from '../lib/documentDeleteConfirmation'
import {
  fileIcon,
  fileKind,
  folderBreadcrumb,
  folderContents,
  formatBytes,
  isPreviewable,
} from '../lib/documentFiles'
import { getStoredLayout, saveLayout } from '../lib/documentsLayout'

// One folder at a time: its subfolders, documents and uploaded files as
// cards or rows. Documents come from the store's existing per-folder page;
// files from the store's file pages. Starred, tag and search views are not
// this component's job — they keep the flat table in DocumentsView.
const props = defineProps({ folderId: { type: String, default: null } })
const store = useDocumentsStore()
const router = useRouter()

const layout = ref(getStoredLayout())
function setLayout(value) {
  layout.value = value
  saveLayout(value)
}

const pageScope = computed(() => ({ folder: props.folderId ?? 'root' }))
const documents = computed(() =>
  store.workspacePaged
    ? store.documentsForPage(pageScope.value)
    : store.documents.filter((doc) => (doc.folder_id ?? null) === (props.folderId ?? null)),
)
const files = computed(() => store.filesForFolder(props.folderId))
const items = computed(() =>
  folderContents(store.folders, documents.value, files.value, props.folderId),
)
const uploads = computed(() =>
  store.uploads.filter((upload) => (upload.folder_id ?? null) === (props.folderId ?? null)),
)
const crumbs = computed(() => folderBreadcrumb(store.folders, props.folderId))
const filePage = computed(() => store.filePages[props.folderId ?? 'root'])
const loading = computed(
  () => (store.pageFor(pageScope.value)?.loading ?? false) || (filePage.value?.loading ?? false),
)

function load(force = false) {
  void store.loadDocumentPage(pageScope.value, { force })
  void store.loadFiles(props.folderId, { force })
}
watch(
  () => props.folderId,
  () => load(),
  { immediate: true },
)

function folderRoute(id) {
  return id ? { path: '/documents', query: { folder: id } } : { path: '/documents' }
}

async function download(file) {
  try {
    const blob = await store.fetchFileBlob(file.id)
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = file.name
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (error) {
    store.notify(error.message || 'Download failed.', 'error')
  }
}

function open(entry) {
  menuFor.value = null
  if (entry.kind === 'folder') return router.push(folderRoute(entry.id))
  if (entry.kind === 'document') return router.push(`/documents/${entry.id}`)
  if (isPreviewable(entry.item.mime_type)) return router.push(`/documents/file/${entry.id}`)
  return download(entry.item)
}

// Selection and keyboard: single click selects, Enter or double click opens.
const selectedId = ref(null)
function onItemKeydown(entry, event) {
  if (event.key === 'Enter' && renamingId.value !== entry.id) {
    event.preventDefault()
    void open(entry)
  }
}

// Kebab menu: one open at a time, closed by outside click or Escape.
const menuFor = ref(null)
const moveTargetsFor = ref(null)
function toggleMenu(entry) {
  moveTargetsFor.value = null
  menuFor.value = menuFor.value === entry.id ? null : entry.id
}
function onDocumentClick(event) {
  if (!event.composedPath().some((node) => node.classList?.contains('browser-menu-wrap'))) {
    menuFor.value = null
    moveTargetsFor.value = null
  }
}
function onKeydown(event) {
  if (event.key === 'Escape') {
    menuFor.value = null
    moveTargetsFor.value = null
  }
}
onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  document.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onKeydown)
})

// Rename: inline input on the item, like the sidebar's folder rename.
const renamingId = ref(null)
const renameValue = ref('')
const renameInput = ref(null)
async function startRename(entry) {
  menuFor.value = null
  renamingId.value = entry.id
  renameValue.value = entry.name
  await nextTick()
  const element = Array.isArray(renameInput.value) ? renameInput.value[0] : renameInput.value
  element?.select?.()
}
function submitRename(entry) {
  if (renamingId.value !== entry.id) return
  renamingId.value = null
  const name = renameValue.value.trim()
  if (!name || name === entry.name) return
  if (entry.kind === 'folder') return store.renameFolder(entry.id, name)
  if (entry.kind === 'document') return store.updateDocumentMeta(entry.id, { title: name })
  return store.renameFile(entry.id, name)
}

async function remove(entry) {
  menuFor.value = null
  if (entry.kind === 'folder') {
    if (!window.confirm(`Delete folder "${entry.name}" and its subfolders?`)) return
    return store.deleteFolder(entry.id)
  }
  if (entry.kind === 'document') {
    if (!confirmDocumentDelete(entry.item)) return
    return store.deleteDocument(entry.id)
  }
  if (!window.confirm(`Delete file "${entry.name}"?\n\nThis action cannot be undone.`)) return
  return store.deleteFile(entry.id)
}

// Move to: every folder with its path, plus the root.
const folderPaths = computed(() =>
  store.folders
    .map((folder) => ({
      id: folder.id,
      path: folderBreadcrumb(store.folders, folder.id)
        .slice(1)
        .map((crumb) => crumb.title)
        .join(' / '),
    }))
    .sort((a, b) => a.path.localeCompare(b.path)),
)
function moveTo(entry, folderId) {
  moveTargetsFor.value = null
  menuFor.value = null
  if (entry.kind === 'document') return store.moveDocument(entry.id, folderId)
  return store.moveFile(entry.id, folderId)
}
function toggleStar(entry) {
  menuFor.value = null
  return store.toggleStar(entry.id)
}
function downloadFromMenu(entry) {
  menuFor.value = null
  return download(entry.item)
}

// Drag and drop: items carry "<kind>:<id>" so the sidebar tree can accept
// them too; folder cards accept both document and file drops. External file
// drops anywhere on the pane upload into the current folder.
const dropTargetId = ref(undefined)
const dragOverPane = ref(false)
function onDragStart(entry, event) {
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', `${entry.kind}:${entry.id}`)
}
function hasFiles(event) {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files')
}
function onFolderDragOver(entry, event) {
  if (entry.kind !== 'folder' || hasFiles(event)) return
  event.preventDefault()
  event.stopPropagation()
  event.dataTransfer.dropEffect = 'move'
  dropTargetId.value = entry.id
}
function onFolderDrop(entry, event) {
  if (entry.kind !== 'folder' || hasFiles(event)) return
  event.preventDefault()
  event.stopPropagation()
  dropTargetId.value = undefined
  const [kind, id] = String(event.dataTransfer.getData('text/plain')).split(':')
  if (kind === 'document') void store.moveDocument(id, entry.id)
  else if (kind === 'file') void store.moveFile(id, entry.id)
}
function onPaneDragOver(event) {
  if (!hasFiles(event)) return
  event.preventDefault()
  dragOverPane.value = true
}
function onPaneDragLeave(event) {
  if (!event.currentTarget.contains(event.relatedTarget)) dragOverPane.value = false
}
function onPaneDrop(event) {
  dragOverPane.value = false
  dropTargetId.value = undefined
  const dropped = Array.from(event.dataTransfer?.files ?? [])
  if (!dropped.length) return
  event.preventDefault()
  void store.uploadFiles(dropped, props.folderId)
}
const fileInput = ref(null)
function onFilesChosen(event) {
  const chosen = Array.from(event.target.files ?? [])
  event.target.value = ''
  if (chosen.length) void store.uploadFiles(chosen, props.folderId)
}

function kindLabel(entry) {
  if (entry.kind === 'folder') return 'Folder'
  if (entry.kind === 'document') return 'Document'
  return fileKind(entry.item.mime_type)
}
function detail(entry) {
  if (entry.kind === 'file') return formatBytes(entry.item.size_bytes)
  if (entry.kind === 'document' && entry.item.updated_at) {
    return new Date(entry.item.updated_at).toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
  }
  return ''
}
</script>

<template>
  <section
    class="documents-browser"
    :class="[`layout-${layout}`, { 'drop-active': dragOverPane }]"
    aria-label="Folder contents"
    @dragover="onPaneDragOver"
    @dragleave="onPaneDragLeave"
    @drop="onPaneDrop"
  >
    <header class="browser-toolbar">
      <nav class="browser-breadcrumb" aria-label="Folder path">
        <button type="button" class="browser-refresh" aria-label="Refresh" @click="load(true)">
          <span class="material-symbols-outlined" aria-hidden="true">refresh</span>
        </button>
        <template v-for="(crumb, index) in crumbs" :key="crumb.id ?? 'root'">
          <span v-if="index" class="crumb-separator" aria-hidden="true">›</span>
          <router-link v-if="index < crumbs.length - 1" :to="folderRoute(crumb.id)">
            {{ crumb.title }}
          </router-link>
          <span v-else aria-current="location">{{ crumb.title }}</span>
        </template>
      </nav>
      <div class="browser-actions">
        <button
          type="button"
          class="browser-upload"
          aria-label="Upload files"
          @click="fileInput.click()"
        >
          <span class="material-symbols-outlined" aria-hidden="true">upload_file</span>
          <span>Upload</span>
        </button>
        <input ref="fileInput" type="file" multiple hidden @change="onFilesChosen" />
        <div class="layout-toggle" role="group" aria-label="Layout">
          <button
            type="button"
            :class="{ active: layout === 'list' }"
            :aria-pressed="layout === 'list'"
            aria-label="List view"
            @click="setLayout('list')"
          >
            <span class="material-symbols-outlined" aria-hidden="true">view_list</span>
          </button>
          <button
            type="button"
            :class="{ active: layout === 'grid' }"
            :aria-pressed="layout === 'grid'"
            aria-label="Grid view"
            @click="setLayout('grid')"
          >
            <span class="material-symbols-outlined" aria-hidden="true">grid_view</span>
          </button>
        </div>
      </div>
    </header>

    <p v-if="filePage?.error" class="browser-error" role="alert">
      {{ filePage.error }}
      <button type="button" @click="load(true)">Retry</button>
    </p>

    <div v-if="loading && !items.length && !uploads.length" class="documents-loading">
      <div class="spinner"></div>
    </div>
    <p v-else-if="!items.length && !uploads.length" class="browser-empty">
      This folder is empty. Create a document or drop files here.
    </p>

    <ul v-else class="browser-items" :aria-busy="loading">
      <li
        v-for="upload in uploads"
        :key="upload.id"
        class="browser-item upload-item"
        data-kind="upload"
        :class="`upload-${upload.status}`"
      >
        <span class="item-icon material-symbols-outlined" aria-hidden="true">upload_file</span>
        <span class="item-name">{{ upload.name }}</span>
        <span v-if="upload.status === 'uploading'" class="item-kind" role="status">Uploading…</span>
        <template v-else>
          <span class="item-kind item-error" role="alert">{{ upload.error }}</span>
          <button
            type="button"
            class="item-dismiss"
            aria-label="Dismiss"
            @click="store.dismissUpload(upload.id)"
          >
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </template>
      </li>

      <li
        v-for="entry in items"
        :key="`${entry.kind}:${entry.id}`"
        class="browser-item"
        :class="{ selected: selectedId === entry.id, 'drop-target': dropTargetId === entry.id }"
        :data-kind="entry.kind"
        :data-id="entry.id"
        tabindex="0"
        :draggable="entry.kind !== 'folder'"
        @click="selectedId = entry.id"
        @dblclick="open(entry)"
        @keydown="onItemKeydown(entry, $event)"
        @dragstart="onDragStart(entry, $event)"
        @dragover="onFolderDragOver(entry, $event)"
        @dragleave="dropTargetId = undefined"
        @drop="onFolderDrop(entry, $event)"
      >
        <span
          v-if="entry.kind === 'folder'"
          class="item-icon item-folder material-symbols-outlined"
          aria-hidden="true"
          >folder</span
        >
        <span v-else-if="entry.kind === 'document'" class="item-icon item-emoji" aria-hidden="true">
          {{ entry.item.emoji }}
        </span>
        <span v-else class="item-icon material-symbols-outlined" aria-hidden="true">
          {{ fileIcon(entry.item.mime_type) }}
        </span>

        <input
          v-if="renamingId === entry.id"
          ref="renameInput"
          v-model="renameValue"
          class="item-rename"
          :aria-label="`Rename ${entry.name}`"
          @click.stop
          @dblclick.stop
          @keydown.enter.prevent="submitRename(entry)"
          @keydown.escape="renamingId = null"
          @blur="submitRename(entry)"
        />
        <span v-else class="item-name">{{ entry.name }}</span>
        <span class="item-kind">{{ kindLabel(entry) }}</span>
        <span class="item-detail">{{ detail(entry) }}</span>

        <span class="browser-menu-wrap" @click.stop @dblclick.stop>
          <button
            type="button"
            class="item-menu-btn"
            :aria-label="`Actions for ${entry.name}`"
            :aria-expanded="menuFor === entry.id"
            @click="toggleMenu(entry)"
          >
            <span class="material-symbols-outlined" aria-hidden="true">more_vert</span>
          </button>
          <div v-if="menuFor === entry.id" class="browser-menu" role="menu">
            <button type="button" role="menuitem" data-action="open" @click="open(entry)">
              Open
            </button>
            <button type="button" role="menuitem" data-action="rename" @click="startRename(entry)">
              Rename
            </button>
            <button
              v-if="entry.kind !== 'folder'"
              type="button"
              role="menuitem"
              data-action="move"
              @click="moveTargetsFor = moveTargetsFor === entry.id ? null : entry.id"
            >
              Move to…
            </button>
            <div v-if="moveTargetsFor === entry.id" class="browser-move-targets">
              <button
                type="button"
                role="menuitem"
                :disabled="(entry.item.folder_id ?? null) === null"
                @click="moveTo(entry, null)"
              >
                Documents (root)
              </button>
              <button
                v-for="target in folderPaths"
                :key="target.id"
                type="button"
                role="menuitem"
                :disabled="target.id === (entry.item.folder_id ?? null)"
                @click="moveTo(entry, target.id)"
              >
                {{ target.path }}
              </button>
            </div>
            <button
              v-if="entry.kind === 'document'"
              type="button"
              role="menuitem"
              data-action="star"
              @click="toggleStar(entry)"
            >
              {{ entry.item.starred ? 'Unstar' : 'Star' }}
            </button>
            <button
              v-if="entry.kind === 'file'"
              type="button"
              role="menuitem"
              data-action="download"
              @click="downloadFromMenu(entry)"
            >
              Download
            </button>
            <button
              type="button"
              role="menuitem"
              data-action="delete"
              class="danger"
              @click="remove(entry)"
            >
              Delete
            </button>
          </div>
        </span>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.documents-browser {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 60vh;
  border-radius: 12px;
}
.documents-browser.drop-active {
  outline: 2px dashed var(--accent);
  outline-offset: -2px;
  background: var(--accent-soft);
}
.browser-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 12px;
}
.browser-breadcrumb {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 16px;
  color: var(--text-primary);
}
.browser-breadcrumb a {
  color: var(--text-secondary);
  text-decoration: none;
}
.browser-breadcrumb a:hover {
  color: var(--text-primary);
  text-decoration: underline;
}
.crumb-separator {
  color: var(--text-secondary);
}
.browser-refresh,
.item-menu-btn,
.item-dismiss,
.layout-toggle button {
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
.browser-refresh:hover,
.item-menu-btn:hover,
.item-dismiss:hover,
.layout-toggle button:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.browser-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.browser-upload {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-card);
  color: var(--text-primary);
  cursor: pointer;
}
.browser-upload:hover {
  background: var(--bg-hover);
}
.layout-toggle {
  display: inline-flex;
  padding: 2px;
  border-radius: 8px;
  background: var(--bg-hover);
}
.layout-toggle button.active {
  background: var(--accent);
  color: #fff;
}
.browser-error,
.browser-empty {
  margin: 0;
  padding: 24px;
  color: var(--text-secondary);
  text-align: center;
}
.browser-error button {
  margin-left: 8px;
}
.browser-items {
  list-style: none;
  margin: 0;
  padding: 0;
}
.layout-grid .browser-items {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 16px;
}
.browser-item {
  position: relative;
  display: grid;
  gap: 4px;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  cursor: default;
  outline: none;
  transition: box-shadow var(--transition-fast, 0.15s);
}
.browser-item:hover,
.browser-item:focus-visible {
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08);
}
.browser-item.selected {
  border-color: var(--accent);
}
.browser-item.drop-target {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.layout-grid .browser-item {
  grid-template-columns: 1fr auto;
  grid-template-areas:
    'icon icon'
    'kind menu'
    'name menu'
    'detail detail';
  padding: 18px 14px 12px;
  min-height: 190px;
}
.layout-grid .item-icon {
  grid-area: icon;
  justify-self: center;
  font-size: 88px;
  line-height: 1;
  margin-bottom: 14px;
}
.layout-grid .item-emoji {
  font-size: 64px;
}
.item-folder {
  color: #4a7de0;
  font-variation-settings: 'FILL' 1;
}
.layout-grid .item-kind {
  grid-area: kind;
  font-size: 12px;
  color: var(--text-secondary);
}
.layout-grid .item-name,
.layout-grid .item-rename {
  grid-area: name;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.layout-grid .item-detail {
  grid-area: detail;
  font-size: 12px;
  color: var(--text-secondary);
}
.layout-grid .browser-menu-wrap {
  grid-area: menu;
  align-self: center;
}
.layout-list .browser-item {
  grid-template-columns: 32px minmax(0, 1fr) 120px 140px 40px;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-radius: 8px;
  margin-bottom: 6px;
}
.layout-list .item-icon {
  font-size: 24px;
  text-align: center;
}
.layout-list .item-name,
.layout-list .item-rename {
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.layout-list .item-kind,
.layout-list .item-detail {
  font-size: 13px;
  color: var(--text-secondary);
}
.item-rename {
  font: inherit;
  padding: 2px 6px;
  border: 1px solid var(--accent);
  border-radius: 6px;
  background: var(--bg-primary);
  color: var(--text-primary);
}
.item-error {
  color: #c0392b;
}
.upload-item {
  opacity: 0.85;
}
.browser-menu-wrap {
  position: relative;
}
.browser-menu {
  position: absolute;
  right: 0;
  top: 100%;
  z-index: var(--z-header, 20);
  min-width: 160px;
  padding: 6px;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
}
.browser-menu button {
  display: block;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
}
.browser-menu button:hover:not(:disabled) {
  background: var(--bg-hover);
}
.browser-menu button:disabled {
  opacity: 0.5;
}
.browser-menu button.danger {
  color: #c0392b;
}
.browser-move-targets {
  max-height: 220px;
  overflow: auto;
  margin: 4px 0;
  padding-left: 8px;
  border-left: 2px solid var(--border-color);
}
@media (max-width: 640px) {
  .layout-grid .browser-items {
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  }
  .layout-list .browser-item {
    grid-template-columns: 28px minmax(0, 1fr) 40px;
  }
  .layout-list .item-kind,
  .layout-list .item-detail {
    display: none;
  }
}
</style>
