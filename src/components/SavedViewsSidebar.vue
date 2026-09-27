<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { savedViewMatchesRoute, savedViewRoute, SAVED_VIEW_FOLDERS } from '../lib/savedViews'
import { useInboxStore } from '../stores/inbox'
import { useSavedViewsStore } from '../stores/savedViews'

const store = useSavedViewsStore()
const inbox = useInboxStore()
// The view whose "⋯" menu is open, if any.
const menuViewId = ref(null)
const route = useRoute()
const router = useRouter()
const dialog = ref(null)
const draft = ref([])

watch(
  () => store.ownerSub,
  () => {
    if (dialog.value?.open) dialog.value.close()
    draft.value = []
  },
)

function openManager() {
  draft.value = store.views.map((view) => ({ ...view }))
  store.error = ''
  store.conflict = false
  dialog.value?.showModal()
}

function closeManager() {
  if (dialog.value?.open) dialog.value.close()
}

function move(index, delta) {
  const target = index + delta
  if (target < 0 || target >= draft.value.length) return
  const [item] = draft.value.splice(index, 1)
  draft.value.splice(target, 0, item)
}

async function saveChanges() {
  const next = draft.value.map((view) => ({ ...view, name: view.name.trim() }))
  const saved = await store.save(next)
  if (!saved) return
  if (route.query.view && !next.some((view) => view.id === route.query.view)) {
    await router.replace({ name: 'search', query: { ...route.query, view: undefined } })
  }
  closeManager()
}

function resetDraft() {
  draft.value = store.views.map((view) => ({ ...view }))
  store.error = ''
  store.conflict = false
}

function toggleMenu(id) {
  menuViewId.value = menuViewId.value === id ? null : id
}

function closeMenu() {
  menuViewId.value = null
}

function onDocumentPointer(event) {
  if (!event.target?.closest?.('.saved-view-row')) closeMenu()
}
document.addEventListener('pointerdown', onDocumentPointer)
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocumentPointer))

function editView(view) {
  closeMenu()
  store.openEditor({ view })
}

// Deleting removes only the definition, never mail, so it happens at once
// with an Undo that puts the view back where it was.
async function deleteView(view) {
  closeMenu()
  const removed = await store.deleteView(view.id)
  if (!removed) {
    inbox.notify(store.error || 'Could not delete the view. Please try again.', 'error')
    return
  }
  if (route.query.view === view.id) {
    await router.replace({ name: 'search', query: { ...route.query, view: undefined } })
  }
  inbox.notify(`Deleted saved view "${view.name}".`, 'info', {
    label: 'Undo',
    run: async () => {
      const restored = await store.restoreView(removed.view, removed.index)
      if (!restored) inbox.notify(store.error || 'Could not restore the view.', 'error')
    },
  })
}

function folderLabel(folder) {
  return SAVED_VIEW_FOLDERS.find((option) => option.value === folder)?.label ?? folder
}
</script>

<template>
  <!-- Only shown once there is a saved view: an empty, loading or
       unavailable list adds nothing to the sidebar. The first view is created
       from Search ("Save as view") or the "New saved view" command. -->
  <section v-if="store.views.length" class="saved-views-section" aria-label="Saved mail views">
    <div class="sb-section-label saved-views-heading">
      <span>Saved views</span>
      <span class="saved-views-heading-actions">
        <button
          type="button"
          class="saved-views-new"
          aria-label="New saved view"
          title="New saved view"
          @click.stop="store.openEditor()"
        >
          <span class="material-symbols-outlined" aria-hidden="true">add</span>
        </button>
        <button type="button" @click.stop="openManager">Manage</button>
      </span>
    </div>
    <nav class="sidebar-nav" aria-label="Saved mail views">
      <div
        v-for="view in store.views"
        :key="view.id"
        class="saved-view-row"
        @keydown.escape="closeMenu"
      >
        <router-link
          :to="savedViewRoute(view)"
          class="nav-item"
          :class="{ active: savedViewMatchesRoute(view, route) }"
        >
          <span class="material-symbols-outlined" aria-hidden="true">filter_alt</span>
          <span class="nav-text">{{ view.name }}</span>
        </router-link>
        <button
          type="button"
          class="saved-view-menu-btn"
          :aria-label="`Actions for ${view.name}`"
          aria-haspopup="menu"
          :aria-expanded="menuViewId === view.id"
          @click.stop="toggleMenu(view.id)"
        >
          <span class="material-symbols-outlined" aria-hidden="true">more_horiz</span>
        </button>
        <div v-if="menuViewId === view.id" class="saved-view-menu" role="menu">
          <button type="button" role="menuitem" @click="editView(view)">Edit</button>
          <button type="button" role="menuitem" :disabled="store.saving" @click="deleteView(view)">
            Delete
          </button>
        </div>
      </div>
    </nav>

    <dialog
      ref="dialog"
      class="saved-views-dialog"
      aria-label="Manage saved views"
      @click.stop
      @keydown.stop
    >
      <form method="dialog" @submit.prevent="saveChanges">
        <header>
          <h2>Manage saved views</h2>
          <button type="button" aria-label="Close" @click="closeManager">×</button>
        </header>
        <p>Rename or reorder views. Edit or delete one from its ⋯ menu in the sidebar.</p>
        <ol class="saved-views-editor">
          <li v-for="(view, index) in draft" :key="view.id">
            <label>
              <span>View name</span>
              <input v-model="view.name" type="text" maxlength="60" required />
            </label>
            <small>{{ folderLabel(view.folder) }} · {{ view.query }}</small>
            <div class="saved-views-controls">
              <button type="button" :disabled="index === 0" @click="move(index, -1)">Up</button>
              <button type="button" :disabled="index === draft.length - 1" @click="move(index, 1)">
                Down
              </button>
            </div>
          </li>
        </ol>
        <p v-if="store.error" class="saved-views-error" role="alert">{{ store.error }}</p>
        <div class="saved-views-actions">
          <button v-if="store.conflict" type="button" @click="resetDraft">Use latest views</button>
          <button type="button" @click="closeManager">Cancel</button>
          <button type="submit" :disabled="store.saving">
            {{ store.conflict ? 'Overwrite latest with my draft' : 'Save changes' }}
          </button>
        </div>
      </form>
    </dialog>
  </section>
</template>

<style scoped>
.saved-views-heading-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.saved-views-new {
  display: inline-flex;
  align-items: center;
  padding: 0;
}

.saved-views-new .material-symbols-outlined {
  font-size: 16px;
}

.saved-view-row {
  position: relative;
}

.saved-view-row .nav-item {
  padding-right: 28px;
}

.saved-view-menu-btn {
  position: absolute;
  top: 50%;
  right: 4px;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: none;
  color: var(--text-secondary);
  cursor: pointer;
  opacity: 0;
}

.saved-view-menu-btn .material-symbols-outlined {
  font-size: 16px;
}

.saved-view-row:hover .saved-view-menu-btn,
.saved-view-menu-btn:focus-visible,
.saved-view-menu-btn[aria-expanded='true'] {
  opacity: 1;
}

.saved-view-menu {
  position: absolute;
  top: 100%;
  right: 4px;
  z-index: var(--z-popover);
  display: flex;
  flex-direction: column;
  min-width: 120px;
  padding: 4px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-card);
  box-shadow: 0 6px 20px rgb(0 0 0 / 12%);
}

.saved-view-menu button {
  padding: 6px 10px;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--text-primary);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.saved-view-menu button:hover,
.saved-view-menu button:focus-visible {
  background: var(--bg-hover);
}

.saved-views-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.saved-views-heading button {
  border: 0;
  background: none;
  color: var(--accent);
  cursor: pointer;
  font: inherit;
}

.saved-views-dialog {
  width: min(520px, calc(100vw - 32px));
  max-height: min(680px, calc(100vh - 32px));
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 20px;
  background: var(--bg-card);
  color: var(--text-primary);
}

.saved-views-dialog::backdrop {
  background: rgb(0 0 0 / 55%);
}

.saved-views-dialog header,
.saved-views-controls,
.saved-views-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.saved-views-dialog header,
.saved-views-actions {
  justify-content: space-between;
}

.saved-views-dialog h2 {
  margin: 0;
  font-size: 18px;
}

.saved-views-dialog p,
.saved-views-dialog small {
  color: var(--text-secondary);
}

.saved-views-editor {
  overflow-y: auto;
  max-height: 410px;
  padding-left: 22px;
}

.saved-views-editor li {
  padding: 10px 0;
  border-bottom: 1px solid var(--border-color);
}

.saved-views-editor label,
.saved-views-editor small {
  display: block;
}

.saved-views-editor label span {
  display: block;
  font-size: 12px;
}

.saved-views-editor input {
  width: 100%;
  box-sizing: border-box;
  margin: 4px 0;
  padding: 7px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--text-primary);
}

.saved-views-controls {
  margin-top: 8px;
}

.saved-views-dialog button {
  cursor: pointer;
}

.saved-views-dialog button:disabled {
  cursor: default;
  opacity: 0.5;
}

.saved-views-error {
  color: var(--text-red, #c53636) !important;
}

.saved-views-actions {
  margin-top: 16px;
}
</style>
