<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

import EmojiPicker from './EmojiPicker.vue'
import { fileIcon, formatBytes, isPreviewable } from '../lib/documentFiles'
import { userInitial } from '../lib/taskDetail'
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
// itself lives in the store and survives the panel closing. The panel owns
// the "Comments" tab and its count; this renders only the thread.
//
// `authorName` is how the person's own entries are signed (and the letter
// on their avatar); without it they read as "You".
const props = defineProps({
  taskId: { type: String, required: true },
  authorName: { type: String, default: '' },
})

const store = useTaskCommentsStore()
const thread = computed(() => store.thread(props.taskId))

// A thread already loaded stays on screen while the first page is read
// again, so an entry added or removed elsewhere since shows up.
watch(
  () => props.taskId,
  (taskId) => void store.loadThread(taskId, { force: true }),
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
const draftRows = computed(() => Math.min(6, Math.max(1, draft.value.split('\n').length)))
const draftInput = ref(null)

// An emoji lands at the caret (or at the end when the field has not been
// focused yet) and the caret moves past it.
function insertEmoji(char) {
  const field = draftInput.value
  const at = field?.selectionStart ?? draft.value.length
  const to = field?.selectionEnd ?? at
  draft.value = draft.value.slice(0, at) + char + draft.value.slice(to)
  void nextTick(() => {
    field?.focus()
    field?.setSelectionRange?.(at + char.length, at + char.length)
  })
}

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
  // Only this edit closes; one cancelled and replaced by another entry's
  // edit while the save was in flight leaves that newer draft alone.
  if (saved && editingId.value === comment.id) editingId.value = null
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
  // A preview's tab is opened while the click is still the active gesture;
  // opened after the fetch it would be a pop-up and blocked. The bytes are
  // pointed at it once they arrive. A blocked tab (null) falls back to a
  // download, which needs no gesture.
  const preview = isPreviewable(comment.attachment?.mimeType)
  const tab = preview ? window.open('about:blank', '_blank') : null
  if (tab) tab.opener = null
  try {
    const blob = await store.fetchAttachmentBlob(comment.id)
    const url = URL.createObjectURL(blob)
    if (tab && !tab.closed) {
      tab.location.href = url
      releaseLater(url, 60_000)
    } else {
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = comment.attachment?.name ?? 'attachment'
      anchor.click()
      releaseLater(url, 1000)
    }
  } catch (error) {
    tab?.close()
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
        <span class="task-comment-avatar" aria-hidden="true">
          {{ comment.mine ? userInitial(authorName) : 'C' }}
        </span>
        <div class="task-comment-entry">
          <div class="task-comment-meta">
            <span class="task-comment-author">{{ commentAuthorLabel(comment, authorName) }}</span>
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
              class="task-comment-input task-comment-edit-input"
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
      <span class="task-comment-avatar" aria-hidden="true">{{ userInitial(authorName) }}</span>
      <div class="task-comment-composer-box" :class="{ sending }">
        <textarea
          ref="draftInput"
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
            class="task-comment-tool task-comment-attach"
            title="Attach file"
            aria-label="Attach file"
            :disabled="sending"
            @click="chooseFile()"
          >
            <span class="material-symbols-outlined" aria-hidden="true">attach_file</span>
          </button>
          <EmojiPicker label="Add emoji" :disabled="sending" @select="insertEmoji" />
          <button
            type="submit"
            class="task-comment-send"
            title="Comment"
            :aria-label="sending ? 'Sending comment' : 'Comment'"
            :disabled="!canSend"
          >
            <span class="material-symbols-outlined" aria-hidden="true">arrow_upward</span>
          </button>
        </div>
      </div>
    </form>
  </section>
</template>

<style scoped>
.task-comments {
  margin: 0;
}

.task-comments-status {
  margin: 12px 0 0;
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
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 0;
}

.task-comment + .task-comment {
  border-top: 1px solid var(--border-color);
}

/* The avatar is the person's initial on the accent disc the rest of the app
   signs them with; a collaborator's is a plain grey disc. */
.task-comment-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--accent);
  color: white;
  font-size: 14px;
  font-weight: 700;
}

.task-comment-entry {
  flex: 1;
  min-width: 0;
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
  margin: 4px 0 0;
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
  padding: 0 10px;
}

.task-comment-edit {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}

/* The composer is one rounded box: the field, then its tools in a row with
   the send button at the end, beside the person's avatar. */
.task-comment-composer {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-top: 16px;
}

.task-comment-composer-box {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background: var(--bg-dialog);
}

.task-comment-composer-box:focus-within {
  border-color: var(--text-secondary);
}

.task-comment-composer-box.sending {
  opacity: 0.7;
}

.task-comment-input {
  width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  font: inherit;
  font-size: 14px;
  line-height: 1.5;
  color: inherit;
  background: transparent;
  border: none;
  border-radius: 12px;
  resize: none;
  outline: none;
}

.task-comment-edit-input {
  border: 1px solid var(--border-color);
  border-radius: 8px;
  resize: vertical;
}

.task-comment-edit-input:focus {
  border-color: var(--text-secondary);
}

.task-comment-edit-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.task-comment-composer-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
  padding: 0 6px 6px;
}

.task-comment-tool,
.task-comment-composer-actions :deep(.composer-emoji-btn) {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: none;
  color: var(--text-secondary);
  cursor: pointer;
}

.task-comment-tool:hover:not(:disabled),
.task-comment-composer-actions :deep(.composer-emoji-btn:hover:not(:disabled)) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.task-comment-tool:disabled {
  opacity: 0.5;
  cursor: default;
}

.task-comment-tool .material-symbols-outlined,
.task-comment-composer-actions :deep(.composer-emoji-btn .material-symbols-outlined) {
  font-size: 20px;
}

.task-comment-send {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  margin-left: 6px;
  padding: 0;
  border: none;
  border-radius: 10px;
  background: var(--accent);
  color: white;
  cursor: pointer;
}

.task-comment-send:hover:not(:disabled) {
  background: var(--accent-hover);
}

.task-comment-send:disabled {
  opacity: 0.4;
  cursor: default;
}

.task-comment-send .material-symbols-outlined {
  font-size: 20px;
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

.task-comments-more {
  margin-top: 4px;
}

.task-comment-problem {
  margin: 0;
  padding: 0 12px;
  font-size: 13px;
  color: var(--danger, #e5484d);
}
</style>
