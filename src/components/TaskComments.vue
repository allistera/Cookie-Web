<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

import { fileIcon, formatBytes, isPreviewable } from '../lib/documentFiles'
import {
  canRemoveAttachment,
  canSubmitComment,
  commentAuthorLabel,
  commentDraftProblem,
  formatCommentTime,
} from '../lib/taskComments'
import { useTaskCommentsStore } from '../stores/taskComments'

// The discussion thread under a task in the detail panel: entries oldest
// first, each with text, an attachment, or both, and a composer at the foot.
// The panel is keyed by task id, so this mounts afresh per task; the thread
// itself lives in the store and survives the panel closing.
const props = defineProps({ taskId: { type: String, required: true } })

const store = useTaskCommentsStore()
const thread = computed(() => store.thread(props.taskId))

watch(
  () => props.taskId,
  (taskId) => void store.loadThread(taskId),
  { immediate: true },
)

// ---- composer -------------------------------------------------------------

const draft = ref('')
const draftFile = ref(null)
const fileInput = ref(null)
const sending = ref(false)
const draftProblem = computed(() =>
  commentDraftProblem({ body: draft.value, file: draftFile.value }),
)
const canSend = computed(
  () =>
    !sending.value &&
    !draftProblem.value &&
    canSubmitComment({ body: draft.value, file: draftFile.value }),
)

// Textareas grow with the draft up to a few lines, as the description does.
const draftRows = computed(() => Math.min(6, Math.max(2, draft.value.split('\n').length)))

function chooseFile() {
  fileInput.value?.click()
}

function onFileChosen(event) {
  const [file] = event.target.files ?? []
  draftFile.value = file ?? null
  // Reset so choosing the same file again after removing it fires change.
  event.target.value = ''
}

function dropDraftFile() {
  draftFile.value = null
}

async function send() {
  if (!canSend.value) return
  sending.value = true
  try {
    const comment = await store.addComment(props.taskId, {
      body: draft.value,
      file: draftFile.value,
    })
    if (comment) {
      draft.value = ''
      draftFile.value = null
      await nextTick()
      scrollToEnd()
    }
  } finally {
    sending.value = false
  }
}

// Enter sends; Shift+Enter makes a newline, as the Document AI composer does.
function onDraftKeydown(event) {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
  event.preventDefault()
  void send()
}

const list = ref(null)
function scrollToEnd() {
  const element = list.value
  if (element) element.scrollTop = element.scrollHeight
}

// ---- editing an entry -----------------------------------------------------

const editingId = ref(null)
const editDraft = ref('')
const editInput = ref(null)
const editRows = computed(() => Math.min(8, Math.max(2, editDraft.value.split('\n').length)))

async function startEdit(comment) {
  editingId.value = comment.id
  editDraft.value = comment.body ?? ''
  await nextTick()
  editInput.value?.focus()
  editInput.value?.setSelectionRange?.(editDraft.value.length, editDraft.value.length)
}

function cancelEdit() {
  editingId.value = null
}

async function saveEdit(comment) {
  if (editingId.value !== comment.id) return
  const body = editDraft.value.trim()
  if (body === (comment.body ?? '')) return cancelEdit()
  // An entry that only has text cannot be emptied; the server would refuse
  // it, and Delete is the way to take the entry away.
  if (!body && !comment.attachment) return
  const saved = await store.editComment(props.taskId, comment.id, body)
  if (saved) editingId.value = null
}

function onEditKeydown(event, comment) {
  if (event.key === 'Escape') {
    event.stopPropagation()
    cancelEdit()
  } else if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    void saveEdit(comment)
  }
}

// ---- attachments and removal ----------------------------------------------

async function remove(comment) {
  const what = comment.body?.trim()
    ? 'this comment'
    : `the attachment "${comment.attachment?.name ?? ''}"`
  if (!confirm(`Delete ${what}?`)) return
  if (editingId.value === comment.id) cancelEdit()
  await store.deleteComment(props.taskId, comment.id)
}

async function removeAttachment(comment) {
  if (!confirm(`Remove "${comment.attachment?.name ?? 'the attachment'}" from this comment?`)) {
    return
  }
  await store.removeAttachment(props.taskId, comment.id)
}

// Object URLs handed to a new tab are released a minute later, long after
// the tab has read them; a download's goes as soon as the click has fired.
const objectUrls = new Set()
function releaseLater(url, delay) {
  objectUrls.add(url)
  setTimeout(() => {
    URL.revokeObjectURL(url)
    objectUrls.delete(url)
  }, delay)
}
onBeforeUnmount(() => {
  for (const url of objectUrls) URL.revokeObjectURL(url)
  objectUrls.clear()
})

const openingIds = ref([])
async function openAttachment(comment) {
  if (openingIds.value.includes(comment.id)) return
  openingIds.value = [...openingIds.value, comment.id]
  try {
    const blob = await store.fetchAttachmentBlob(comment.id)
    const url = URL.createObjectURL(blob)
    if (isPreviewable(comment.attachment?.mimeType)) {
      window.open(url, '_blank', 'noopener')
      releaseLater(url, 60_000)
    } else {
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = comment.attachment?.name ?? 'attachment'
      anchor.click()
      releaseLater(url, 1000)
    }
  } catch (error) {
    store.notify(error.message || 'Download failed.', 'error')
  } finally {
    openingIds.value = openingIds.value.filter((id) => id !== comment.id)
  }
}

function isBusy(comment) {
  return store.busyIds.includes(comment.id)
}
</script>

<template>
  <section class="task-comments" aria-label="Comments" data-testid="task-comments">
    <header class="task-comments-header">
      <span class="task-comments-title">Comments</span>
      <span v-if="thread.loaded" class="task-comments-count">{{ thread.comments.length }}</span>
    </header>

    <p v-if="thread.error" class="task-comments-status" role="alert">
      {{ thread.error }}
      <button
        type="button"
        class="task-comments-link"
        @click="store.loadThread(taskId, { force: true })"
      >
        Retry
      </button>
    </p>
    <p v-else-if="!thread.loaded" class="task-comments-status" role="status">Loading comments…</p>
    <p v-else-if="!thread.comments.length" class="task-comments-status task-comments-empty">
      No comments yet.
    </p>

    <ol v-if="thread.comments.length" ref="list" class="task-comment-rows">
      <li
        v-for="comment in thread.comments"
        :key="comment.id"
        class="task-comment"
        :data-comment-id="comment.id"
      >
        <div class="task-comment-meta">
          <span class="task-comment-author">{{ commentAuthorLabel(comment) }}</span>
          <time class="task-comment-time" :datetime="comment.createdAt">
            {{ formatCommentTime(comment.createdAt) }}
          </time>
          <span v-if="comment.editedAt" class="task-comment-edited">(edited)</span>
          <span v-if="comment.mine && editingId !== comment.id" class="task-comment-actions">
            <button
              v-if="comment.body?.trim() || comment.attachment"
              type="button"
              class="task-comment-action"
              title="Edit comment"
              :aria-label="`Edit comment from ${formatCommentTime(comment.createdAt)}`"
              :disabled="isBusy(comment)"
              @click="startEdit(comment)"
            >
              <span class="material-symbols-outlined" aria-hidden="true">edit</span>
            </button>
            <button
              type="button"
              class="task-comment-action"
              title="Delete comment"
              :aria-label="`Delete comment from ${formatCommentTime(comment.createdAt)}`"
              :disabled="isBusy(comment)"
              @click="remove(comment)"
            >
              <span class="material-symbols-outlined" aria-hidden="true">delete</span>
            </button>
          </span>
        </div>

        <form
          v-if="editingId === comment.id"
          class="task-comment-edit"
          @submit.prevent="saveEdit(comment)"
        >
          <textarea
            :ref="(el) => (editInput = el)"
            v-model="editDraft"
            class="task-comment-input"
            aria-label="Edit comment"
            :rows="editRows"
            :disabled="isBusy(comment)"
            @keydown="onEditKeydown($event, comment)"
          ></textarea>
          <div class="task-comment-edit-actions">
            <button type="submit" class="task-comments-button" :disabled="isBusy(comment)">
              Save
            </button>
            <button type="button" class="task-comments-link" @click="cancelEdit()">Cancel</button>
          </div>
        </form>
        <p v-else-if="comment.body" class="task-comment-body">{{ comment.body }}</p>

        <div v-if="comment.attachment" class="task-comment-attachment">
          <button
            type="button"
            class="task-comment-file"
            :title="`Open ${comment.attachment.name}`"
            :disabled="openingIds.includes(comment.id)"
            @click="openAttachment(comment)"
          >
            <span class="material-symbols-outlined" aria-hidden="true">
              {{ fileIcon(comment.attachment.mimeType) }}
            </span>
            <span class="task-comment-file-name">{{ comment.attachment.name }}</span>
            <span class="task-comment-file-size">{{
              formatBytes(comment.attachment.sizeBytes)
            }}</span>
          </button>
          <button
            v-if="canRemoveAttachment(comment)"
            type="button"
            class="task-comment-action"
            title="Remove attachment"
            :aria-label="`Remove attachment ${comment.attachment.name}`"
            :disabled="isBusy(comment)"
            @click="removeAttachment(comment)"
          >
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>
      </li>
    </ol>

    <button
      v-if="thread.nextCursor"
      type="button"
      class="task-comments-link task-comments-more"
      :disabled="thread.loading"
      @click="store.loadThread(taskId, { more: true })"
    >
      More comments
    </button>

    <form class="task-comment-composer" @submit.prevent="send()">
      <textarea
        v-model="draft"
        class="task-comment-input"
        placeholder="Write a comment…"
        aria-label="Write a comment"
        :rows="draftRows"
        :disabled="sending"
        @keydown="onDraftKeydown"
      ></textarea>
      <div v-if="draftFile" class="task-comment-draft-file">
        <span class="material-symbols-outlined" aria-hidden="true">{{
          fileIcon(draftFile.type)
        }}</span>
        <span class="task-comment-file-name">{{ draftFile.name }}</span>
        <span class="task-comment-file-size">{{ formatBytes(draftFile.size) }}</span>
        <button
          type="button"
          class="task-comment-action"
          title="Remove file"
          aria-label="Remove chosen file"
          @click="dropDraftFile()"
        >
          <span class="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      </div>
      <p v-if="draftProblem" class="task-comment-problem" role="alert">{{ draftProblem }}</p>
      <div class="task-comment-composer-actions">
        <input
          ref="fileInput"
          type="file"
          class="task-comment-file-input"
          aria-label="Attach a file"
          @change="onFileChosen"
        />
        <button
          type="button"
          class="task-comments-link task-comment-attach"
          :disabled="sending"
          @click="chooseFile()"
        >
          <span class="material-symbols-outlined" aria-hidden="true">attach_file</span>
          Attach file
        </button>
        <button type="submit" class="task-comments-button" :disabled="!canSend">
          <span class="material-symbols-outlined" aria-hidden="true">send</span>
          {{ sending ? 'Sending…' : 'Comment' }}
        </button>
      </div>
    </form>
  </section>
</template>

<style scoped>
.task-comments {
  margin: 22px 0 0 32px;
}

.task-comments-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-color);
  font-size: 14px;
  font-weight: 600;
}

.task-comments-count {
  color: var(--text-secondary);
  font-weight: 400;
}

.task-comments-status {
  margin: 10px 0 0;
  font-size: 14px;
  color: var(--text-secondary);
}

.task-comment-rows {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 360px;
  overflow-y: auto;
}

.task-comment {
  padding: 10px 0;
  border-bottom: 1px solid var(--border-color);
}

.task-comment-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-secondary);
}

.task-comment-author {
  color: var(--text-primary);
  font-weight: 600;
}

.task-comment-actions {
  display: flex;
  gap: 2px;
  margin-left: auto;
  opacity: 0;
}

.task-comment:hover .task-comment-actions,
.task-comment:focus-within .task-comment-actions {
  opacity: 1;
}

.task-comment-action {
  display: flex;
  align-items: center;
  padding: 2px;
  border: none;
  border-radius: 4px;
  background: none;
  color: var(--text-secondary);
  cursor: pointer;
}

.task-comment-action:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.task-comment-action:disabled {
  opacity: 0.35;
  cursor: default;
}

.task-comment-action .material-symbols-outlined {
  font-size: 18px;
}

.task-comment-body {
  margin: 6px 0 0;
  font-size: 14px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.task-comment-attachment,
.task-comment-draft-file {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
}

.task-comment-file {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 4px 10px 4px 6px;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  background: var(--bg-app);
  color: inherit;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.task-comment-file:hover:not(:disabled) {
  background: var(--bg-hover);
}

.task-comment-file:disabled {
  opacity: 0.6;
  cursor: progress;
}

.task-comment-file .material-symbols-outlined,
.task-comment-draft-file .material-symbols-outlined {
  font-size: 18px;
  color: var(--text-secondary);
}

.task-comment-file-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-comment-file-size {
  color: var(--text-secondary);
  white-space: nowrap;
}

.task-comment-draft-file {
  font-size: 13px;
}

.task-comment-edit,
.task-comment-composer {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}

.task-comment-composer {
  margin-top: 12px;
}

.task-comment-input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  font: inherit;
  font-size: 14px;
  line-height: 1.5;
  color: inherit;
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  resize: vertical;
}

.task-comment-input:focus {
  outline: none;
  border-color: var(--text-secondary);
}

.task-comment-edit-actions,
.task-comment-composer-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.task-comment-composer-actions .task-comments-button {
  margin-left: auto;
}

.task-comment-file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.task-comments-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  color: var(--bg-dialog);
  background: var(--text-primary);
  border: none;
  border-radius: 6px;
  cursor: pointer;
}

.task-comments-button:disabled {
  opacity: 0.4;
  cursor: default;
}

.task-comments-button .material-symbols-outlined {
  font-size: 16px;
}

.task-comments-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 0;
  border: none;
  background: none;
  color: var(--text-secondary);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.task-comments-link:hover:not(:disabled) {
  color: var(--text-primary);
}

.task-comments-link:disabled {
  opacity: 0.5;
  cursor: default;
}

.task-comments-link .material-symbols-outlined {
  font-size: 18px;
}

.task-comments-more {
  margin-top: 4px;
}

.task-comment-problem {
  margin: 0;
  font-size: 13px;
  color: var(--danger, #e5484d);
}
</style>
