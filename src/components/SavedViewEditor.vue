<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { SEARCH_API_URL } from '../lib/apiWorkers'
import { authHeaders } from '../lib/authHeaders'
import { SAVED_VIEW_FOLDERS, savedViewRoute } from '../lib/savedViews'
import { useSavedViewsStore } from '../stores/savedViews'

// The one create/edit form for saved mail views. Opened from Search ("Save
// as view", "Edit view"), the sidebar ("+", a view's Edit) and the command
// palette ("New saved view") through store.openEditor. The Worker is the
// only validator; its messages show here unchanged.
const PREVIEW_LIMIT = 5

const store = useSavedViewsStore()
const route = useRoute()
const router = useRouter()
const dialog = ref(null)
const nameInput = ref(null)
const preview = ref(null)
let previewSeq = 0

const editor = computed(() => store.editor)
const isEdit = computed(() => editor.value?.mode === 'edit')

watch(
  () => Boolean(store.editor),
  async (open) => {
    preview.value = null
    previewSeq++
    if (!open) {
      if (dialog.value?.open) dialog.value.close()
      return
    }
    await nextTick()
    if (!dialog.value?.open) dialog.value?.showModal()
    nameInput.value?.focus()
  },
  { immediate: true },
)

// The query and folder feed the preview, so an edit makes it stale.
watch(
  () => [editor.value?.query, editor.value?.folder],
  () => {
    preview.value = null
    previewSeq++
  },
)

function close() {
  store.closeEditor()
}

async function runPreview() {
  const fields = editor.value
  if (!fields?.query.trim()) return
  const seq = ++previewSeq
  preview.value = { loading: true, rows: [], error: '' }
  try {
    const params = new URLSearchParams({
      q: `${fields.query.trim()} in:${fields.folder}`,
      scope: 'mail',
      mode: 'keyword',
      limit: String(PREVIEW_LIMIT),
      offset: '0',
    })
    const response = await fetch(`${SEARCH_API_URL}/search?${params}`, {
      headers: await authHeaders(),
    })
    if (seq !== previewSeq) return
    if (!response.ok) throw new Error(`GET search responded ${response.status}`)
    const data = await response.json()
    if (seq !== previewSeq) return
    preview.value = {
      loading: false,
      error: '',
      rows: (data.results ?? []).filter((row) => row.type === 'email').slice(0, PREVIEW_LIMIT),
      total: data.estimatedTotalHits ?? 0,
    }
  } catch (error) {
    if (seq !== previewSeq) return
    console.error('Saved view preview failed:', error)
    preview.value = { loading: false, rows: [], error: 'Could not preview this search.' }
  }
}

async function save({ asNew = false } = {}) {
  const fields = editor.value
  if (!fields) return
  const { name, query, folder } = fields
  const editing = isEdit.value && !asNew
  const wasOpen = editing && route.query.view === fields.id
  const view = editing
    ? await store.updateView(fields.id, { name, query, folder }, fields.base)
    : await store.createView({ name, query, folder })
  if (!view) return
  store.closeEditor()
  // A new view opens straight away; an edited one only refreshes if it is
  // the view on screen, so its results match the new definition.
  if (!editing) router.push(savedViewRoute(view))
  else if (wasOpen) router.replace(savedViewRoute(view))
}
</script>

<template>
  <dialog
    ref="dialog"
    class="saved-view-editor"
    :aria-label="isEdit ? 'Edit saved view' : 'Save mail view'"
    @cancel.prevent="close"
    @click.stop
    @keydown.stop
  >
    <form v-if="editor" method="dialog" @submit.prevent="save()">
      <h2>{{ isEdit ? 'Edit saved view' : 'Save mail view' }}</h2>
      <p>Saved views use keyword search. Choose the folder explicitly.</p>
      <label>
        Name
        <input ref="nameInput" v-model="editor.name" type="text" maxlength="60" required />
      </label>
      <label>
        Search query
        <input v-model="editor.query" type="text" maxlength="470" required />
      </label>
      <label>
        Folder
        <select v-model="editor.folder">
          <option v-for="folder in SAVED_VIEW_FOLDERS" :key="folder.value" :value="folder.value">
            {{ folder.label }}
          </option>
        </select>
      </label>
      <p class="saved-view-editor-hint">
        Supported: from:, sender:, to:, tag:, has:attachment, before:YYYY-MM-DD, after:YYYY-MM-DD,
        and words. Use each filter once. AND/OR and is:starred are unsupported.
      </p>

      <div class="saved-view-preview">
        <button
          type="button"
          :disabled="!editor.query.trim() || preview?.loading"
          @click="runPreview"
        >
          Preview
        </button>
        <p v-if="preview?.loading" class="saved-view-preview-status">Searching…</p>
        <p v-else-if="preview?.error" class="saved-view-preview-status" role="alert">
          {{ preview.error }}
        </p>
        <template v-else-if="preview">
          <p class="saved-view-preview-status" role="status">
            {{
              preview.rows.length
                ? `About ${preview.total} matching emails. First ${preview.rows.length}:`
                : 'No matching emails.'
            }}
          </p>
          <ul v-if="preview.rows.length" class="saved-view-preview-list">
            <li v-for="row in preview.rows" :key="row.id">
              {{ row.subject || '(no subject)' }}
            </li>
          </ul>
        </template>
      </div>

      <p v-if="store.error" class="saved-view-editor-error" role="alert">{{ store.error }}</p>
      <button v-if="!store.loaded && !store.loading" type="button" @click="store.load()">
        Retry loading views
      </button>
      <div class="saved-view-editor-actions">
        <button type="button" @click="close">Cancel</button>
        <button
          v-if="isEdit"
          type="button"
          :disabled="store.saving || !store.loaded"
          @click="save({ asNew: true })"
        >
          Save as new view
        </button>
        <button type="submit" :disabled="store.saving || !store.loaded">
          {{ isEdit ? 'Save changes' : 'Save view' }}
        </button>
      </div>
    </form>
  </dialog>
</template>

<style scoped>
.saved-view-editor {
  width: min(480px, calc(100vw - 32px));
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 20px;
  background: var(--bg-card);
  color: var(--text-primary);
}

.saved-view-editor::backdrop {
  background: rgb(0 0 0 / 55%);
}

.saved-view-editor h2 {
  margin: 0;
}

.saved-view-editor label {
  display: block;
  margin-top: 14px;
}

.saved-view-editor input,
.saved-view-editor select {
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

.saved-view-editor-hint,
.saved-view-editor form > p,
.saved-view-preview-status {
  color: var(--text-secondary);
  font-size: 13px;
}

.saved-view-preview {
  margin-top: 8px;
}

.saved-view-preview-list {
  margin: 4px 0 0;
  padding-left: 18px;
  font-size: 13px;
}

.saved-view-preview-list li {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.saved-view-editor-error {
  color: var(--text-red, #c53636);
}

.saved-view-editor-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
</style>
