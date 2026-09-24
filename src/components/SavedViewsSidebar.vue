<script setup>
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { savedViewMatchesRoute, savedViewRoute, SAVED_VIEW_FOLDERS } from '../lib/savedViews'
import { useSavedViewsStore } from '../stores/savedViews'

const store = useSavedViewsStore()
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

function remove(index) {
  draft.value.splice(index, 1)
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

function folderLabel(folder) {
  return SAVED_VIEW_FOLDERS.find((option) => option.value === folder)?.label ?? folder
}
</script>

<template>
  <section class="saved-views-section" aria-label="Saved mail views">
    <div class="sb-section-label saved-views-heading">
      <span>Saved views</span>
      <button v-if="store.views.length" type="button" @click.stop="openManager">Manage</button>
    </div>
    <div v-if="store.loading" class="saved-views-status">Loading views…</div>
    <div v-else-if="!store.loaded" class="saved-views-status">
      <span>{{ store.error || 'Saved views are unavailable.' }}</span>
      <button type="button" @click="store.load()">Retry</button>
    </div>
    <nav v-else-if="store.views.length" class="sidebar-nav" aria-label="Saved mail views">
      <router-link
        v-for="view in store.views"
        :key="view.id"
        :to="savedViewRoute(view)"
        class="nav-item"
        :class="{ active: savedViewMatchesRoute(view, route) }"
      >
        <span class="material-symbols-outlined">filter_alt</span>
        <span class="nav-text">{{ view.name }}</span>
      </router-link>
    </nav>
    <p v-else class="saved-views-status">Search mail, then save a view here.</p>

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
        <p>Rename, reorder, or delete definitions. Deleting never changes messages.</p>
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
              <button type="button" @click="remove(index)">Delete</button>
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
.saved-views-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.saved-views-heading button,
.saved-views-status button {
  border: 0;
  background: none;
  color: var(--accent);
  cursor: pointer;
  font: inherit;
}

.saved-views-status {
  margin: 8px 18px 14px;
  color: var(--text-secondary);
  font-size: 12px;
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
