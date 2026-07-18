<script setup>
import { ref, computed, onMounted, watch } from 'vue'

import { filterSlashCommands } from '../lib/slashCommands'

const props = defineProps({
  modelValue: { type: String, default: '' },
  placeholder: { type: String, default: 'Write your message, or type “/” for commands…' },
  // Hides the AI "Generate Message" slash command (e.g. in the signature editor).
  hideGenerate: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue', 'update:text', 'generate', 'focusPrev'])

const editorRef = ref(null)

// --- Slash menu state ---
const menuOpen = ref(false)
const menuQuery = ref('')
const menuIndex = ref(0)
const menuStyle = ref({})
const menuCommands = computed(() =>
  filterSlashCommands(menuQuery.value).filter(
    (command) => !(props.hideGenerate && command.id === 'generate'),
  ),
)

// Matches a "/" that starts a slash sequence (at line start or after
// whitespace) followed by the query, anchored to the caret.
const SLASH_RE = /(?:^|\s)\/([^\s/]*)$/

function textBeforeCaret() {
  const selection = window.getSelection()
  if (!selection || !selection.rangeCount || !selection.isCollapsed) return null
  const range = selection.getRangeAt(0)
  const node = range.startContainer
  if (node.nodeType !== Node.TEXT_NODE) return null
  return { node, offset: range.startOffset, text: node.textContent.slice(0, range.startOffset) }
}

function updateSlashMenu() {
  const before = textBeforeCaret()
  const match = before && SLASH_RE.exec(before.text)
  if (!match || filterSlashCommands(match[1]).length === 0) {
    menuOpen.value = false
    return
  }
  menuQuery.value = match[1]
  menuIndex.value = 0
  const range = window.getSelection().getRangeAt(0)
  const caret = range.getBoundingClientRect()
  const host = editorRef.value.getBoundingClientRect()
  menuStyle.value = {
    top: `${caret.bottom - host.top + editorRef.value.scrollTop + 4}px`,
    left: `${caret.left - host.left}px`,
  }
  menuOpen.value = true
}

// Deletes the "/query" the user typed before invoking a command.
function removeSlashText() {
  const before = textBeforeCaret()
  const match = before && SLASH_RE.exec(before.text)
  if (!match) return
  const deleteLength = match[1].length + 1 // the "/" plus the query
  const start = before.offset - deleteLength
  const range = document.createRange()
  range.setStart(before.node, start)
  range.setEnd(before.node, before.offset)
  range.deleteContents()
  const selection = window.getSelection()
  selection.removeAllRanges()
  const caret = document.createRange()
  caret.setStart(before.node, start)
  caret.collapse(true)
  selection.addRange(caret)
}

function applyCommand(id) {
  // execCommand is deprecated but is still the pragmatic, dependency-free way
  // to apply inline formatting inside a contenteditable across browsers.
  switch (id) {
    case 'generate':
      emit('generate')
      break
    case 'heading':
      document.execCommand('formatBlock', false, '<h2>')
      break
    case 'quote':
      document.execCommand('formatBlock', false, '<blockquote>')
      break
    case 'bullet':
      document.execCommand('insertUnorderedList')
      break
    case 'numbered':
      document.execCommand('insertOrderedList')
      break
    case 'bold':
      document.execCommand('bold')
      break
    case 'divider':
      document.execCommand('insertHorizontalRule')
      break
  }
}

function selectCommand(command) {
  editorRef.value.focus()
  removeSlashText()
  applyCommand(command.id)
  menuOpen.value = false
  emitUpdate()
}

function emitUpdate() {
  if (!editorRef.value) return
  emit('update:modelValue', editorRef.value.innerHTML)
  emit('update:text', editorRef.value.innerText)
}

function onInput() {
  emitUpdate()
  updateSlashMenu()
}

function onKeydown(event) {
  if (menuOpen.value && menuCommands.value.length) {
    const count = menuCommands.value.length
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      menuIndex.value = (menuIndex.value + 1) % count
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      menuIndex.value = (menuIndex.value - 1 + count) % count
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      selectCommand(menuCommands.value[menuIndex.value])
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      menuOpen.value = false
      return
    }
  }
  if (event.key === 'Tab' && event.shiftKey) {
    event.preventDefault()
    emit('focusPrev')
  }
}

function onBlur() {
  // Item clicks use mousedown.prevent, so blur won't fire from selecting one.
  menuOpen.value = false
}

// External updates (AI insert, reset on close) replace the content — but only
// when the user isn't actively typing, so live editing isn't clobbered.
watch(
  () => props.modelValue,
  (value) => {
    const el = editorRef.value
    if (el && document.activeElement !== el && value !== el.innerHTML) {
      el.innerHTML = value || ''
    }
  },
)

onMounted(() => {
  if (editorRef.value) editorRef.value.innerHTML = props.modelValue || ''
})

defineExpose({ focus: () => editorRef.value?.focus() })
</script>

<template>
  <div class="composer-editor-wrap">
    <div
      ref="editorRef"
      class="composer-editor"
      contenteditable="true"
      role="textbox"
      aria-multiline="true"
      :data-placeholder="placeholder"
      @input="onInput"
      @keydown="onKeydown"
      @blur="onBlur"
    ></div>
    <div v-if="menuOpen && menuCommands.length" class="composer-slash-menu" :style="menuStyle">
      <div
        v-for="(command, i) in menuCommands"
        :key="command.id"
        class="suggestion-item"
        :class="{ highlighted: i === menuIndex }"
        @mousedown.prevent="selectCommand(command)"
        @mouseenter="menuIndex = i"
      >
        <span class="material-symbols-outlined text-purple">{{ command.icon }}</span>
        <span class="composer-slash-title">{{ command.title }}</span>
        <span class="composer-slash-hint">{{ command.hint }}</span>
      </div>
    </div>
  </div>
</template>
