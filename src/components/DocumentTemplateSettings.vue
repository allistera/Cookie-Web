<script setup>
import { onMounted, ref } from 'vue'

import DocumentEditor from './DocumentEditor.vue'
import { useDocumentsStore } from '../stores/documents'

const store = useDocumentsStore()

const draft = ref(null)
const isOpening = ref(false)
const isSaving = ref(false)
const error = ref('')
const confirmingDeleteId = ref(null)
const editorComponent = ref(null)

onMounted(() => store.loadTemplates())

function newTemplate() {
  confirmingDeleteId.value = null
  error.value = ''
  draft.value = { id: 'new-template', title: '', blocks: [] }
}

async function editTemplate(template) {
  confirmingDeleteId.value = null
  error.value = ''
  isOpening.value = true
  const fullTemplate = await store.loadTemplate(template.id)
  if (fullTemplate) draft.value = structuredClone(fullTemplate)
  isOpening.value = false
}

function closeEditor() {
  draft.value = null
  error.value = ''
}

function updateDraft(patch) {
  if (draft.value) Object.assign(draft.value, patch)
}

async function saveTemplate() {
  if (isSaving.value) return
  isSaving.value = true
  try {
    if (editorComponent.value) updateDraft(await editorComponent.value.snapshot())
    const title = draft.value?.title?.trim()
    if (!title) {
      error.value = 'Give this template a name before saving.'
      return
    }

    error.value = ''
    const payload = { title, blocks: draft.value.blocks ?? [] }
    const saved =
      draft.value.id === 'new-template'
        ? await store.createTemplate(payload)
        : await store.updateTemplate(draft.value.id, payload)
    if (saved) {
      closeEditor()
      store.notify('Document template saved.')
    }
  } finally {
    isSaving.value = false
  }
}

async function deleteTemplate(template) {
  if (confirmingDeleteId.value !== template.id) {
    confirmingDeleteId.value = template.id
    return
  }
  if (await store.deleteTemplate(template.id)) {
    confirmingDeleteId.value = null
    store.notify('Document template deleted.')
  }
}

function formatUpdated(value) {
  if (!value) return ''
  return new Date(value).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}
</script>

<template>
  <div class="document-template-settings">
    <template v-if="draft">
      <div class="document-template-editor-header">
        <div>
          <h3 class="settings-section-title">
            {{ draft.id === 'new-template' ? 'New template' : 'Edit template' }}
          </h3>
          <p class="settings-section-hint">
            This title and content will be copied into each new document.
          </p>
        </div>
        <div class="document-template-editor-actions">
          <button type="button" class="btn btn-secondary" @click="closeEditor">Cancel</button>
          <button type="button" class="btn btn-primary" :disabled="isSaving" @click="saveTemplate">
            {{ isSaving ? 'Saving…' : 'Save template' }}
          </button>
        </div>
      </div>

      <p v-if="error" class="document-template-error" role="alert">{{ error }}</p>
      <div class="document-template-editor-surface">
        <DocumentEditor ref="editorComponent" :doc="draft" compact @save="updateDraft" />
      </div>
    </template>

    <template v-else>
      <div class="document-template-heading">
        <div>
          <h3 class="settings-section-title">Document templates</h3>
          <p class="settings-section-hint">
            Create reusable starting points. Documents made from a template are independent copies.
          </p>
        </div>
        <button type="button" class="btn btn-secondary" @click="newTemplate">
          <span class="material-symbols-outlined" aria-hidden="true">add</span>
          New template
        </button>
      </div>

      <p v-if="store.templatesLoading || isOpening" class="document-template-empty">
        Loading templates…
      </p>
      <p v-else-if="store.templates.length === 0" class="document-template-empty">
        No templates yet. Create one to speed up repeat documents.
      </p>
      <div v-else class="document-template-list">
        <div v-for="template in store.templates" :key="template.id" class="document-template-row">
          <span class="document-template-icon" aria-hidden="true">{{
            template.emoji || '📄'
          }}</span>
          <div class="document-template-copy">
            <strong>{{ template.title }}</strong>
            <small v-if="template.updated_at"
              >Updated {{ formatUpdated(template.updated_at) }}</small
            >
          </div>
          <button
            type="button"
            class="ni-action-btn"
            :aria-label="`Edit ${template.title}`"
            @click="editTemplate(template)"
          >
            <span class="material-symbols-outlined" aria-hidden="true">edit</span>
          </button>
          <button
            type="button"
            class="ni-action-btn document-template-delete"
            :class="{ confirming: confirmingDeleteId === template.id }"
            :aria-label="
              confirmingDeleteId === template.id
                ? `Confirm delete ${template.title}`
                : `Delete ${template.title}`
            "
            @click="deleteTemplate(template)"
          >
            <span class="material-symbols-outlined" aria-hidden="true">delete</span>
          </button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.document-template-settings {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.document-template-heading,
.document-template-editor-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
}

.document-template-heading .settings-section-title,
.document-template-editor-header .settings-section-title {
  margin-bottom: 4px;
}

.document-template-heading .settings-section-hint,
.document-template-editor-header .settings-section-hint {
  margin: 0;
}

.document-template-heading .btn {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  gap: 5px;
}

.document-template-heading .material-symbols-outlined {
  font-size: 18px;
}

.document-template-list {
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--border-color);
}

.document-template-row {
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr) repeat(2, 32px);
  align-items: center;
  gap: 10px;
  min-height: 62px;
  padding: 10px 2px;
  border-bottom: 1px solid var(--border-color);
}

.document-template-icon {
  font-size: 19px;
  text-align: center;
}

.document-template-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.document-template-copy strong {
  overflow: hidden;
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.document-template-copy small,
.document-template-empty {
  color: var(--text-secondary);
  font-size: 12px;
}

.document-template-empty {
  margin: 0;
  padding: 28px 4px;
  border-block: 1px solid var(--border-color);
  text-align: center;
}

.document-template-delete.confirming,
.document-template-delete:hover {
  background: color-mix(in srgb, var(--danger, #e5484d) 12%, transparent);
  color: var(--danger, #e5484d);
}

.document-template-editor-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 8px;
}

.document-template-error {
  margin: 0;
  color: var(--danger, #e5484d);
  font-size: 12px;
}

.document-template-editor-surface {
  min-height: 290px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--bg-input);
}

@media (max-width: 760px) {
  .document-template-heading,
  .document-template-editor-header {
    flex-direction: column;
  }
}
</style>
