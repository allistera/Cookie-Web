<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { useDocumentsStore } from '../stores/documents'
import { fileIcon } from '../lib/documentFiles'
import { hasThumbnail, thumbnailCache } from '../lib/fileThumbnails'

// The icon slot of a file entry in the folder browser. Image files load
// their bytes once scrolled into view and show them in place of the icon;
// every other type, and an image that fails to load, keeps the icon.
const props = defineProps({
  fileId: { type: String, required: true },
  mimeType: { type: String, default: '' },
})

const store = useDocumentsStore()
const root = ref(null)
const url = ref('')
let observer = null
let requested = false

async function load() {
  if (requested || !hasThumbnail(props.mimeType)) return
  requested = true
  try {
    const loaded = await thumbnailCache.load(props.fileId, (id) => store.fetchFileBlob(id))
    if (requested) url.value = loaded
  } catch {
    // Keep the icon; the cache did not store the failure, so a later
    // visit retries.
    requested = false
  }
}

function disconnect() {
  observer?.disconnect()
  observer = null
}

// Full uploads can run to 25 MB, so a folder of photos only fetches the
// ones on screen. Browsers without IntersectionObserver load immediately.
function observe() {
  disconnect()
  if (!hasThumbnail(props.mimeType)) return
  url.value = thumbnailCache.get(props.fileId) ?? ''
  if (url.value) return
  if (!globalThis.IntersectionObserver || !root.value) {
    void load()
    return
  }
  observer = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return
    disconnect()
    void load()
  })
  observer.observe(root.value)
}

onMounted(observe)
watch(
  () => [props.fileId, props.mimeType],
  () => {
    requested = false
    observe()
  },
)
onBeforeUnmount(() => {
  requested = false
  disconnect()
})
</script>

<template>
  <span ref="root" class="file-thumbnail" :class="{ 'has-image': url }" aria-hidden="true">
    <img v-if="url" class="file-thumbnail-img" :src="url" alt="" @error="url = ''" />
    <span v-else class="material-symbols-outlined">{{ fileIcon(mimeType) }}</span>
  </span>
</template>

<style scoped>
.file-thumbnail {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.file-thumbnail-img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: inherit;
  background: var(--bg-hover);
}
</style>
