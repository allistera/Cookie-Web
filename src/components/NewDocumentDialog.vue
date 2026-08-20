<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { useDocumentsStore } from '../stores/documents'

const store = useDocumentsStore()
const router = useRouter()
const isCreating = ref(false)

onMounted(() => {
  store.loadTemplates()
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))

function onKeydown(event) {
  if (event.key === 'Escape' && !isCreating.value) store.closeNewDocumentDialog()
}

async function createDocument(templateId = null) {
  if (isCreating.value) return
  isCreating.value = true
  const document = await store.createDocument({
    folderId: store.newDocumentFolderId,
    templateId,
  })
  isCreating.value = false
  if (!document) return
  store.closeNewDocumentDialog()
  router.push(`/documents/${document.id}`)
}
</script>

<template>
  <div class="new-document-overlay" @mousedown.self="store.closeNewDocumentDialog()">
    <section
      class="new-document-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-document-title"
    >
      <header class="new-document-dialog-header">
        <div>
          <h2 id="new-document-title">New document</h2>
          <p>Start blank or use a template.</p>
        </div>
        <button
          type="button"
          class="ni-action-btn"
          aria-label="Close new document dialog"
          :disabled="isCreating"
          @click="store.closeNewDocumentDialog()"
        >
          <span class="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      </header>

      <div class="new-document-options">
        <button
          type="button"
          class="new-document-option"
          :disabled="isCreating"
          @click="createDocument()"
        >
          <span class="new-document-option-icon material-symbols-outlined" aria-hidden="true"
            >description</span
          >
          <span>
            <strong>Blank document</strong>
            <small>Start with an empty page</small>
          </span>
        </button>

        <p v-if="store.templatesLoading" class="new-document-loading">Loading templates…</p>
        <template v-else-if="store.templates.length">
          <h3>Templates</h3>
          <button
            v-for="template in store.templates"
            :key="template.id"
            type="button"
            class="new-document-option"
            :disabled="isCreating"
            @click="createDocument(template.id)"
          >
            <span class="new-document-option-icon" aria-hidden="true">{{
              template.emoji || '📄'
            }}</span>
            <span>
              <strong>{{ template.title }}</strong>
              <small>Use this template</small>
            </span>
          </button>
        </template>
      </div>

      <router-link
        class="new-document-manage-link"
        :to="{ name: 'settings', params: { section: 'document-templates' } }"
        @click="store.closeNewDocumentDialog()"
      >
        Manage templates
      </router-link>
    </section>
  </div>
</template>

<style scoped>
.new-document-overlay {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(0, 0, 0, 0.36);
}

.new-document-dialog {
  width: min(100%, 480px);
  max-height: min(680px, calc(100vh - 40px));
  overflow-y: auto;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background: var(--bg-dialog);
  box-shadow: var(--shadow-lg);
}

.new-document-dialog-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 22px 16px;
  border-bottom: 1px solid var(--border-color);
}

.new-document-dialog-header h2 {
  margin: 0;
  color: var(--text-primary);
  font-size: 18px;
  font-weight: 650;
}

.new-document-dialog-header p {
  margin: 4px 0 0;
  color: var(--text-secondary);
  font-size: 13px;
}

.new-document-options {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px;
}

.new-document-options h3 {
  margin: 10px 8px 2px;
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.new-document-option {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 11px 12px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.new-document-option:hover,
.new-document-option:focus-visible {
  background: var(--bg-hover);
  outline: none;
}

.new-document-option:disabled {
  cursor: wait;
  opacity: 0.6;
}

.new-document-option-icon {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-card);
  font-size: 18px;
}

.new-document-option > span:last-child {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.new-document-option strong {
  overflow: hidden;
  font-size: 14px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.new-document-option small,
.new-document-loading {
  color: var(--text-secondary);
  font-size: 12px;
}

.new-document-loading {
  margin: 8px;
}

.new-document-manage-link {
  display: block;
  padding: 13px 22px 16px;
  border-top: 1px solid var(--border-color);
  color: var(--text-secondary);
  font-size: 12px;
  text-align: right;
  text-decoration: none;
}

.new-document-manage-link:hover,
.new-document-manage-link:focus-visible {
  color: var(--text-primary);
}
</style>
