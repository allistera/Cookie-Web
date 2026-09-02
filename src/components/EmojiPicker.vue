<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'

import { filterEmoji, getRecentEmoji, rememberRecentEmoji } from '../lib/emoji'

// Emoji toggle button + popover. Emits `select` with the chosen character; the
// host inserts it (e.g. via ComposerEditor.insertText) so the picker stays
// agnostic of where the text ends up.
defineProps({
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['select'])

const open = ref(false)
const query = ref('')
const recent = ref([])
const rootRef = ref(null)
const searchRef = ref(null)

const groups = computed(() => {
  const matches = filterEmoji(query.value)
  if (query.value.trim() || !recent.value.length) return matches
  return [{ id: 'recent', title: 'Recently used', items: recent.value }, ...matches]
})
const isEmpty = computed(() => groups.value.every((group) => !group.items.length))

function toggle() {
  if (open.value) {
    close()
    return
  }
  query.value = ''
  recent.value = getRecentEmoji()
  open.value = true
  nextTick(() => searchRef.value?.focus())
}

function close() {
  open.value = false
  query.value = ''
}

function select(emoji) {
  rememberRecentEmoji(emoji.char)
  emit('select', emoji.char)
  close()
}

function onDocumentClick(event) {
  if (!open.value) return
  const target = event.target instanceof Node ? event.target : null
  if (target && rootRef.value?.contains(target)) return
  close()
}

onMounted(() => document.addEventListener('click', onDocumentClick))
onUnmounted(() => document.removeEventListener('click', onDocumentClick))
</script>

<template>
  <div ref="rootRef" class="composer-emoji-wrap" @keydown.esc.stop="close">
    <button
      type="button"
      class="composer-icon-btn composer-emoji-btn"
      title="Insert emoji"
      aria-label="Insert emoji"
      aria-haspopup="dialog"
      :aria-expanded="open"
      :disabled="disabled"
      @click="toggle"
    >
      <span class="material-symbols-outlined">add_reaction</span>
    </button>
    <div v-if="open" class="composer-emoji-popover" role="dialog" aria-label="Emoji picker">
      <input
        ref="searchRef"
        v-model="query"
        class="composer-emoji-search"
        type="search"
        placeholder="Search emoji"
        aria-label="Search emoji"
        autocomplete="off"
      />
      <div class="composer-emoji-scroll">
        <template v-for="group in groups" :key="group.id">
          <div v-if="group.items.length" class="composer-emoji-group">
            <div class="composer-emoji-group-title">{{ group.title }}</div>
            <div class="composer-emoji-grid">
              <button
                v-for="emoji in group.items"
                :key="emoji.char"
                type="button"
                class="composer-emoji-item"
                :title="emoji.name"
                :aria-label="emoji.name"
                @click="select(emoji)"
              >
                {{ emoji.char }}
              </button>
            </div>
          </div>
        </template>
        <div v-if="isEmpty" class="composer-emoji-empty">No emoji found</div>
      </div>
    </div>
  </div>
</template>
