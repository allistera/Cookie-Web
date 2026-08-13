<script setup>
import { ref, computed, onMounted, watch } from 'vue'

import { filterSlashCommands } from '../lib/slashCommands'
import { sanitizeEmailHtml } from '../lib/sanitizeEmailHtml'
import { getSlashSnippetCommands } from '../lib/snippets'

const props = defineProps({
  modelValue: { type: String, default: '' },
  placeholder: { type: String, default: 'Write your message, or type “/” for commands…' },
  // Hides the AI "Generate Message" slash command (e.g. in the signature editor).
  hideGenerate: { type: Boolean, default: false },
  snippets: { type: Array, default: () => [] },
})
const emit = defineEmits(['update:modelValue', 'update:text', 'generate', 'focusPrev'])

const editorRef = ref(null)

// --- Slash menu state ---
const menuOpen = ref(false)
const menuQuery = ref('')
const menuIndex = ref(0)
const menuStyle = ref({})
const menuCommands = computed(() =>
  filterSlashCommands(menuQuery.value, getSlashSnippetCommands(props.snippets)).filter(
    (command) => !(props.hideGenerate && command.id === 'generate'),
  ),
)

// Matches the final slash sequence before the caret. Commands are deliberately
// available anywhere in the compose body, including directly after text.
const SLASH_RE = /\/([^\s/]*)$/

function textBeforeCaret() {
  const selection = window.getSelection()
  if (!selection || !selection.rangeCount || !selection.isCollapsed) return null
  const range = selection.getRangeAt(0)
  const editor = editorRef.value
  if (!editor || !editor.contains(range.startContainer)) return null
  const before = range.cloneRange()
  before.selectNodeContents(editor)
  before.setEnd(range.startContainer, range.startOffset)
  return { text: before.toString(), range }
}

function updateSlashMenu() {
  const before = textBeforeCaret()
  const match = before && SLASH_RE.exec(before.text)
  if (!match) {
    menuOpen.value = false
    return
  }
  // Set the query first so menuCommands — the very list the menu renders —
  // decides whether there is anything to show, rather than filtering twice.
  menuQuery.value = match[1]
  if (!menuCommands.value.length) {
    menuOpen.value = false
    return
  }
  menuIndex.value = 0
  const range = window.getSelection().getRangeAt(0)
  const host = editorRef.value.getBoundingClientRect()
  const caret = range.getBoundingClientRect?.() || host
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
  if (!match) return null
  const deleteLength = match[1].length + 1 // the "/" plus the query
  const startAt = before.text.length - deleteLength
  const walker = document.createTreeWalker(editorRef.value, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  let seen = 0
  while (node) {
    const next = seen + node.textContent.length
    if (startAt <= next) break
    seen = next
    node = walker.nextNode()
  }
  if (!node) return null
  const range = document.createRange()
  range.setStart(node, Math.max(0, startAt - seen))
  range.setEnd(before.range.startContainer, before.range.startOffset)
  range.deleteContents()
  const selection = window.getSelection()
  selection.removeAllRanges()
  const caret = document.createRange()
  caret.setStart(range.startContainer, range.startOffset)
  caret.collapse(true)
  selection.addRange(caret)
  return caret
}

function insertSnippet(html) {
  const selection = window.getSelection()
  if (!selection?.rangeCount) return
  const range = selection.getRangeAt(0)
  const fragment = range.createContextualFragment(sanitizeEmailHtml(html))
  const lastNode = fragment.lastChild
  if (!lastNode) return
  range.insertNode(fragment)
  range.setStartAfter(lastNode)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
}

function applyCommand(command) {
  if (command.type === 'snippet') {
    insertSnippet(command.html)
    return
  }
  // execCommand is deprecated but is still the pragmatic, dependency-free way
  // to apply inline formatting inside a contenteditable across browsers.
  switch (command.id) {
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
  applyCommand(command)
  menuOpen.value = false
  emitUpdate()
}

function emitUpdate() {
  if (!editorRef.value) return
  emit('update:modelValue', editorRef.value.innerHTML)
  // innerText is layout-aware (keeps line breaks); jsdom doesn't implement
  // it, so tests fall back to textContent.
  emit('update:text', editorRef.value.innerText ?? editorRef.value.textContent)
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
