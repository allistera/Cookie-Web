<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

import EditorJS from '@editorjs/editorjs'
import Header from '@editorjs/header'
import List from '@editorjs/list'
import Table from '@editorjs/table'
import CodeTool from '@editorjs/code'
import Delimiter from '@editorjs/delimiter'
import ImageTool from '@editorjs/image'
import DragDrop from 'editorjs-drag-drop'

import { useInboxStore } from '../stores/inbox'
import { formatInsertedDate } from '../lib/documentDates'

// "/" menu entry that stamps today's date ("Monday - 4th September") into the
// document. It is not a real block type: on selection it swaps itself for a
// plain paragraph holding the text, so nothing custom is ever persisted.
class InsertDateTool {
  static get toolbox() {
    return {
      title: 'Date',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/></svg>',
    }
  }

  constructor({ api, block }) {
    this.api = api
    this.block = block
  }

  render() {
    // Deferred so Editor.js finishes mounting this block before it is
    // replaced; the paragraph lands at the same index with the caret at its
    // end, ready to keep typing. The index comes from this block's own id —
    // getCurrentBlockIndex tracks focus, which WebKit moves on the popover
    // click, and a wrong index here deletes real content.
    setTimeout(() => {
      let index = this.api.blocks.getCurrentBlockIndex()
      for (let i = 0; i < this.api.blocks.getBlocksCount(); i++) {
        if (this.api.blocks.getBlockByIndex(i)?.id === this.block?.id) {
          index = i
          break
        }
      }
      this.api.blocks.insert('paragraph', { text: formatInsertedDate() }, {}, index + 1, false)
      this.api.blocks.delete(index)
      this.api.caret.setToBlock(index, 'end')
    })
    return document.createElement('div')
  }

  save() {
    return {}
  }
}

// The paper-style block editor for one document: an Editor.js instance under
// a contenteditable title. Content changes are emitted upward; persistence
// (and its debounce) belongs to the documents store, not this component.
const props = defineProps({
  doc: { type: Object, required: true },
})
const emit = defineEmits(['save'])

const inbox = useInboxStore()
const holder = ref(null)
const titleEl = ref(null)
let editor = null

// Images are inlined as data: URLs in the block data (no upload endpoint),
// so a size cap keeps a single picture from bloating the document row.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

const imageUploader = {
  uploadByFile(file) {
    return new Promise((resolve, reject) => {
      if (file.size > MAX_IMAGE_BYTES) {
        inbox.notify('Image is too large — pick a file under 5MB.', 'error')
        reject(new Error('File too large'))
        return
      }
      const reader = new FileReader()
      reader.onload = (event) => resolve({ success: 1, file: { url: event.target.result } })
      reader.onerror = (err) => reject(err)
      reader.readAsDataURL(file)
    })
  },
  uploadByUrl(url) {
    return Promise.resolve({ success: 1, file: { url } })
  },
}

async function emitBlocks() {
  if (!editor) return
  try {
    const output = await editor.save()
    emit('save', { blocks: output.blocks })
  } catch (error) {
    console.error('Reading editor content failed:', error)
  }
}

function mountEditor() {
  // The title is contenteditable, so it is filled imperatively — a template
  // text binding would re-render on the store's own save echo and throw the
  // caret back to the start mid-typing.
  if (titleEl.value) titleEl.value.textContent = props.doc.title ?? ''
  editor?.destroy?.()
  editor = new EditorJS({
    holder: holder.value,
    data: { blocks: Array.isArray(props.doc.blocks) ? props.doc.blocks : [] },
    placeholder: 'Write something, or press Tab for blocks…',
    tools: {
      header: {
        class: Header,
        inlineToolbar: ['link', 'bold', 'italic'],
        config: { placeholder: 'Heading', levels: [1, 2, 3], defaultLevel: 2 },
      },
      // List v2 covers unordered/ordered/checklist styles in one tool — a
      // separate Checklist tool would double-list "Checklist" in the "/" menu.
      list: { class: List, inlineToolbar: true, config: { defaultStyle: 'unordered' } },
      table: { class: Table, inlineToolbar: true },
      code: { class: CodeTool, config: { placeholder: 'Write code here…' } },
      delimiter: Delimiter,
      date: InsertDateTool,
      image: { class: ImageTool, config: { uploader: imageUploader } },
    },
    onChange: () => {
      emitBlocks()
    },
    onReady: () => {
      new DragDrop(editor)
    },
  })
}

onMounted(mountEditor)
onBeforeUnmount(() => {
  editor?.destroy?.()
  editor = null
})

// Switching to another document rebuilds the instance; Editor.js has no
// cheap "replace all content" path that keeps tool state consistent.
watch(
  () => props.doc.id,
  () => mountEditor(),
)

function onTitleInput(event) {
  emit('save', { title: event.target.textContent ?? '' })
}

// Enter in the title moves into the body, like paper.
function onTitleEnter() {
  try {
    editor?.caret?.setToFirstBlock?.('start')
  } catch {
    editor?.focus?.()
  }
}
</script>

<template>
  <div class="document-editor">
    <h1
      ref="titleEl"
      class="document-title"
      contenteditable="true"
      spellcheck="false"
      data-placeholder="Untitled"
      aria-label="Document title"
      @input="onTitleInput"
      @keydown.enter.prevent="onTitleEnter"
    ></h1>
    <div ref="holder" class="document-blocks"></div>
  </div>
</template>

<style scoped>
.document-editor {
  max-width: 720px;
  margin: 0 auto;
  padding: 40px 24px 120px;
}

.document-title {
  font-size: 32px;
  font-weight: 700;
  line-height: 1.2;
  color: var(--text-primary);
  outline: none;
  margin-bottom: 12px;
}

.document-title:empty::before {
  content: attr(data-placeholder);
  color: var(--text-secondary);
  opacity: 0.5;
}

/* Editor.js paints for a light page by default; pull its chrome onto the
   app's theme tokens so it follows dark mode too. */
.document-blocks :deep(.ce-block__content),
.document-blocks :deep(.ce-toolbar__content) {
  max-width: 100%;
}

.document-blocks :deep(.codex-editor__redactor) {
  padding-bottom: 120px !important;
}

.document-blocks :deep(.ce-paragraph[data-placeholder]:empty::before) {
  color: var(--text-secondary);
}

.document-blocks :deep(.ce-popover),
.document-blocks :deep(.ce-inline-toolbar),
.document-blocks :deep(.ce-conversion-toolbar) {
  background: var(--bg-dialog);
  border-color: var(--border-color);
  color: var(--text-primary);
  box-shadow: var(--shadow-md);
}

.document-blocks :deep(.ce-popover-item),
.document-blocks :deep(.ce-popover-item__title),
.document-blocks :deep(.ce-inline-tool),
.document-blocks :deep(.ce-conversion-tool) {
  color: var(--text-primary);
}

.document-blocks :deep(.ce-popover-item:hover),
.document-blocks :deep(.ce-inline-tool:hover),
.document-blocks :deep(.ce-conversion-tool:hover) {
  background: var(--bg-hover);
}

.document-blocks :deep(.ce-popover-item__icon),
.document-blocks :deep(.ce-toolbar__plus),
.document-blocks :deep(.ce-toolbar__settings-btn) {
  color: var(--text-primary);
  background: transparent;
}

.document-blocks :deep(.ce-toolbar__plus:hover),
.document-blocks :deep(.ce-toolbar__settings-btn:hover) {
  background: var(--bg-hover);
}

.document-blocks :deep(.ce-code__textarea) {
  background: var(--bg-input);
  color: var(--text-primary);
  border-color: var(--border-color);
  font-family: var(--font-mono);
}

.document-blocks :deep(.tc-cell),
.document-blocks :deep(.tc-row),
.document-blocks :deep(.tc-table) {
  border-color: var(--border-color);
}
</style>
