<script setup>
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { useDocumentsStore } from '../stores/documents'
import { flattenDocumentsTree } from '../lib/documentsTree'

const store = useDocumentsStore()
const route = useRoute()
const router = useRouter()

// Which folders are open. Roots start expanded on first load so the tree is
// visible without a click-per-folder tour.
const expandedIds = ref(new Set())
let expandedSeeded = false

onMounted(async () => {
  await store.loadWorkspace()
  if (!expandedSeeded) {
    expandedSeeded = true
    expandedIds.value = new Set(store.folders.map((folder) => folder.id))
  }
})

const treeRows = computed(() =>
  flattenDocumentsTree(store.folders, store.documents, expandedIds.value),
)

function toggleFolder(id) {
  const next = new Set(expandedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedIds.value = next
}

function newDocument(folderId = null) {
  store.openNewDocumentDialog(folderId)
}

async function deleteDocument(doc) {
  const wasOpen = route.params.id === doc.id
  if (await store.deleteDocument(doc.id)) {
    if (wasOpen) router.push('/documents')
  }
}

// Inline "New folder" row: openNewFolderFor is null when hidden, '' for a
// root folder, or a folder id for a subfolder of it.
const openNewFolderFor = ref(null)
const newFolderTitle = ref('')
const newFolderInput = ref(null)

async function showNewFolder(parentId) {
  openNewFolderFor.value = parentId ?? ''
  newFolderTitle.value = ''
  await nextTick()
  newFolderInput.value?.focus()
}

async function submitNewFolder() {
  // Enter submits and unmounts the input, which fires blur; the second call
  // must be a no-op or every Enter would create the folder twice.
  if (openNewFolderFor.value === null) return
  const title = newFolderTitle.value.trim()
  const parentId = openNewFolderFor.value === '' ? null : openNewFolderFor.value
  openNewFolderFor.value = null
  if (!title) return
  const folder = await store.createFolder({ title, parentId })
  if (folder) {
    const next = new Set(expandedIds.value)
    next.add(folder.id)
    if (parentId) next.add(parentId)
    expandedIds.value = next
  }
}

// Inline folder rename on double-click.
const renamingFolderId = ref(null)
const renameTitle = ref('')
const renameInput = ref(null)

async function startRename(folder) {
  renamingFolderId.value = folder.id
  renameTitle.value = folder.title
  await nextTick()
  renameInput.value?.[0]?.focus?.()
  renameInput.value?.[0]?.select?.()
}

async function submitRename(folder) {
  // Same Enter-then-blur double-fire as submitNewFolder.
  if (renamingFolderId.value !== folder.id) return
  const title = renameTitle.value.trim()
  renamingFolderId.value = null
  if (title && title !== folder.title) await store.renameFolder(folder.id, title)
}

// Drag a document row onto a folder row (or the section label for the root)
// to move it, mirroring paper's move-to-section.
const dragDocId = ref(null)
const dropFolderId = ref(undefined)

function onDragStart(doc, event) {
  dragDocId.value = doc.id
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', doc.id)
}

function onDragOver(folderId, event) {
  if (!dragDocId.value) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'move'
  dropFolderId.value = folderId
}

function onDrop(folderId) {
  if (dragDocId.value) store.moveDocument(dragDocId.value, folderId)
  dragDocId.value = null
  dropFolderId.value = undefined
}

function onDragEnd() {
  dragDocId.value = null
  dropFolderId.value = undefined
}
</script>

<template>
  <aside class="left-sidebar documents-sidebar" aria-label="Documents sidebar">
    <button class="compose-btn" @click="newDocument()">
      <span class="material-symbols-outlined" aria-hidden="true">note_add</span>
      <span>New doc</span>
    </button>

    <template v-if="store.starredDocuments.length">
      <div class="sb-section-label">Starred</div>
      <nav class="sidebar-nav" aria-label="Starred documents">
        <router-link
          v-for="doc in store.starredDocuments"
          :key="`starred-${doc.id}`"
          :to="`/documents/${doc.id}`"
          class="nav-item doc-item"
          :class="{ active: route.params.id === doc.id }"
        >
          <span class="doc-emoji" aria-hidden="true">{{ doc.emoji }}</span>
          <span class="nav-text">{{ doc.title || 'Untitled' }}</span>
        </router-link>
      </nav>
    </template>

    <div
      class="sb-section-label documents-root-label"
      :class="{ 'drop-target': dropFolderId === null }"
      @dragover="onDragOver(null, $event)"
      @dragleave="dropFolderId = undefined"
      @drop="onDrop(null)"
    >
      Documents
    </div>
    <nav class="sidebar-nav documents-tree" aria-label="Documents">
      <template v-for="row in treeRows" :key="`${row.kind}-${row.item.id}`">
        <div
          v-if="row.kind === 'folder'"
          class="nav-item folder-item"
          :class="{ 'drop-target': dropFolderId === row.item.id }"
          :style="{ paddingLeft: `${10 + row.depth * 14}px` }"
          role="button"
          tabindex="0"
          :aria-expanded="row.expanded"
          @click="toggleFolder(row.item.id)"
          @keydown.enter.prevent="toggleFolder(row.item.id)"
          @dblclick="startRename(row.item)"
          @dragover="onDragOver(row.item.id, $event)"
          @dragleave="dropFolderId = undefined"
          @drop="onDrop(row.item.id)"
        >
          <span class="material-symbols-outlined folder-arrow" aria-hidden="true">
            {{ row.expanded ? 'keyboard_arrow_down' : 'keyboard_arrow_right' }}
          </span>
          <span class="doc-emoji" aria-hidden="true">{{ row.item.emoji }}</span>
          <input
            v-if="renamingFolderId === row.item.id"
            ref="renameInput"
            v-model="renameTitle"
            class="folder-rename-input"
            :aria-label="`Rename ${row.item.title}`"
            @click.stop
            @keydown.enter.prevent="submitRename(row.item)"
            @keydown.escape="renamingFolderId = null"
            @blur="submitRename(row.item)"
          />
          <span v-else class="nav-text">{{ row.item.title }}</span>
          <span class="row-actions" @click.stop>
            <button
              class="row-action-btn"
              :title="`New document in ${row.item.title}`"
              :aria-label="`New document in ${row.item.title}`"
              @click="newDocument(row.item.id)"
            >
              <span class="material-symbols-outlined">note_add</span>
            </button>
            <button
              class="row-action-btn"
              :title="`New folder in ${row.item.title}`"
              :aria-label="`New folder in ${row.item.title}`"
              @click="showNewFolder(row.item.id)"
            >
              <span class="material-symbols-outlined">create_new_folder</span>
            </button>
            <button
              class="row-action-btn"
              :title="`Delete ${row.item.title}`"
              :aria-label="`Delete ${row.item.title}`"
              @click="store.deleteFolder(row.item.id)"
            >
              <span class="material-symbols-outlined">delete</span>
            </button>
          </span>
        </div>
        <router-link
          v-else
          :to="`/documents/${row.item.id}`"
          class="nav-item doc-item"
          :class="{ active: route.params.id === row.item.id, dragging: dragDocId === row.item.id }"
          :style="{ paddingLeft: `${10 + row.depth * 14}px` }"
          draggable="true"
          @dragstart="onDragStart(row.item, $event)"
          @dragend="onDragEnd"
        >
          <span class="doc-emoji" aria-hidden="true">{{ row.item.emoji }}</span>
          <span class="nav-text">{{ row.item.title || 'Untitled' }}</span>
          <span class="row-actions" @click.prevent.stop>
            <button
              class="row-action-btn"
              :class="{ 'is-starred': row.item.starred }"
              :title="row.item.starred ? 'Unstar document' : 'Star document'"
              :aria-label="`${row.item.starred ? 'Unstar' : 'Star'} ${row.item.title || 'Untitled'}`"
              @click="store.toggleStar(row.item.id)"
            >
              <span class="material-symbols-outlined">star</span>
            </button>
            <button
              class="row-action-btn"
              :title="`Delete ${row.item.title || 'Untitled'}`"
              :aria-label="`Delete ${row.item.title || 'Untitled'}`"
              @click="deleteDocument(row.item)"
            >
              <span class="material-symbols-outlined">delete</span>
            </button>
          </span>
        </router-link>
      </template>

      <form
        v-if="openNewFolderFor !== null"
        class="new-folder-row"
        @submit.prevent="submitNewFolder"
      >
        <span class="doc-emoji" aria-hidden="true">📁</span>
        <input
          ref="newFolderInput"
          v-model="newFolderTitle"
          class="folder-rename-input"
          placeholder="Folder name"
          aria-label="New folder name"
          @keydown.escape="openNewFolderFor = null"
          @blur="submitNewFolder"
        />
      </form>

      <button class="nav-item new-folder-btn" @click="showNewFolder(null)">
        <span class="material-symbols-outlined" aria-hidden="true">create_new_folder</span>
        <span class="nav-text">New folder</span>
      </button>
    </nav>
  </aside>
</template>

<style scoped>
.documents-sidebar .doc-emoji {
  width: 18px;
  text-align: center;
  font-size: 13px;
  flex-shrink: 0;
}

.folder-item {
  cursor: pointer;
  user-select: none;
}

/* Long titles truncate so the hover actions never overflow the sidebar
   (an overflowing button lands under the main panel and can't be clicked). */
.documents-sidebar .nav-item {
  min-width: 0;
}

.documents-sidebar .nav-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.folder-arrow {
  margin-left: -4px;
}

/* Hidden by opacity, not display, so the buttons keep their geometry and
   accessibility-tree entry (display:none rows made them unreachable to
   assistive tech and to WebKit's hit testing until a hover re-rendered). */
.nav-item .row-actions {
  display: inline-flex;
  margin-left: auto;
  gap: 2px;
  opacity: 0;
}

.nav-item:hover .row-actions,
.nav-item:focus-within .row-actions {
  opacity: 1;
}

.row-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* Fixed and clipped so the row's width never depends on the icon font:
     before it loads, the ligature text ("create_new_folder") would otherwise
     stretch the actions past the sidebar edge. */
  width: 20px;
  height: 20px;
  overflow: hidden;
  flex-shrink: 0;
  border: none;
  background: none;
  padding: 1px;
  cursor: pointer;
  color: inherit;
  opacity: 0.65;
  border-radius: 4px;
}

.row-action-btn:hover {
  opacity: 1;
}

.row-action-btn .material-symbols-outlined {
  font-size: 15px;
}

.row-action-btn.is-starred {
  opacity: 1;
  color: #f5b301;
}

.doc-item.dragging {
  opacity: 0.5;
}

.drop-target {
  outline: 1.5px dashed currentColor;
  outline-offset: -1.5px;
  border-radius: 6px;
}

.new-folder-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
}

.folder-rename-input {
  flex: 1;
  min-width: 0;
  font: inherit;
  color: inherit;
  background: transparent;
  border: 1px solid currentColor;
  border-radius: 4px;
  padding: 1px 4px;
}

.new-folder-btn {
  width: 100%;
  border: none;
  background: none;
  text-align: left;
  font: inherit;
  cursor: pointer;
  opacity: 0.75;
}

.new-folder-btn:hover {
  opacity: 1;
}
</style>
