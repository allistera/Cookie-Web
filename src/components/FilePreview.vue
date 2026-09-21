<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useDocumentsStore } from '../stores/documents'
import { isPreviewable } from '../lib/documentFiles'

// The content route needs the bearer header, so the bytes are fetched and
// shown through an object URL rather than pointing the element at the API.
const props = defineProps({ fileId: { type: String, required: true } })
const store = useDocumentsStore()
const router = useRouter()

const file = ref(null)
const objectUrl = ref('')
const error = ref('')
const loading = ref(false)

function release() {
  if (objectUrl.value) URL.revokeObjectURL(objectUrl.value)
  objectUrl.value = ''
}

function download(blob) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = file.value?.name || 'download'
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function load() {
  release()
  error.value = ''
  loading.value = true
  try {
    file.value = await store.loadFile(props.fileId)
    const blob = await store.fetchFileBlob(props.fileId)
    if (isPreviewable(file.value.mime_type)) {
      objectUrl.value = URL.createObjectURL(blob)
    } else {
      download(blob)
    }
  } catch {
    error.value = 'This file could not be loaded.'
  } finally {
    loading.value = false
  }
}

async function downloadCurrent() {
  try {
    download(await store.fetchFileBlob(props.fileId))
  } catch {
    store.notify('Download failed.', 'error')
  }
}

function close() {
  const folder = file.value?.folder_id
  router.push(folder ? { path: '/documents', query: { folder } } : '/documents')
}

watch(() => props.fileId, load, { immediate: true })
onBeforeUnmount(release)
</script>

<template>
  <section class="file-preview" aria-label="File preview">
    <header class="file-preview-header">
      <button type="button" class="back-link" aria-label="Back to folder" @click="close">
        <span class="material-symbols-outlined" aria-hidden="true">arrow_back</span>
      </button>
      <h1>{{ file?.name || 'File' }}</h1>
      <button
        type="button"
        class="file-preview-download"
        :disabled="!file"
        @click="downloadCurrent"
      >
        <span class="material-symbols-outlined" aria-hidden="true">download</span>
        <span>Download</span>
      </button>
    </header>
    <p v-if="error" role="alert" class="file-preview-error">{{ error }}</p>
    <div v-else-if="loading" class="documents-loading"><div class="spinner"></div></div>
    <div v-else-if="objectUrl" class="file-preview-body">
      <img v-if="file.mime_type.startsWith('image/')" :src="objectUrl" :alt="file.name" />
      <iframe v-else :src="objectUrl" :title="file.name"></iframe>
    </div>
    <p v-else class="file-preview-error">
      This file type has no preview. Its download has started.
    </p>
  </section>
</template>

<style scoped>
.file-preview {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 70vh;
}
.file-preview-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0 16px;
}
.file-preview-header h1 {
  flex: 1;
  margin: 0;
  font-size: 18px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.back-link,
.file-preview-download {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-card);
  color: var(--text-primary);
  cursor: pointer;
}
.file-preview-body {
  flex: 1;
  display: flex;
  justify-content: center;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  overflow: hidden;
}
.file-preview-body img {
  max-width: 100%;
  max-height: 80vh;
  object-fit: contain;
  align-self: center;
}
.file-preview-body iframe {
  width: 100%;
  min-height: 75vh;
  border: none;
}
.file-preview-error {
  padding: 24px;
  color: var(--text-secondary);
  text-align: center;
}
</style>
