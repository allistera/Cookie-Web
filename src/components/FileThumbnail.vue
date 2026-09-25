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

// How long the shorter side of a cached thumbnail needs to be to fill a card
// (object-fit: cover) at 2x pixel density.
const THUMBNAIL_EDGE = 320

async function load() {
  if (requested || !hasThumbnail(props.mimeType)) return
  requested = true
  const id = props.fileId
  try {
    const loaded = await thumbnailCache.load(id, (fileId) => store.fetchFileBlob(fileId))
    if (requested && id === props.fileId) url.value = loaded
  } catch {
    // Keep the icon; the cache did not store the failure, so a later
    // visit retries.
    requested = false
  }
}

// The cached object URL pins the full upload (up to 25 MB) in memory. Once
// the <img> has decoded it, swap the cache entry for a small re-encoded copy:
// set() revokes the full-size URL, and re-entering the folder still reuses
// the cached thumbnail. The small copy reloads the <img>, which then fits and
// stops here. GIFs keep the original: a canvas copy would freeze animation.
function shrink(event) {
  if (props.mimeType === 'image/gif') return
  const img = event.target
  const width = img.naturalWidth
  const height = img.naturalHeight
  const scale = THUMBNAIL_EDGE / Math.min(width, height)
  if (!(scale < 1)) return
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  const context = canvas.getContext('2d')
  if (!context) return
  context.drawImage(img, 0, 0, canvas.width, canvas.height)
  const id = props.fileId
  const full = url.value
  canvas.toBlob(
    (blob) => {
      // Another card may already have swapped it, or this one moved on.
      if (!blob || thumbnailCache.get(id) !== full) return
      const small = thumbnailCache.set(id, blob)
      if (url.value === full) url.value = small
    },
    'image/webp',
    0.85,
  )
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
    <img v-if="url" class="file-thumbnail-img" :src="url" alt="" @load="shrink" @error="url = ''" />
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
