<script setup>
import { ref, computed, onMounted, watch } from 'vue'

import { escapeHtml } from '../lib/composeHtml'
import { convertEmojiToEmoticons } from '../lib/emoticons'
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
  if (!match) return
  const deleteLength = match[1].length + 1 // the "/" plus the query
  const startAt = before.text.length - deleteLength
  const walker = document.createTreeWalker(editorRef.value, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  let seen = 0
  while (node) {
    const next = seen + node.textContent.length
    if (startAt < next) break
    seen = next
    node = walker.nextNode()
  }
  if (!node) return
  const range = document.createRange()
  range.setStart(node, Math.max(0, startAt - seen))
  range.setEnd(before.range.startContainer, before.range.startOffset)
  range.deleteContents()
  // Deleting the trigger can leave its line as an empty block, which the
  // browser resolves to the end of the previous line — so a block command
  // would restyle that line instead. Keep the emptied line renderable.
  const line = emptiedLine(range.startContainer)
  if (line) {
    line.appendChild(document.createElement('br'))
    placeCaret(line, 0)
  } else {
    placeCaret(range.startContainer, range.startOffset)
  }
}

const LINE_BLOCKS = 'div, p, li, h1, h2, h3, h4, blockquote, pre'

function emptiedLine(node) {
  const editor = editorRef.value
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentNode
  const line = element.closest(LINE_BLOCKS)
  if (!line || line === editor || !editor.contains(line)) return null
  return line.textContent === '' && !line.querySelector('br') ? line : null
}

function insertHtmlAtCaret(html) {
  const editor = editorRef.value
  if (!editor || !html) return
  const selection = window.getSelection()
  if (!selection?.rangeCount) {
    editor.insertAdjacentHTML('beforeend', html)
    return
  }
  const range = selection.getRangeAt(0)
  if (range.commonAncestorContainer !== editor && !editor.contains(range.commonAncestorContainer)) {
    editor.insertAdjacentHTML('beforeend', html)
    return
  }
  range.deleteContents()
  const fragment = range.createContextualFragment(html)
  const lastNode = fragment.lastChild
  range.insertNode(fragment)
  if (!lastNode) return
  range.setStartAfter(lastNode)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
}

function insertSnippet(html) {
  insertHtmlAtCaret(sanitizeEmailHtml(html))
}

// Toolbar controls move focus away from the editor. Insert at the browser's
// retained selection when it is still inside the editor, or append otherwise.
function insertText(text) {
  if (!text) return
  insertHtmlAtCaret(escapeHtml(text))
  emitUpdate()
}

function onPaste(event) {
  const html = event.clipboardData?.getData('text/html')
  const text = event.clipboardData?.getData('text/plain') ?? ''
  const inserted = html ? sanitizeEmailHtml(html) : escapeHtml(text).replace(/\n/g, '<br>')
  insertHtmlAtCaret(inserted)
  emitUpdate()
  updateSlashMenu()
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
    case 'code':
      document.execCommand('formatBlock', false, '<pre>')
      break
    case 'divider':
      document.execCommand('insertHorizontalRule')
      break
  }
}

// --- Code blocks ---
// Browsers disagree on Enter inside a <pre> (Chrome splits the block, Firefox
// inserts a line break), so the editor handles it: Enter adds a line break and
// Enter on an empty trailing line leaves the block for a fresh paragraph.

function caretCodeBlock() {
  const selection = window.getSelection()
  if (!selection?.rangeCount || !selection.isCollapsed) return null
  const range = selection.getRangeAt(0)
  const editor = editorRef.value
  if (!editor || !editor.contains(range.startContainer)) return null
  const { startContainer } = range
  const element =
    startContainer.nodeType === Node.ELEMENT_NODE ? startContainer : startContainer.parentNode
  const pre = element.closest('pre')
  return pre && pre !== editor && editor.contains(pre) ? { pre, range } : null
}

// Child nodes of a fragment that render something (empty text nodes don't).
function visibleNodes(fragment) {
  return [...fragment.childNodes].filter(
    (node) => node.nodeType !== Node.TEXT_NODE || node.data !== '',
  )
}

function isLineBreak(node) {
  return node.nodeName === 'BR'
}

function placeCaret(container, offset) {
  const caret = document.createRange()
  caret.setStart(container, offset)
  caret.collapse(true)
  const selection = window.getSelection()
  selection.removeAllRanges()
  selection.addRange(caret)
}

function nodesAfterCaret(pre, range) {
  const after = range.cloneRange()
  after.setEnd(pre, pre.childNodes.length)
  return visibleNodes(after.cloneContents())
}

// The caret is on an empty trailing line when it directly follows a line
// break and only line breaks remain after it in the block.
function onEmptyTrailingLine(pre, range) {
  if (!nodesAfterCaret(pre, range).every(isLineBreak)) return false
  const before = range.cloneRange()
  before.setStart(pre, 0)
  const last = visibleNodes(before.cloneContents()).at(-1)
  return Boolean(last && isLineBreak(last))
}

function insertCodeLineBreak(pre, range) {
  const br = document.createElement('br')
  range.insertNode(br)
  const caret = document.createRange()
  caret.setStartAfter(br)
  caret.collapse(true)
  // A caret after the block's last <br> renders on the same line unless a
  // placeholder <br> follows it.
  if (nodesAfterCaret(pre, caret).length === 0) pre.appendChild(document.createElement('br'))
  placeCaret(caret.startContainer, caret.startOffset)
}

function leaveCodeBlock(pre) {
  while (pre.lastChild && (isLineBreak(pre.lastChild) || pre.lastChild.data === '')) {
    pre.lastChild.remove()
  }
  const paragraph = document.createElement('div')
  paragraph.appendChild(document.createElement('br'))
  pre.after(paragraph)
  if (!pre.textContent) pre.remove()
  placeCaret(paragraph, 0)
}

function onCodeBlockEnter(event) {
  const block = caretCodeBlock()
  if (!block) return false
  event.preventDefault()
  if (onEmptyTrailingLine(block.pre, block.range)) leaveCodeBlock(block.pre)
  else insertCodeLineBreak(block.pre, block.range)
  emitUpdate()
  return true
}

function selectCommand(command) {
  editorRef.value.focus()
  removeSlashText()
  applyCommand(command)
  menuOpen.value = false
  emitUpdate()
}

function normalizeEmoji() {
  const editor = editorRef.value
  if (!editor) return false

  const selection = window.getSelection()
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null
  const selectionInEditor =
    range &&
    (range.startContainer === editor || editor.contains(range.startContainer)) &&
    (range.endContainer === editor || editor.contains(range.endContainer))
  const startContainer = selectionInEditor ? range.startContainer : null
  const endContainer = selectionInEditor ? range.endContainer : null
  let startOffset = selectionInEditor ? range.startOffset : 0
  let endOffset = selectionInEditor ? range.endOffset : 0
  let changed = false

  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node) {
    const original = node.data
    const converted = convertEmojiToEmoticons(original)
    if (converted !== original) {
      if (node === startContainer) {
        startOffset = convertEmojiToEmoticons(original.slice(0, startOffset)).length
      }
      if (node === endContainer) {
        endOffset = convertEmojiToEmoticons(original.slice(0, endOffset)).length
      }
      node.data = converted
      changed = true
    }
    node = walker.nextNode()
  }

  if (changed && selectionInEditor) {
    const restored = document.createRange()
    restored.setStart(startContainer, startOffset)
    restored.setEnd(endContainer, endOffset)
    selection.removeAllRanges()
    selection.addRange(restored)
  }
  return changed
}

function emitUpdate() {
  if (!editorRef.value) return
  normalizeEmoji()
  emit('update:modelValue', editorRef.value.innerHTML)
  // innerText is layout-aware (keeps line breaks); jsdom doesn't implement
  // it, so tests fall back to textContent.
  emit('update:text', editorRef.value.innerText ?? editorRef.value.textContent)
}

// Explicit insertions update the visible editor and both models together,
// including when it is focused. Callers must protect intervening user edits.
function replaceContent(html) {
  if (!editorRef.value) return
  editorRef.value.innerHTML = sanitizeEmailHtml(html)
  menuOpen.value = false
  emitUpdate()
}

const DANGEROUS_HTML_RE = /<script|on\w+=|javascript:/i

function onInput() {
  const el = editorRef.value
  if (el && DANGEROUS_HTML_RE.test(el.innerHTML)) {
    const clean = sanitizeEmailHtml(el.innerHTML)
    // Only rewrite when sanitization actually changed something: assigning
    // innerHTML resets the caret to the start even when the output is
    // identical — e.g. while literally typing "javascript:" in a message.
    if (clean !== el.innerHTML) el.innerHTML = clean
  }
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
  if (event.key === 'Enter' && !event.shiftKey && onCodeBlockEnter(event)) return
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
      el.innerHTML = sanitizeEmailHtml(value)
      if (normalizeEmoji()) emitUpdate()
    }
  },
)

onMounted(() => {
  if (editorRef.value) {
    editorRef.value.innerHTML = sanitizeEmailHtml(props.modelValue)
    if (normalizeEmoji()) emitUpdate()
  }
})

defineExpose({ focus: () => editorRef.value?.focus(), insertText, replaceContent })
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
      @paste.prevent="onPaste"
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
