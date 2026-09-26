<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, useId } from 'vue'

import DocumentIcon from './DocumentIcon.vue'
import { filterDocumentIcons } from '../lib/documentIcons'
import { filterEmoji, getRecentEmoji, rememberRecentEmoji } from '../lib/emoji'

// Emoji toggle button + popover. Emits `select` with the chosen character; the
// host inserts it (e.g. via ComposerEditor.insertText) so the picker stays
// agnostic of where the text ends up.
//
// With `icons` (document icons only) the popover gains an Icons tab, shown
// first, whose picks emit a Material Symbols value such as `ms:rocket_launch`
// (src/lib/documentIcons.js). The Emoji tab behaves exactly as without it.
const props = defineProps({
  disabled: { type: Boolean, default: false },
  label: { type: String, default: 'Insert emoji' },
  emoji: { type: String, default: '' },
  icons: { type: Boolean, default: false },
})
const emit = defineEmits(['select'])

const TABS = [
  { id: 'icons', title: 'Icons' },
  { id: 'emoji', title: 'Emoji' },
]

const open = ref(false)
const query = ref('')
const recent = ref([])
const tab = ref('emoji')
const rootRef = ref(null)
const searchRef = ref(null)
const tabRefs = ref([])
const idPrefix = useId()

const showingIcons = computed(() => props.icons && tab.value === 'icons')
const groups = computed(() => {
  if (showingIcons.value) return filterDocumentIcons(query.value)
  const matches = filterEmoji(query.value)
  if (query.value.trim() || !recent.value.length) return matches
  return [{ id: 'recent', title: 'Recently used', items: recent.value }, ...matches]
})
const isEmpty = computed(() => groups.value.every((group) => !group.items.length))
const searchLabel = computed(() => (showingIcons.value ? 'Search icons' : 'Search emoji'))

function toggle() {
  if (open.value) {
    close()
    return
  }
  query.value = ''
  recent.value = getRecentEmoji()
  tab.value = props.icons ? 'icons' : 'emoji'
  open.value = true
  nextTick(() => searchRef.value?.focus())
}

function close() {
  open.value = false
  query.value = ''
}

// Tabs follow the WAI-ARIA tabs pattern: a single tab stop, with the arrow
// keys moving between tabs and activating them.
function onTabKeydown(event) {
  const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key]
  if (!step) return
  event.preventDefault()
  const current = TABS.findIndex((item) => item.id === tab.value)
  const next = (current + step + TABS.length) % TABS.length
  tab.value = TABS[next].id
  tabRefs.value[next]?.focus()
}

function select(emoji) {
  rememberRecentEmoji(emoji.char)
  emit('select', emoji.char)
  close()
}

function selectIcon(icon) {
  emit('select', icon.value)
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
      :title="label"
      :aria-label="label"
      aria-haspopup="dialog"
      :aria-expanded="open"
      :disabled="disabled"
      @click="toggle"
    >
      <DocumentIcon v-if="emoji" :value="emoji" />
      <span v-else class="material-symbols-outlined" aria-hidden="true">add_reaction</span>
    </button>
    <div
      v-if="open"
      class="composer-emoji-popover"
      role="dialog"
      :aria-label="icons ? 'Icon picker' : 'Emoji picker'"
    >
      <div
        v-if="icons"
        class="composer-emoji-tabs"
        role="tablist"
        aria-label="Icon type"
        @keydown="onTabKeydown"
      >
        <button
          v-for="item in TABS"
          :id="`${idPrefix}-tab-${item.id}`"
          :key="item.id"
          ref="tabRefs"
          type="button"
          role="tab"
          class="composer-emoji-tab"
          :aria-selected="tab === item.id"
          :aria-controls="`${idPrefix}-panel`"
          :tabindex="tab === item.id ? 0 : -1"
          @click="tab = item.id"
        >
          {{ item.title }}
        </button>
      </div>
      <input
        ref="searchRef"
        v-model="query"
        class="composer-emoji-search"
        type="search"
        :placeholder="searchLabel"
        :aria-label="searchLabel"
        autocomplete="off"
      />
      <div
        :id="`${idPrefix}-panel`"
        class="composer-emoji-scroll"
        :role="icons ? 'tabpanel' : undefined"
        :aria-labelledby="icons ? `${idPrefix}-tab-${tab}` : undefined"
      >
        <template v-for="group in groups" :key="group.id">
          <div v-if="group.items.length" class="composer-emoji-group">
            <div class="composer-emoji-group-title">{{ group.title }}</div>
            <div v-if="showingIcons" class="composer-emoji-grid">
              <button
                v-for="icon in group.items"
                :key="icon.name"
                type="button"
                class="composer-emoji-item composer-emoji-symbol"
                :title="icon.label"
                :aria-label="icon.label"
                @click="selectIcon(icon)"
              >
                <span class="material-symbols-outlined" aria-hidden="true">{{ icon.name }}</span>
              </button>
            </div>
            <div v-else class="composer-emoji-grid">
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
        <div v-if="isEmpty" class="composer-emoji-empty">
          {{ showingIcons ? 'No icons found' : 'No emoji found' }}
        </div>
      </div>
    </div>
  </div>
</template>
