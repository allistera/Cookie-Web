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
import { createDocumentSaveScheduler } from '../lib/documentSaveScheduler'
import { ExcalidrawBlockTool } from '../lib/excalidrawBlockTool'
import { KanbanBlockTool } from '../lib/kanbanBlockTool'
import { highlightScheduleLines } from '../lib/documentScheduleHighlight'
import { MAX_DOCUMENT_TAGS, normalizeDocumentTag } from '../lib/documentTags'

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
    // end, ready to keep typing. The index comes only from this block's own
    // id — getCurrentBlockIndex tracks focus, which the popover click moves
    // in some engines, and deleting a guessed index destroys real content.
    // If the id can't be found, do nothing rather than guess.
    setTimeout(() => {
      let index = -1
      for (let i = 0; i < this.api.blocks.getBlocksCount(); i++) {
        if (this.api.blocks.getBlockByIndex(i)?.id === this.block?.id) {
          index = i
          break
        }
      }
      if (index === -1) return
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
  compact: { type: Boolean, default: false },
  // Only Daily notes (Daily/<year>/<month>/DD-MM-YY) actually sync a typed
  // time line into a real calendar event (api/_lib/dailyEventSync.js) - the
  // highlight only appears there too, so it never implies a regular
  // document's line is doing something it isn't.
  isDailyNote: { type: Boolean, default: false },
})
const emit = defineEmits(['save'])

const inbox = useInboxStore()
const holder = ref(null)
const titleEl = ref(null)
const tags = ref([])
const tagDraft = ref('')
let editor = null

// Editor.js emits a change for each block mutation. Serializing every block on
// every keystroke makes editing cost grow with the whole document, even though
// the store already waits before sending the result to the API. Coalesce those
// mutations here so both serialization and persistence are bounded.
const BLOCK_SERIALIZE_DEBOUNCE_MS = 300

// Images are uploaded to Vercel Blob storage to avoid base64 bloat in documents.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_IMAGE_DIMENSION = 2048
const IMAGE_QUALITY = 0.85

async function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')

    img.onload = () => {
      let { width, height } = img

      // Scale down if image is too large
      if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
        const ratio = Math.min(MAX_IMAGE_DIMENSION / width, MAX_IMAGE_DIMENSION / height)
        width = Math.round(width * ratio)
        height = Math.round(height * ratio)
      }

      canvas.width = width
      canvas.height = height

      ctx.drawImage(img, 0, 0, width, height)

      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(new File([blob], file.name, { type: file.type }))
          } else {
            reject(new Error('Image compression failed'))
          }
        },
        file.type,
        IMAGE_QUALITY,
      )
    }

    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = URL.createObjectURL(file)
  })
}

async function uploadFileToBlob(file) {
  // Compress image before upload
  const compressedFile = await compressImage(file)

  const formData = new FormData()
  formData.append('image', compressedFile)

  const response = await fetch('/api/upload-image', {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Upload failed')
  }

  const data = await response.json()
  return data.url
}

const imageUploader = {
  async uploadByFile(file) {
    try {
      if (file.size > MAX_IMAGE_BYTES) {
        inbox.notify('Image is too large — pick a file under 5MB.', 'error')
        throw new Error('File too large')
      }

      const url = await uploadFileToBlob(file)
      return { success: 1, file: { url } }
    } catch (error) {
      console.error('Image upload failed, falling back to base64:', error)
      // Fallback to base64 if blob upload fails
      try {
        const base64Url = await new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = (event) => resolve(event.target.result)
          reader.onerror = (err) => reject(err)
          reader.readAsDataURL(file)
        })
        inbox.notify('Using base64 encoding for this image.', 'info')
        return { success: 1, file: { url: base64Url } }
      } catch (fallbackError) {
        console.error('Base64 fallback also failed:', fallbackError)
        inbox.notify('Failed to process image. Please try again.', 'error')
        throw fallbackError
      }
    }
  },
  uploadByUrl(url) {
    return Promise.resolve({ success: 1, file: { url } })
  },
}

async function readBlocks(target = editor) {
  if (!target) return []
  await target.isReady
  const output = await target.save()
  // The Date tool is transient — it swaps itself for a paragraph. Should a
  // save catch it mid-swap, persisting it would re-run its replacement on
  // every future load, so it never reaches storage.
  return output.blocks.filter((block) => block.type !== 'date')
}

async function serializeAndEmitBlocks() {
  if (!editor) return
  const activeEditor = editor
  const documentId = props.doc.id
  try {
    const blocks = await readBlocks(activeEditor)
    emit('save', { id: documentId, blocks })
  } catch (error) {
    console.error('Reading editor content failed:', error)
  }
}

const blockSaveScheduler = createDocumentSaveScheduler(
  serializeAndEmitBlocks,
  BLOCK_SERIALIZE_DEBOUNCE_MS,
)

function scheduleBlocksSave() {
  blockSaveScheduler.schedule()
}

function flushPendingBlocks() {
  return blockSaveScheduler.flush()
}

async function snapshot() {
  await flushPendingBlocks()
  return {
    title: titleEl.value?.textContent ?? '',
    // A caller can click Save in the same task that Editor.js observes a DOM
    // mutation. Read the editor directly here so an explicit snapshot never
    // returns the cached pre-edit blocks before onChange has scheduled work.
    blocks: await readBlocks(),
  }
}

defineExpose({ flushPendingBlocks, snapshot })

function mountEditor() {
  // The title is contenteditable, so it is filled imperatively — a template
  // text binding would re-render on the store's own save echo and throw the
  // caret back to the start mid-typing.
  if (titleEl.value) titleEl.value.textContent = props.doc.title ?? ''
  tags.value = [...(props.doc.tags ?? [])]
  tagDraft.value = ''
  editor?.destroy?.()
  // Pinia wraps document rows in reactive proxies. Editor.js tools may clone
  // their input internally, and structuredClone cannot copy a Vue Proxy, so
  // hand the editor a plain JSON snapshot of the persisted block data.
  const blocks = Array.isArray(props.doc.blocks) ? JSON.parse(JSON.stringify(props.doc.blocks)) : []
  editor = new EditorJS({
    holder: holder.value,
    data: { blocks },
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
      excalidraw: { class: ExcalidrawBlockTool, config: { onChange: scheduleBlocksSave } },
      image: { class: ImageTool, config: { uploader: imageUploader } },
      kanban: KanbanBlockTool,
    },
    onChange: () => {
      scheduleBlocksSave()
      if (props.isDailyNote) highlightScheduleLines(holder.value)
    },
    onReady: () => {
      new DragDrop(editor)
      if (props.isDailyNote) highlightScheduleLines(holder.value)
    },
  })
}

onMounted(mountEditor)
onBeforeUnmount(() => {
  const activeEditor = editor
  const pendingFlush = flushPendingBlocks()
  Promise.resolve(pendingFlush).finally(() => {
    blockSaveScheduler.cancel()
    activeEditor?.destroy?.()
  })
  editor = null
})

// Switching to another document rebuilds the instance; Editor.js has no
// cheap "replace all content" path that keeps tool state consistent.
watch(
  () => props.doc.id,
  () => mountEditor(),
)

function onTitleInput(event) {
  emit('save', { id: props.doc.id, title: event.target.textContent ?? '' })
}

function addTag() {
  const tag = normalizeDocumentTag(tagDraft.value)
  if (!tag) {
    inbox.notify('Use letters, numbers, hyphens, or underscores for document tags.', 'error')
    return
  }
  if (tags.value.includes(tag)) {
    tagDraft.value = ''
    return
  }
  if (tags.value.length >= MAX_DOCUMENT_TAGS) {
    inbox.notify(`Documents can have up to ${MAX_DOCUMENT_TAGS} tags.`, 'error')
    return
  }
  tagDraft.value = ''
  tags.value = [...tags.value, tag]
  emit('save', { id: props.doc.id, tags: tags.value })
}

function removeTag(tag) {
  tags.value = tags.value.filter((candidate) => candidate !== tag)
  emit('save', { id: props.doc.id, tags: tags.value })
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
  <div class="document-editor" :class="{ compact }">
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
    <div v-if="!compact" class="document-tags" aria-label="Document tags">
      <button
        v-for="tag in tags"
        :key="tag"
        type="button"
        class="document-tag"
        :aria-label="`Remove #${tag}`"
        @click="removeTag(tag)"
      >
        <span>#{{ tag }}</span>
        <span class="material-symbols-outlined" aria-hidden="true">close</span>
      </button>
      <form class="document-tag-form" @submit.prevent="addTag">
        <input
          v-model="tagDraft"
          type="text"
          maxlength="41"
          autocomplete="off"
          aria-label="Add document tag"
          placeholder="#tag"
        />
        <button type="submit" :disabled="!tagDraft.trim()" aria-label="Add tag">
          <span class="material-symbols-outlined" aria-hidden="true">add</span>
        </button>
      </form>
    </div>
    <div ref="holder" class="document-blocks"></div>
  </div>
</template>

<style scoped>
.document-editor {
  width: 100%;
  max-width: none;
  box-sizing: border-box;
  margin: 0 auto;
  padding: 40px 24px 120px;
}

.document-title {
  max-width: 720px;
  margin-right: auto;
  margin-left: auto;
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

.document-tags {
  max-width: 720px;
  margin-right: auto;
  margin-left: auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  margin-bottom: 8px;
}

.document-tag,
.document-tag-form {
  display: inline-flex;
  align-items: center;
  height: 26px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--text-secondary);
  font: inherit;
  font-size: 12px;
}

.document-tag {
  gap: 3px;
  padding: 0 6px 0 8px;
  cursor: pointer;
}

.document-tag:hover,
.document-tag:focus-visible {
  border-color: var(--accent);
  color: var(--text-primary);
}

.document-tag .material-symbols-outlined {
  font-size: 13px;
}

.document-tag-form {
  overflow: hidden;
  background: transparent;
}

.document-tag-form input {
  width: 74px;
  height: 100%;
  padding: 0 0 0 8px;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
}

.document-tag-form button {
  display: grid;
  place-items: center;
  width: 26px;
  height: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.document-tag-form button:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.document-tag-form button:disabled {
  cursor: default;
  opacity: 0.4;
}

.document-tag-form .material-symbols-outlined {
  font-size: 16px;
}

.document-editor.compact {
  max-width: none;
  padding: 8px 18px 28px;
}

.document-editor.compact .document-title {
  max-width: none;
  font-size: 24px;
}

.document-editor.compact .document-blocks :deep(.codex-editor__redactor) {
  min-height: 180px;
  padding-bottom: 32px !important;
}

/* Editor.js paints for a light page by default; pull its chrome onto the
   app's theme tokens so it follows dark mode too. */
.document-blocks :deep(.ce-block__content),
.document-blocks :deep(.ce-toolbar__content) {
  max-width: 720px;
}

.document-blocks :deep(.ce-block--stretched .ce-block__content) {
  max-width: none;
}

.document-editor.compact .document-blocks :deep(.ce-block__content),
.document-editor.compact .document-blocks :deep(.ce-toolbar__content) {
  max-width: 100%;
}

.document-blocks :deep(.codex-editor__redactor) {
  padding-bottom: 120px !important;
}

.document-blocks :deep(.ce-paragraph[data-placeholder]:empty::before) {
  color: var(--text-secondary);
}

/* A line synced into a real calendar event (see documentScheduleHighlight.js
   and api/_lib/dailyEventSync.js) - only ever applied on Daily notes. */
.document-blocks :deep(.is-schedule-line) {
  font-family: var(--font-mono);
  color: var(--schedule-line);
}

/* A checklist item's checkbox rounds into a circle once its line syncs to a
   calendar event, so it reads as "this is an event", not a plain to-do
   (which stays the tool's default square). Unordered/ordered list items
   have no checkbox at all, so this never applies to them. */
.document-blocks :deep(.is-schedule-checkbox) {
  border-radius: 50% !important;
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

.document-blocks :deep(.excalidraw-block) {
  width: 100%;
  margin: 12px 0;
}

.document-blocks :deep(.excalidraw-block__canvas),
.document-blocks :deep(.excalidraw-block__loading) {
  width: 100%;
  height: 420px;
  overflow: hidden;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-card);
}

.document-blocks :deep(.excalidraw-block__loading) {
  display: grid;
  place-items: center;
  color: var(--text-secondary);
  font-size: 13px;
}

.document-blocks :deep(.excalidraw-block__loading.error) {
  color: var(--danger, #e5484d);
}

.document-blocks :deep(.excalidraw-block .excalidraw) {
  --color-primary: var(--accent);
  --color-primary-darker: var(--accent-hover);
  font-family: var(--font-family);
}

.document-editor.compact .document-blocks :deep(.excalidraw-block__canvas),
.document-editor.compact .document-blocks :deep(.excalidraw-block__loading) {
  height: 320px;
}

@media (max-width: 760px) {
  .document-blocks :deep(.excalidraw-block) {
    width: calc(100% + 48px);
    margin-left: -24px;
  }

  .document-blocks :deep(.excalidraw-block__canvas),
  .document-blocks :deep(.excalidraw-block__loading) {
    height: 360px;
  }
}

.document-blocks :deep(.kanban-block) {
  display: block;
  margin: 12px 0;
}

.document-blocks :deep(.kanban-board) {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  overflow-x: auto;
  padding-bottom: 4px;
}

.document-blocks :deep(.kanban-lane) {
  display: flex;
  flex-direction: column;
  flex: 0 0 240px;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-card);
}

.document-blocks :deep(.kanban-lane__header) {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}

.document-blocks :deep(.kanban-lane__title) {
  flex: 1;
  min-width: 0;
  font-weight: 600;
  font-size: 13px;
  color: var(--text-primary);
  outline: none;
  overflow-wrap: break-word;
}

.document-blocks :deep(.kanban-lane__tasks) {
  display: flex;
  flex-direction: column;
  gap: 8px;
  /* A non-zero floor even with zero tasks, so an empty lane still has a
     droppable area rather than collapsing to a sliver between the lane
     title and the "+ Add task" button. */
  min-height: 20px;
}

.document-blocks :deep(.kanban-task) {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-input);
  cursor: grab;
}

.document-blocks :deep(.kanban-task--dragging) {
  opacity: 0.4;
}

.document-blocks :deep(.kanban-drop-indicator) {
  height: 3px;
  border-radius: 2px;
  background: var(--accent);
  flex: 0 0 auto;
}

.document-blocks :deep(.kanban-task__header) {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}

.document-blocks :deep(.kanban-task__title) {
  flex: 1;
  min-width: 0;
  font-weight: 500;
  font-size: 13px;
  color: var(--text-primary);
  outline: none;
  overflow-wrap: break-word;
  /* Overrides the card's own grab cursor - editing text here shouldn't
     look like it's about to start a drag. */
  cursor: text;
}

.document-blocks :deep(.kanban-task__description) {
  font-size: 12px;
  color: var(--text-secondary);
  outline: none;
  overflow-wrap: break-word;
  white-space: pre-wrap;
  cursor: text;
}

.document-blocks :deep(.kanban-lane__title[data-placeholder]:empty::before),
.document-blocks :deep(.kanban-task__title[data-placeholder]:empty::before),
.document-blocks :deep(.kanban-task__description[data-placeholder]:empty::before) {
  content: attr(data-placeholder);
  color: var(--text-secondary);
  opacity: 0.5;
}

.document-blocks :deep(.kanban-lane__delete),
.document-blocks :deep(.kanban-task__delete) {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.document-blocks :deep(.kanban-lane__delete:hover),
.document-blocks :deep(.kanban-task__delete:hover) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.document-blocks :deep(.kanban-lane__add-task),
.document-blocks :deep(.kanban-board__add-lane) {
  align-self: flex-start;
  padding: 4px 8px;
  border: 1px dashed var(--border-color);
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
}

.document-blocks :deep(.kanban-lane__add-task) {
  align-self: stretch;
  text-align: left;
}

.document-blocks :deep(.kanban-board__add-lane) {
  margin-top: 8px;
}

.document-blocks :deep(.kanban-lane__add-task:hover),
.document-blocks :deep(.kanban-board__add-lane:hover) {
  border-color: var(--accent);
  color: var(--text-primary);
}
</style>
