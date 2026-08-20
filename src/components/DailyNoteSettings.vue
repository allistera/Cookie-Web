<script setup>
import { computed, onMounted, ref } from 'vue'

import DocumentEditor from './DocumentEditor.vue'
import { DEFAULT_DAILY_NOTE_SEED_BLOCKS, useDocumentsStore } from '../stores/documents'

const store = useDocumentsStore()

const draft = ref(null)
const isSaving = ref(false)
const editorComponent = ref(null)
// DocumentEditor only reloads its Editor.js instance when doc.id changes
// (see its own watch(() => props.doc.id, ...)); resetDraft() after
// resetToDefault() needs to force that reload even though the id is
// otherwise constant here, so it's suffixed with this counter and used as
// the element :key too, as a second guarantee of a fresh mount.
const editorGeneration = ref(0)

onMounted(async () => {
  await store.loadDailyNoteSeed()
  resetDraft()
})

// The editor always shows what a new daily note actually looks like today,
// whether that's the built-in default or a prior customization.
function resetDraft() {
  const blocks = store.dailyNoteSeed.length ? store.dailyNoteSeed : DEFAULT_DAILY_NOTE_SEED_BLOCKS
  editorGeneration.value += 1
  // `title` only exists because DocumentEditor's compact mode still renders a
  // title field — it is never sent to the backend, only draft.blocks is.
  // JSON round-trip (not structuredClone) matches DocumentEditor.vue's own
  // block-cloning approach: Editor.js block data isn't always
  // structuredClone-safe.
  draft.value = {
    id: `daily-note-seed-${editorGeneration.value}`,
    title: 'Today',
    blocks: JSON.parse(JSON.stringify(blocks)),
  }
}

function updateDraft(patch) {
  if (draft.value && patch.blocks !== undefined) draft.value.blocks = patch.blocks
}

const isCustomized = computed(() => store.dailyNoteSeed.length > 0)

async function save() {
  if (isSaving.value || !draft.value) return
  isSaving.value = true
  try {
    if (editorComponent.value) updateDraft(await editorComponent.value.snapshot())
    if (await store.saveDailyNoteSeed(draft.value.blocks ?? [])) {
      store.notify('Daily note default saved.')
    }
  } finally {
    isSaving.value = false
  }
}

async function resetToDefault() {
  if (isSaving.value) return
  isSaving.value = true
  try {
    if (await store.saveDailyNoteSeed([])) {
      resetDraft()
      store.notify('Daily note default reset.')
    }
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <div class="daily-note-settings">
    <div class="daily-note-settings-heading">
      <div>
        <h3 class="settings-section-title">Daily note default</h3>
        <p class="settings-section-hint">
          New daily notes (the Documents sidebar's "Today" shortcut) start from this content.
        </p>
      </div>
      <button
        v-if="isCustomized"
        type="button"
        class="btn btn-secondary"
        :disabled="isSaving"
        @click="resetToDefault"
      >
        Reset to default
      </button>
    </div>

    <div v-if="draft" class="daily-note-editor-surface">
      <DocumentEditor
        :key="editorGeneration"
        ref="editorComponent"
        :doc="draft"
        compact
        @save="updateDraft"
      />
    </div>

    <div class="daily-note-settings-actions">
      <button type="button" class="btn btn-primary" :disabled="isSaving" @click="save">
        {{ isSaving ? 'Saving…' : 'Save' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.daily-note-settings {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.daily-note-settings-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
}

.daily-note-settings-heading .settings-section-title {
  margin-bottom: 4px;
}

.daily-note-settings-heading .settings-section-hint {
  margin: 0;
}

.daily-note-editor-surface {
  min-height: 290px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--bg-input);
}

.daily-note-settings-actions {
  display: flex;
  justify-content: flex-end;
}

@media (max-width: 760px) {
  .daily-note-settings-heading {
    flex-direction: column;
  }
}
</style>
