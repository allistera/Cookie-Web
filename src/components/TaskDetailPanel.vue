<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import TaskComments from './TaskComments.vue'
import TaskHistory from './TaskHistory.vue'
import TaskLabelPicker from './TaskLabelPicker.vue'
import TaskProjectPicker from './TaskProjectPicker.vue'
import TaskRepeatInput from './TaskRepeatInput.vue'
import { useAuth } from '../composables/useAuth'
import { useBucketCandidate } from '../composables/useBucketCandidate'
import { useInlineEdit } from '../composables/useInlineEdit'
import { taskBucketItem } from '../lib/bucketItems'
import {
  formatAddedStamp,
  shortUserName,
  SUBTASK_ORDERS,
  sortSubtasks,
  taskAsText,
  taskSiblings,
} from '../lib/taskDetail'
import { applyMarkdownFormat, MARKDOWN_FORMATS, renderTaskMarkdown } from '../lib/taskMarkdown'
import { PRIORITIES, priorityInfo, priorityOf } from '../lib/taskPriority'
import { useProjectsStore } from '../stores/projects'
import { useTaskCommentsStore } from '../stores/taskComments'
import { useTaskItemsStore } from '../stores/taskItems'

const props = defineProps({ taskId: { type: String, required: true } })

const route = useRoute()
const router = useRouter()
const items = useTaskItemsStore()
const projects = useProjectsStore()
const comments = useTaskCommentsStore()

// Who the panel signs things as: the footer's "by …" and the comments'
// author. A session without a name (or a test without a provider) leaves
// it blank and the thread falls back to "You".
const auth = useAuth()
const userName = computed(() => shortUserName(auth?.user?.value?.name))

const item = computed(() => items.itemById(props.taskId))
watch(
  () => [props.taskId, items.isLoading],
  () => {
    if (!items.isLoading && (!item.value || item.value.summary)) void items.loadDetail(props.taskId)
  },
  { immediate: true },
)
const recurrenceDraft = ref('')
const savingRecurrence = ref(false)
watch(
  () => [props.taskId, item.value?.recurrence],
  () => {
    recurrenceDraft.value = item.value?.recurrence ?? ''
  },
  { immediate: true },
)
async function saveRecurrence() {
  if (savingRecurrence.value) return
  savingRecurrence.value = true
  try {
    const updated = await items.setRecurrence(props.taskId, recurrenceDraft.value.trim() || null)
    if (updated && !item.value) closeIfStillOpen()
  } finally {
    savingRecurrence.value = false
  }
}

// A task with no project is in the Inbox — the same rule the sidebar encodes.
const projectName = computed(() => {
  if (!item.value?.projectId) return 'Inbox'
  return projects.projects.find((row) => row.id === item.value.projectId)?.name ?? 'Inbox'
})

// The open task is what 'b' pins to the bucket.
useBucketCandidate(() => taskBucketItem(item.value, projectName.value))

// The picker hands back a project id, or null for the Inbox, as the wire
// carries it.
const projectPicker = ref(null)

function onProjectChange(projectId) {
  items.moveItem(props.taskId, projectId)
}

// ---- header: siblings, link, size, menu ------------------------------------

// The up and down arrows step through the rows beside this task in the
// loaded list, the way the list itself reads.
const siblings = computed(() => taskSiblings(items.items, item.value))
const siblingIndex = computed(() => siblings.value.findIndex((row) => row.id === props.taskId))
const previousId = computed(() =>
  siblingIndex.value > 0 ? siblings.value[siblingIndex.value - 1].id : null,
)
const nextId = computed(() =>
  siblingIndex.value >= 0 && siblingIndex.value < siblings.value.length - 1
    ? siblings.value[siblingIndex.value + 1].id
    : null,
)

function open(id) {
  if (id) router.push({ path: '/tasks', query: { ...route.query, task: id } })
}

// The task's own address, as the list links it: /tasks?task=<id>.
const taskLink = computed(
  () =>
    new URL(router.resolve({ path: '/tasks', query: { task: props.taskId } }).href, location.href)
      .href,
)

async function copyToClipboard(text, done) {
  try {
    await navigator.clipboard.writeText(text)
    items.notify(done, 'info')
  } catch {
    items.notify('Could not copy to the clipboard.', 'error')
  }
}

function copyLink() {
  return copyToClipboard(taskLink.value, 'Link copied.')
}

function copyAsText() {
  return copyToClipboard(taskAsText(item.value, subtasks.value), 'Task copied as text.')
}

function openInNewWindow() {
  window.open(taskLink.value, '_blank', 'noopener')
}

// Expanded, the panel fills the viewport rather than sitting as a dialog.
const expanded = ref(false)

const menuOpen = ref(false)
const menuRoot = ref(null)
const menuButton = ref(null)
const menu = ref(null)

async function toggleMenu() {
  menuOpen.value = !menuOpen.value
  if (!menuOpen.value) return
  await nextTick()
  menu.value?.querySelector('[role="menuitem"]')?.focus()
}

function closeMenu({ refocus = true } = {}) {
  if (!menuOpen.value) return
  menuOpen.value = false
  if (refocus) menuButton.value?.focus()
}

function runMenuAction(action) {
  closeMenu()
  return action()
}

// A copy of the task beside it: the same fields the server accepts on
// create, filed under the same parent or project.
async function duplicate() {
  const row = item.value
  if (!row) return
  const created = await items.createItem({
    content: row.content,
    projectId: row.projectId ?? null,
    parentId: row.parentId ?? null,
    description: row.description ?? null,
    dueDate: row.dueDate ?? null,
    dueTime: row.dueTime ?? null,
    timeZone: row.timeZone ?? null,
    priority: priorityOf(row),
    labels: row.labels ?? [],
    recurrence: row.recurrence ?? undefined,
  })
  if (created) items.notify('Task duplicated.', 'info')
}

async function moveTo() {
  await nextTick()
  await projectPicker.value?.open()
}

// ---- title and description -------------------------------------------------

const titleEdit = useInlineEdit({
  read: () => item.value?.content ?? '',
  // An empty title is not a rename: leaving edit mode keeps the existing
  // content, which is what Enter on a cleared field should do.
  write: (content) => (content ? items.renameItem(props.taskId, content) : undefined),
})

const descriptionEdit = useInlineEdit({
  read: () => item.value?.description ?? '',
  // An emptied description is a real change: null clears the column.
  write: (description) => items.describeItem(props.taskId, description || null),
  selectAll: false,
})

// Descriptions are multi-line, so Enter makes a newline and only blur (or
// Escape, discarding) leaves the edit. The rows track the draft as a fallback
// for browsers without field-sizing, which otherwise does the growing.
const descriptionRows = computed(() =>
  Math.min(12, Math.max(3, descriptionEdit.draft.value.split('\n').length)),
)

// Read-only, the description is its markdown rendered; the editor is the
// same text with a toolbar that writes the same marks around the selection.
const descriptionHtml = computed(() => renderTaskMarkdown(item.value?.description))

const TOOLBAR = [
  { format: 'heading', text: 'H1' },
  { format: 'bold', icon: 'format_bold' },
  { format: 'italic', icon: 'format_italic' },
  { format: 'strike', icon: 'strikethrough_s' },
  { format: 'link', icon: 'link', group: true },
  { format: 'code', icon: 'code' },
  { format: 'bullet', icon: 'format_list_bulleted' },
  { format: 'numbered', icon: 'format_list_numbered' },
  { format: 'quote', icon: 'format_quote' },
]

// The toolbar's buttons take no focus (mousedown is prevented), so the
// textarea keeps it and its selection is the one the format applies to.
async function applyFormat(format) {
  const field = descriptionEdit.inputRef.value
  if (!field) return
  const next = applyMarkdownFormat(field.value, field.selectionStart, field.selectionEnd, format)
  descriptionEdit.draft.value = next.value
  await nextTick()
  field.focus()
  field.setSelectionRange(next.selectionStart, next.selectionEnd)
}

// ---- sub-tasks --------------------------------------------------------------

// Sub-tasks resolve out of the same loaded list the panel's own task does —
// the list query returns them (completed included) alongside their parent.
const subtasks = computed(() => items.items.filter((row) => row.parentId === props.taskId))
const subtaskOffset = ref(0)
const subtaskOrder = ref('manual')
const hideCompleted = ref(false)
watch(
  () => props.taskId,
  () => {
    subtaskOffset.value = 0
  },
)
// Pages are cut from the list in its own order, and only then sorted or
// filtered: the server hands sub-tasks over a page at a time, so a sort over
// the part already loaded would shuffle rows across the page boundary and
// a later page would repeat some and skip others.
const subtaskPage = computed(() =>
  subtasks.value.slice(subtaskOffset.value, subtaskOffset.value + 100),
)
const visibleSubtasks = computed(() =>
  sortSubtasks(
    hideCompleted.value ? subtaskPage.value.filter((row) => !row.completedAt) : subtaskPage.value,
    subtaskOrder.value,
  ),
)
async function nextSubtaskPage() {
  if (subtaskOffset.value + 100 >= subtasks.value.length)
    await items.loadDetail(props.taskId, { more: true })
  if (subtaskOffset.value + 100 < subtasks.value.length) subtaskOffset.value += 100
}
const doneCount = computed(() => subtasks.value.filter((row) => row.completedAt).length)
const donePercent = computed(() =>
  subtasks.value.length ? Math.round((doneCount.value / subtasks.value.length) * 100) : 0,
)

const addingSubtask = ref(false)
const subtaskDraft = ref('')
const subtaskInput = ref(null)

async function startAddSubtask() {
  subtaskDraft.value = ''
  addingSubtask.value = true
  await nextTick()
  subtaskInput.value?.focus()
}

async function submitSubtask() {
  // Same Enter-then-blur double fire as the title and description edits.
  if (!addingSubtask.value) return
  const content = subtaskDraft.value.trim()
  addingSubtask.value = false
  if (!content) return
  await items.createItem({ content, parentId: props.taskId })
}

// ---- comments and activity ---------------------------------------------------

// The thread stays mounted behind the Activity tab so a half-written
// comment survives a look at the history; activity mounts the first time
// it is opened and stays too, so switching back does not refetch.
const tab = ref('comments')
const activityOpened = ref(false)
watch(tab, (value) => {
  if (value === 'activity') activityOpened.value = true
})

// The thread is read a page at a time, so until the last page is in the
// badge is a lower bound and says so.
const commentCount = computed(() => {
  const thread = comments.thread(props.taskId)
  if (!thread.loaded) return null
  return thread.nextCursor ? `${thread.comments.length}+` : String(thread.comments.length)
})

// ---- schedule -----------------------------------------------------------------

// An empty input means the date was cleared; null is what the server treats
// as "no date", where '' would be refused as malformed.
function onDateChange(event) {
  const value = String(event.target.value ?? '')
  items.setDueDate(props.taskId, value || null)
}

const localTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

function onTimeChange(event) {
  const value = String(event.target.value ?? '')
  items.setDueTime(
    props.taskId,
    value || null,
    value ? item.value?.timeZone || localTimeZone : null,
  )
}

// Labels save on every change: chips have no blur to wait for, and each
// change is one small PATCH the store serialises per task.
const savingLabels = ref(false)
async function onLabelsChange(labels) {
  if (savingLabels.value) return
  savingLabels.value = true
  try {
    await items.setLabels(props.taskId, labels)
  } finally {
    savingLabels.value = false
  }
}

// Priority is four buttons in a row, the current one pressed: every level
// is visible with its coloured flag, so choosing one is a single click.
const priority = computed(() => priorityOf(item.value))

async function choosePriority(value) {
  if (value === priority.value) return
  await items.setPriority(props.taskId, value)
}

const addedStamp = computed(() => formatAddedStamp(item.value?.createdAt))

// A click anywhere else in the panel closes the menu. The dialog stops clicks
// from reaching the backdrop (which would close the whole panel), so this is
// where an "outside" click is seen; a backdrop click closes everything anyway.
function onPanelClick(event) {
  if (!menuOpen.value) return
  if (event.target instanceof Node && menuRoot.value?.contains(event.target)) return
  closeMenu({ refocus: false })
}

// Completing takes the task out of the visible list, so the panel would be
// left pointing at something that is no longer there.
const completing = ref(false)
async function complete() {
  if (completing.value) return
  completing.value = true
  const updated = await items.setCompleted(props.taskId, !item.value?.completedAt)
  if (updated) closeIfStillOpen()
  else completing.value = false
}

// Deleting takes any sub-tasks with it via ON DELETE CASCADE and there is no
// undo endpoint, so it asks first and names what it is about to remove.
async function remove() {
  if (!item.value) return
  if (!confirm(`Delete "${item.value.content}"?`)) return
  const deleted = await items.deleteItem(props.taskId)
  // A failed delete has already notified; stay put rather than close over a
  // task that is still there. The thread went with the task on the server.
  if (deleted) {
    comments.forgetThread(props.taskId)
    closeIfStillOpen()
  }
}

function close() {
  const query = { ...route.query }
  delete query.task
  router.push({ path: '/tasks', query })
}

// The panel is keyed by task id, so by the time a slow request settles the
// person may have opened another task (or left Tasks). Closing then would
// shut that other panel, so only close while this one is still the one shown.
let unmounted = false
function closeIfStillOpen() {
  if (!unmounted && route.query.task === props.taskId) close()
}

// A task id naming nothing in the loaded list is a stale link, a deleted task,
// or one hidden because it is complete. Wait for the load to settle before
// judging, or a panel opened by a deep link closes itself while the list is
// still in flight.
watch(
  () => [items.detailErrors[props.taskId], items.detailLoading[props.taskId]],
  () => {
    if (
      completing.value ||
      savingRecurrence.value ||
      items.isLoading ||
      items.loadedProject === null ||
      item.value ||
      items.detailLoading[props.taskId] ||
      items.detailErrors[props.taskId] !== 'missing'
    )
      return
    items.notify('That task no longer exists.', 'error')
    close()
  },
  { immediate: true },
)

// The panel is aria-modal: Tab and Shift+Tab cycle inside it, and a focus
// that has fallen out of it (an inline edit unmounting, say) comes back in.
const panel = ref(null)
const closeButton = ref(null)

function trapTab(event) {
  const focusable = [
    ...panel.value.querySelectorAll('input, select, textarea, button, [tabindex="0"]'),
  ].filter((element) => !element.disabled)
  const first = focusable[0]
  const last = focusable.at(-1)
  if (!first) return
  const active = document.activeElement
  if (!panel.value.contains(active)) {
    // Only reclaim focus that was lost to the page; focus in another overlay
    // stacked above the panel (such as the command palette) stays there.
    if (active && active !== document.body) return
    event.preventDefault()
    ;(event.shiftKey ? last : first).focus()
  } else if (event.shiftKey && active === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}

function onKeydown(event) {
  if (event.key === 'Tab' && panel.value) return trapTab(event)
  if (event.key !== 'Escape') return
  // Escape with the menu open is asking to leave the menu, not the panel.
  if (menuOpen.value) {
    closeMenu()
    return
  }
  close()
}

// Focus moves into the panel when it opens and returns to whatever opened it
// once it closes.
let opener = null
onMounted(() => {
  opener = document.activeElement
  closeButton.value?.focus()
  document.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  unmounted = true
  document.removeEventListener('keydown', onKeydown)
  if (opener?.isConnected) opener.focus?.()
})
</script>

<template>
  <div class="task-panel-backdrop" :class="{ expanded }" @click="close()">
    <div
      ref="panel"
      class="task-panel"
      :class="{ expanded }"
      role="dialog"
      aria-modal="true"
      :aria-label="item?.content ?? 'Task'"
      @click.stop="onPanelClick($event)"
    >
      <header class="task-panel-header">
        <TaskProjectPicker
          ref="projectPicker"
          :model-value="item?.projectId ?? null"
          :owner-name="userName"
          @update:model-value="onProjectChange"
        />

        <div class="task-panel-actions">
          <button
            class="task-panel-prev"
            type="button"
            title="Previous task"
            aria-label="Previous task"
            :disabled="!previousId"
            @click="open(previousId)"
          >
            <span class="material-symbols-outlined" aria-hidden="true">keyboard_arrow_up</span>
          </button>
          <button
            class="task-panel-next"
            type="button"
            title="Next task"
            aria-label="Next task"
            :disabled="!nextId"
            @click="open(nextId)"
          >
            <span class="material-symbols-outlined" aria-hidden="true">keyboard_arrow_down</span>
          </button>
          <span class="task-panel-actions-divider" aria-hidden="true"></span>
          <button
            class="task-panel-copy-link"
            type="button"
            title="Copy link to task"
            aria-label="Copy link to task"
            @click="copyLink()"
          >
            <span class="material-symbols-outlined" aria-hidden="true">link</span>
          </button>
          <button
            class="task-panel-expand"
            type="button"
            :title="expanded ? 'Shrink' : 'Expand'"
            :aria-label="expanded ? 'Shrink task' : 'Expand task'"
            :aria-pressed="expanded ? 'true' : 'false'"
            @click="expanded = !expanded"
          >
            <span class="material-symbols-outlined" aria-hidden="true">{{
              expanded ? 'close_fullscreen' : 'open_in_full'
            }}</span>
          </button>
          <div ref="menuRoot" class="task-panel-menu-wrap">
            <button
              ref="menuButton"
              class="task-panel-more"
              :class="{ open: menuOpen }"
              type="button"
              title="More actions"
              aria-label="More actions"
              aria-haspopup="menu"
              :aria-expanded="menuOpen ? 'true' : 'false'"
              @click="toggleMenu()"
            >
              <span class="material-symbols-outlined" aria-hidden="true">more_horiz</span>
            </button>
            <div
              v-if="menuOpen"
              ref="menu"
              class="task-panel-menu"
              role="menu"
              aria-label="Task actions"
            >
              <button
                type="button"
                class="task-panel-menu-item task-panel-duplicate"
                role="menuitem"
                @click="runMenuAction(duplicate)"
              >
                <span class="material-symbols-outlined" aria-hidden="true">content_copy</span>
                Duplicate
              </button>
              <button
                type="button"
                class="task-panel-menu-item task-panel-move"
                role="menuitem"
                @click="runMenuAction(moveTo)"
              >
                <span class="material-symbols-outlined" aria-hidden="true">drive_file_move</span>
                Move to…
              </button>
              <button
                type="button"
                class="task-panel-menu-item"
                role="menuitem"
                @click="runMenuAction(copyLink)"
              >
                <span class="material-symbols-outlined" aria-hidden="true">link</span>
                Copy link to task
              </button>
              <button
                type="button"
                class="task-panel-menu-item task-panel-copy-text"
                role="menuitem"
                @click="runMenuAction(copyAsText)"
              >
                <span class="material-symbols-outlined" aria-hidden="true">description</span>
                Copy as text
              </button>
              <hr class="task-panel-menu-rule" role="separator" />
              <button
                type="button"
                class="task-panel-menu-item task-panel-view-activity"
                role="menuitem"
                @click="runMenuAction(() => (tab = 'activity'))"
              >
                <span class="material-symbols-outlined" aria-hidden="true">history</span>
                View activity
              </button>
              <button
                type="button"
                class="task-panel-menu-item"
                role="menuitem"
                @click="runMenuAction(openInNewWindow)"
              >
                <span class="material-symbols-outlined" aria-hidden="true">open_in_new</span>
                Open in new window
              </button>
              <hr class="task-panel-menu-rule" role="separator" />
              <button
                type="button"
                class="task-panel-menu-item task-panel-delete"
                role="menuitem"
                @click="runMenuAction(remove)"
              >
                <span class="material-symbols-outlined" aria-hidden="true">delete</span>
                Delete task
              </button>
            </div>
          </div>
          <button
            ref="closeButton"
            class="task-panel-close"
            type="button"
            title="Close"
            aria-label="Close task"
            @click="close()"
          >
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>
      </header>

      <div v-if="!item || item.summary" class="task-panel-main" role="status">
        <p>{{ items.detailLoading[taskId] ? 'Loading task…' : 'Could not load task details.' }}</p>
        <button v-if="!items.detailLoading[taskId]" @click="items.loadDetail(taskId)">Retry</button>
      </div>
      <div v-else class="task-panel-body">
        <div class="task-panel-main">
          <div class="task-panel-heading">
            <button
              class="task-panel-check"
              type="button"
              :disabled="items.completingIds.includes(taskId)"
              :aria-label="`${item?.completedAt ? 'Reopen' : 'Complete'} ${item?.content ?? 'task'}`"
              :aria-pressed="Boolean(item?.completedAt)"
              @click="complete()"
            >
              <span v-if="item.completedAt" class="material-symbols-outlined" aria-hidden="true"
                >check</span
              >
            </button>
            <input
              v-if="titleEdit.editing.value"
              :ref="(el) => (titleEdit.inputRef.value = el)"
              v-model="titleEdit.draft.value"
              class="task-panel-title-input"
              aria-label="Task title"
              @keydown.enter.prevent="titleEdit.submit"
              @keydown.escape.stop="titleEdit.editing.value = false"
              @blur="titleEdit.submit"
            />
            <h2 v-else class="task-panel-title" @click="titleEdit.start">
              <button type="button" class="inline-edit-trigger" title="Rename task">
                {{ item?.content }}
              </button>
            </h2>
          </div>

          <div v-if="descriptionEdit.editing.value" class="task-panel-editor">
            <div class="task-panel-toolbar" role="toolbar" aria-label="Formatting">
              <button
                v-for="tool in TOOLBAR"
                :key="tool.format"
                type="button"
                class="task-panel-tool"
                :class="{ grouped: tool.group }"
                :title="MARKDOWN_FORMATS[tool.format].label"
                :aria-label="MARKDOWN_FORMATS[tool.format].label"
                tabindex="-1"
                @mousedown.prevent
                @click="applyFormat(tool.format)"
              >
                <span v-if="tool.icon" class="material-symbols-outlined" aria-hidden="true">{{
                  tool.icon
                }}</span>
                <span v-else class="task-panel-tool-text" aria-hidden="true">{{ tool.text }}</span>
              </button>
              <button
                type="button"
                class="task-panel-editor-done"
                @mousedown.prevent
                @click="descriptionEdit.submit"
              >
                Done
              </button>
            </div>
            <textarea
              :ref="(el) => (descriptionEdit.inputRef.value = el)"
              v-model="descriptionEdit.draft.value"
              class="task-panel-description-input"
              placeholder="Add a description"
              aria-label="Task description"
              :rows="descriptionRows"
              @keydown.escape.stop="descriptionEdit.editing.value = false"
              @blur="descriptionEdit.submit"
            ></textarea>
          </div>
          <div v-else class="task-panel-description-row">
            <div
              v-if="descriptionHtml"
              class="task-panel-description task-panel-description-rendered"
              role="button"
              tabindex="0"
              title="Edit description"
              @click="descriptionEdit.start"
              @keydown.enter.prevent="descriptionEdit.start"
              @keydown.space.prevent="descriptionEdit.start"
              v-html="descriptionHtml"
            ></div>
            <p
              v-else
              class="task-panel-description task-panel-description-empty"
              role="button"
              tabindex="0"
              title="Edit description"
              @click="descriptionEdit.start"
              @keydown.enter.prevent="descriptionEdit.start"
              @keydown.space.prevent="descriptionEdit.start"
            >
              Add a description
            </p>
            <button
              type="button"
              class="task-panel-format"
              title="Format description"
              @click="descriptionEdit.start"
            >
              <span class="task-panel-format-glyph" aria-hidden="true">Aa</span>
              Format
            </button>
          </div>

          <section class="task-subtasks" aria-label="Sub-tasks">
            <header v-if="subtasks.length" class="task-subtasks-header">
              <span class="task-subtasks-title">Sub-tasks</span>
              <span class="task-subtasks-count">{{ doneCount }}/{{ subtasks.length }}</span>
              <span
                class="task-subtasks-progress"
                role="progressbar"
                aria-label="Sub-tasks completed"
                :aria-valuenow="donePercent"
                aria-valuemin="0"
                aria-valuemax="100"
              >
                <span
                  class="task-subtasks-progress-bar"
                  :style="{ width: `${donePercent}%` }"
                ></span>
              </span>
              <span v-if="items.detailCursors[taskId]" class="task-subtasks-loaded">
                loaded ({{ items.detailCounts[taskId]?.total }} total)
              </span>
              <label class="task-subtasks-sort">
                <span class="material-symbols-outlined" aria-hidden="true">sort</span>
                <span class="task-subtasks-sort-text">Sort</span>
                <select v-model="subtaskOrder" aria-label="Sort sub-tasks">
                  <option v-for="order in SUBTASK_ORDERS" :key="order.value" :value="order.value">
                    {{ order.label }}
                  </option>
                </select>
              </label>
              <button
                type="button"
                class="task-subtasks-hide"
                :aria-pressed="hideCompleted ? 'true' : 'false'"
                @click="hideCompleted = !hideCompleted"
              >
                {{ hideCompleted ? 'Show completed' : 'Hide completed' }}
              </button>
            </header>

            <ul v-if="visibleSubtasks.length" class="subtask-rows">
              <li v-for="sub in visibleSubtasks" :key="sub.id" class="subtask-row">
                <button
                  class="subtask-check"
                  :class="{ done: sub.completedAt }"
                  type="button"
                  :aria-label="`${sub.completedAt ? 'Reopen' : 'Complete'} ${sub.content}`"
                  @click="items.setCompleted(sub.id, !sub.completedAt)"
                >
                  <span v-if="sub.completedAt" class="material-symbols-outlined" aria-hidden="true"
                    >check</span
                  >
                </button>
                <span class="subtask-content" :class="{ done: sub.completedAt }">
                  {{ sub.content }}
                </span>
                <button
                  type="button"
                  class="subtask-open"
                  :title="`Open ${sub.content}`"
                  :aria-label="`Open ${sub.content}`"
                  @click="open(sub.id)"
                >
                  <span class="material-symbols-outlined" aria-hidden="true"
                    >keyboard_arrow_right</span
                  >
                </button>
              </li>
            </ul>
            <p v-else-if="subtasks.length" class="task-subtasks-empty">
              {{
                doneCount === subtasks.length
                  ? 'All sub-tasks are completed.'
                  : 'No open sub-tasks on this page.'
              }}
            </p>

            <button v-if="subtaskOffset > 0" class="subtask-page-btn" @click="subtaskOffset -= 100">
              Previous sub-tasks
            </button>
            <button
              v-if="items.detailCursors[taskId] || subtaskOffset + 100 < subtasks.length"
              class="subtask-page-btn"
              :disabled="items.detailLoading[taskId]"
              @click="nextSubtaskPage"
            >
              More sub-tasks
            </button>
            <form v-if="addingSubtask" class="add-subtask-row" @submit.prevent="submitSubtask">
              <input
                ref="subtaskInput"
                v-model="subtaskDraft"
                placeholder="Sub-task name"
                aria-label="Sub-task name"
                @keydown.enter.prevent="submitSubtask"
                @keydown.escape.stop="addingSubtask = false"
                @blur="submitSubtask"
              />
            </form>
            <button v-else class="add-subtask-btn" type="button" @click="startAddSubtask">
              <span class="material-symbols-outlined" aria-hidden="true">add</span>
              Add sub-task
            </button>
          </section>

          <div class="task-panel-tabs" role="tablist" aria-label="Discussion">
            <button
              id="task-panel-tab-comments"
              type="button"
              class="task-panel-tab"
              role="tab"
              :aria-selected="tab === 'comments' ? 'true' : 'false'"
              aria-controls="task-panel-tabpanel"
              @click="tab = 'comments'"
            >
              Comments
              <span v-if="commentCount !== null" class="task-comments-count">{{
                commentCount
              }}</span>
            </button>
            <button
              id="task-panel-tab-activity"
              type="button"
              class="task-panel-tab"
              role="tab"
              :aria-selected="tab === 'activity' ? 'true' : 'false'"
              aria-controls="task-panel-tabpanel"
              @click="tab = 'activity'"
            >
              Activity
            </button>
          </div>
          <div
            id="task-panel-tabpanel"
            class="task-panel-tabpanel"
            role="tabpanel"
            :aria-labelledby="`task-panel-tab-${tab}`"
          >
            <TaskComments v-show="tab === 'comments'" :task-id="taskId" :author-name="userName" />
            <TaskHistory v-if="activityOpened" v-show="tab === 'activity'" :task-id="taskId" />
          </div>
        </div>

        <aside class="task-panel-rail">
          <h3 class="task-panel-section">Organise</h3>
          <div class="task-panel-row">
            <span class="task-panel-row-label">Labels</span>
            <div class="task-panel-row-value task-panel-labels">
              <span class="material-symbols-outlined task-panel-row-icon" aria-hidden="true"
                >sell</span
              >
              <TaskLabelPicker
                :model-value="item?.labels ?? []"
                :disabled="savingLabels"
                @update:model-value="onLabelsChange"
              />
            </div>
          </div>

          <h3 id="task-panel-priority-label" class="task-panel-section">Priority</h3>
          <div class="task-panel-priority" role="group" aria-labelledby="task-panel-priority-label">
            <button
              v-for="level in PRIORITIES"
              :key="level.value"
              type="button"
              class="task-panel-priority-button"
              :class="[`priority-${level.value}`, { selected: level.value === priority }]"
              :aria-label="level.label"
              :aria-pressed="level.value === priority ? 'true' : 'false'"
              @click="choosePriority(level.value)"
            >
              <span
                class="material-symbols-outlined priority-flag"
                :class="`priority-${level.value}`"
                aria-hidden="true"
                >flag</span
              >
              <span class="task-panel-priority-short">{{ level.short }}</span>
            </button>
          </div>
          <p class="task-panel-priority-current">{{ priorityInfo(priority).label }}</p>

          <h3 class="task-panel-section">Schedule</h3>
          <div class="task-panel-row">
            <span class="task-panel-row-label">Date</span>
            <div class="task-panel-row-value task-panel-date" :class="{ set: item?.dueDate }">
              <span class="material-symbols-outlined task-panel-row-icon" aria-hidden="true"
                >calendar_month</span
              >
              <input
                class="task-panel-date-input"
                type="date"
                aria-label="Due date"
                :value="item?.dueDate ?? ''"
                @change="onDateChange($event)"
              />
              <button
                v-if="item?.dueDate"
                class="task-panel-date-clear"
                type="button"
                title="Clear date"
                aria-label="Clear due date"
                @click="items.setDueDate(taskId, null)"
              >
                <span class="material-symbols-outlined" aria-hidden="true">close</span>
              </button>
            </div>
          </div>

          <div class="task-panel-row">
            <span class="task-panel-row-label">Time</span>
            <div class="task-panel-row-value task-panel-time" :class="{ set: item?.dueTime }">
              <span class="material-symbols-outlined task-panel-row-icon" aria-hidden="true"
                >schedule</span
              >
              <input
                class="task-panel-time-input"
                type="time"
                aria-label="Due time"
                :value="item?.dueTime ?? ''"
                :disabled="!item?.dueDate"
                @change="onTimeChange($event)"
              />
              <span v-if="item?.dueTime" class="task-panel-time-zone">
                {{ item.timeZone || localTimeZone }}
              </span>
            </div>
          </div>

          <form class="task-panel-row task-panel-repeat" @submit.prevent="saveRecurrence">
            <span class="task-panel-row-label" aria-hidden="true">Repeat</span>
            <div class="task-panel-row-value">
              <span class="material-symbols-outlined task-panel-row-icon" aria-hidden="true"
                >repeat</span
              >
              <div class="task-panel-repeat-field">
                <TaskRepeatInput v-model="recurrenceDraft" :disabled="savingRecurrence" />
                <button class="task-panel-repeat-save" type="submit" :disabled="savingRecurrence">
                  Save repeat
                </button>
              </div>
            </div>
          </form>

          <p v-if="addedStamp" class="task-panel-added">
            Added {{ addedStamp }}<template v-if="userName"> by {{ userName }}</template>
          </p>
        </aside>
      </div>
    </div>
  </div>
</template>

<style scoped>
.task-panel-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 48px 24px;
  background: rgba(0, 0, 0, 0.35);
}

.task-panel-backdrop.expanded {
  padding: 0;
}

.task-panel {
  width: 100%;
  max-width: 1000px;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-dialog);
  border-radius: 12px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
  overflow: hidden;
}

.task-panel.expanded {
  max-width: none;
  height: 100%;
  border-radius: 0;
}

/* ---- header ---------------------------------------------------------- */

.task-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color);
}

.task-panel-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.task-panel-actions-divider {
  width: 1px;
  height: 20px;
  margin: 0 8px;
  background: var(--border-color);
}

.task-panel-actions button {
  display: flex;
  align-items: center;
  padding: 6px;
  border: none;
  border-radius: 8px;
  background: none;
  color: var(--text-secondary);
  cursor: pointer;
}

.task-panel-actions button:hover:not(:disabled),
.task-panel-actions .task-panel-more.open {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.task-panel-actions button:disabled {
  opacity: 0.35;
  cursor: default;
}

.task-panel-actions .material-symbols-outlined {
  font-size: 20px;
}

.task-panel-menu-wrap {
  position: relative;
}

/* The menu drops out of its button, over the body. The panel is the
   stacking context, so z-index only has to clear the body's content. */
.task-panel-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 1;
  min-width: 240px;
  padding: 6px;
  background: var(--bg-dialog);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  box-shadow: var(--shadow-lg);
}

.task-panel-actions .task-panel-menu-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 8px 10px;
  border-radius: 6px;
  font: inherit;
  font-size: 14px;
  color: var(--text-primary);
  text-align: left;
  white-space: nowrap;
}

.task-panel-actions .task-panel-menu-item .material-symbols-outlined {
  font-size: 20px;
  color: var(--text-secondary);
}

.task-panel-actions .task-panel-menu-item.task-panel-delete,
.task-panel-actions .task-panel-menu-item.task-panel-delete .material-symbols-outlined {
  color: #d1453b;
}

.task-panel-menu-rule {
  margin: 6px 0;
  border: none;
  border-top: 1px solid var(--border-color);
}

/* ---- body ---------------------------------------------------------- */

.task-panel-body {
  display: flex;
  min-height: 0;
  flex: 1;
}

.task-panel-main {
  flex: 1;
  min-width: 0;
  padding: 28px 32px 32px;
  overflow-y: auto;
}

.task-panel-rail {
  width: 300px;
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  padding: 24px;
  border-left: 1px solid var(--border-color);
  background: var(--bg-app);
  overflow-y: auto;
}

.task-panel-heading {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.task-panel-check {
  width: 22px;
  height: 22px;
  margin-top: 8px;
  flex: 0 0 auto;
  border: 2px solid var(--text-secondary);
  border-radius: 50%;
  background: none;
  cursor: pointer;
}

.task-panel-check[aria-pressed='true'] {
  background: var(--accent-color);
  color: white;
  border-color: var(--accent-color);
}
.task-panel-check .material-symbols-outlined {
  font-size: 16px;
  display: block;
}

.task-panel-check:hover {
  background: var(--bg-hover);
}

.task-panel-title {
  margin: 0;
  font-size: 28px;
  font-weight: 700;
  line-height: 1.35;
  cursor: text;
}

/* The title's click-to-edit is a real button for keyboard reach, stripped
   back so it reads as the heading text it sits in. */
.inline-edit-trigger {
  padding: 0;
  border: none;
  background: none;
  font: inherit;
  color: inherit;
  text-align: inherit;
  cursor: text;
}

.inline-edit-trigger:focus-visible,
.task-panel-description:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

/* Editing happens in place: the field carries the same metrics as the text it
   replaces and no box of its own, so entering and leaving edit mode moves
   nothing — the caret is the only sign the field is live. */
.task-panel-title-input {
  display: block;
  width: 100%;
  font: inherit;
  font-size: 28px;
  font-weight: 700;
  line-height: 1.35;
  color: inherit;
  background: transparent;
  border: none;
  outline: none;
  padding: 0;
}

/* ---- description ----------------------------------------------------- */

.task-panel-description-row {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  margin: 16px 0 0 34px;
}

.task-panel-description {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: 15px;
  line-height: 1.55;
  cursor: text;
}

.task-panel-description-empty {
  color: var(--text-secondary);
}

.task-panel-description-rendered :deep(h1),
.task-panel-description-rendered :deep(h2),
.task-panel-description-rendered :deep(h3) {
  margin: 0 0 12px;
  font-weight: 700;
  line-height: 1.3;
}

.task-panel-description-rendered :deep(h1) {
  font-size: 22px;
}

.task-panel-description-rendered :deep(h2) {
  font-size: 18px;
}

.task-panel-description-rendered :deep(h3) {
  font-size: 16px;
}

.task-panel-description-rendered :deep(p),
.task-panel-description-rendered :deep(ul),
.task-panel-description-rendered :deep(ol),
.task-panel-description-rendered :deep(blockquote) {
  margin: 0 0 12px;
}

.task-panel-description-rendered :deep(ul),
.task-panel-description-rendered :deep(ol) {
  padding-left: 24px;
}

.task-panel-description-rendered :deep(blockquote) {
  padding-left: 12px;
  border-left: 3px solid var(--border-color);
  color: var(--text-secondary);
}

.task-panel-description-rendered :deep(pre) {
  margin: 0 0 12px;
  padding: 14px 16px;
  overflow-x: auto;
  border-radius: 8px;
  background: var(--bg-input);
  font-family: var(--font-mono);
  font-size: 14px;
}

.task-panel-description-rendered :deep(code) {
  font-family: var(--font-mono);
  font-size: 0.92em;
}

.task-panel-description-rendered :deep(p code) {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--bg-input);
}

.task-panel-description-rendered :deep(a) {
  color: var(--text-blue);
}

.task-panel-description-rendered :deep(> :last-child) {
  margin-bottom: 0;
}

.task-panel-format {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  padding: 6px 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-dialog);
  font: inherit;
  font-size: 14px;
  color: var(--text-primary);
  cursor: pointer;
}

.task-panel-format:hover {
  background: var(--bg-hover);
}

.task-panel-format-glyph {
  font-weight: 700;
}

.task-panel-editor {
  margin: 16px 0 0 34px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--bg-dialog);
  box-shadow: var(--shadow-sm);
}

.task-panel-toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border-color);
}

.task-panel-tool {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--text-primary);
  cursor: pointer;
}

.task-panel-tool.grouped {
  margin-left: 10px;
}

.task-panel-tool.grouped::before {
  content: '';
  position: relative;
  left: -7px;
  width: 1px;
  height: 18px;
  background: var(--border-color);
}

.task-panel-tool:hover {
  background: var(--bg-hover);
}

.task-panel-tool .material-symbols-outlined {
  font-size: 20px;
}

.task-panel-tool-text {
  font-size: 13px;
  font-weight: 700;
}

.task-panel-editor-done {
  margin-left: auto;
  padding: 6px 14px;
  border: none;
  border-radius: 8px;
  background: var(--bg-input);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  cursor: pointer;
}

.task-panel-editor-done:hover {
  background: var(--bg-hover);
}

.task-panel-description-input {
  display: block;
  width: 100%;
  box-sizing: border-box;
  padding: 14px 16px;
  font: inherit;
  font-size: 15px;
  line-height: 1.55;
  color: inherit;
  background: transparent;
  border: none;
  outline: none;
  resize: none;
  field-sizing: content;
}

/* ---- sub-tasks ------------------------------------------------------- */

.task-subtasks {
  margin: 36px 0 0 34px;
}

.task-subtasks-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border-color);
  font-size: 15px;
}

.task-subtasks-title {
  font-weight: 700;
}

.task-subtasks-count,
.task-subtasks-loaded {
  color: var(--text-secondary);
}

.task-subtasks-progress {
  display: block;
  width: 120px;
  height: 4px;
  border-radius: 2px;
  background: var(--border-color);
  overflow: hidden;
}

.task-subtasks-progress-bar {
  display: block;
  height: 100%;
  background: var(--accent);
}

.task-subtasks-sort {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  color: var(--text-secondary);
  cursor: pointer;
}

.task-subtasks-sort .material-symbols-outlined {
  font-size: 18px;
}

.task-subtasks-sort select {
  position: absolute;
  inset: 0;
  width: 100%;
  opacity: 0;
  cursor: pointer;
}

.task-subtasks-sort:hover,
.task-subtasks-hide:hover {
  color: var(--text-primary);
}

.task-subtasks-sort:focus-within {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: 2px;
}

.task-subtasks-hide {
  margin-left: 20px;
  padding: 0;
  border: none;
  background: none;
  font: inherit;
  color: var(--text-secondary);
  cursor: pointer;
}

.subtask-rows {
  list-style: none;
  margin: 0;
  padding: 0;
}

.subtask-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid var(--border-color);
}

.subtask-check {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  flex: 0 0 auto;
  border: 1.5px solid var(--text-secondary);
  border-radius: 50%;
  background: none;
  cursor: pointer;
}

.subtask-check:hover {
  background: var(--bg-hover);
}

.subtask-check.done {
  background: var(--text-secondary);
  border-color: var(--text-secondary);
  color: var(--bg-dialog);
}

.subtask-check .material-symbols-outlined {
  font-size: 14px;
}

.subtask-content {
  flex: 1;
  font-size: 15px;
  min-width: 0;
}

.subtask-content.done {
  color: var(--text-secondary);
  text-decoration: line-through;
}

.subtask-open {
  display: flex;
  padding: 2px;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--text-secondary);
  cursor: pointer;
}

.subtask-open:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.subtask-open .material-symbols-outlined {
  font-size: 20px;
}

.task-subtasks-empty {
  margin: 12px 0 0;
  font-size: 14px;
  color: var(--text-secondary);
}

.add-subtask-btn,
.subtask-page-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
  padding: 6px 0;
  border: none;
  background: none;
  color: var(--text-secondary);
  font: inherit;
  font-size: 15px;
  cursor: pointer;
}

.add-subtask-btn .material-symbols-outlined {
  font-size: 22px;
  color: var(--accent);
}

.add-subtask-btn:hover,
.subtask-page-btn:hover {
  color: var(--text-primary);
}

.add-subtask-row {
  display: flex;
  margin-top: 10px;
}

.add-subtask-row input {
  flex: 1;
  font: inherit;
  font-size: 15px;
  color: inherit;
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 8px 10px;
}

/* ---- comments and activity -------------------------------------------- */

.task-panel-tabs {
  display: flex;
  gap: 24px;
  margin: 40px 0 0 34px;
  border-bottom: 1px solid var(--border-color);
}

.task-panel-tab {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0 10px;
  margin-bottom: -1px;
  border: none;
  border-bottom: 2px solid transparent;
  background: none;
  font: inherit;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-secondary);
  cursor: pointer;
}

.task-panel-tab:hover {
  color: var(--text-primary);
}

.task-panel-tab[aria-selected='true'] {
  color: var(--text-primary);
  border-bottom-color: var(--accent);
}

.task-comments-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 10px;
  background: var(--bg-input);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}

.task-panel-tabpanel {
  margin-left: 34px;
}

.task-panel-tabpanel :deep(.task-activity) {
  margin: 12px 0 0;
}

/* ---- rail ----------------------------------------------------------- */

.task-panel-section {
  margin: 0 0 12px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.task-panel-section + .task-panel-section,
.task-panel-row + .task-panel-section,
.task-panel-priority-current + .task-panel-section {
  margin-top: 28px;
}

.task-panel-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  min-height: 32px;
  margin-bottom: 14px;
  font-size: 15px;
}

.task-panel-row-label {
  flex: 0 0 76px;
  padding-top: 4px;
  color: var(--text-secondary);
}

.task-panel-row-value {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.task-panel-row-icon {
  font-size: 20px;
  color: var(--text-secondary);
}

.task-panel-labels {
  align-items: flex-start;
}

.task-panel-labels .task-panel-row-icon {
  margin-top: 5px;
}

.task-panel-labels :deep(.task-label-picker) {
  flex: 1;
  min-width: 0;
}

/* The four levels in one pill; the chosen one is lifted out as a card. */
.task-panel-priority {
  display: flex;
  gap: 4px;
  padding: 4px;
  border-radius: 10px;
  background: var(--bg-input);
}

.task-panel-priority-button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  flex: 1;
  padding: 8px 4px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: none;
  font: inherit;
  font-size: 14px;
  color: var(--text-secondary);
  cursor: pointer;
}

.task-panel-priority-button:hover {
  color: var(--text-primary);
}

.task-panel-priority-button.selected {
  background: var(--bg-dialog);
  border-color: var(--border-color);
  box-shadow: var(--shadow-sm);
  color: var(--text-primary);
  font-weight: 700;
}

.task-panel-priority-current {
  margin: 8px 0 0;
  font-size: 13px;
  color: var(--text-secondary);
}

/* Todoist's colours: red, orange, blue, and a plain flag for the default.
   Filled for the three real levels so the colour reads at 18px; outlined for
   P4 so "no priority" looks like an absence rather than a grey level. */
.priority-flag {
  font-size: 18px;
  color: var(--text-secondary);
}

.priority-flag.priority-1,
.priority-flag.priority-2,
.priority-flag.priority-3 {
  font-variation-settings: 'FILL' 1;
}

.priority-flag.priority-1 {
  color: #d1453b;
}

.priority-flag.priority-2 {
  color: #eb8909;
}

.priority-flag.priority-3 {
  color: #246fe0;
}

.task-panel-date-input,
.task-panel-time-input {
  min-width: 0;
  padding: 4px 0;
  border: none;
  background: transparent;
  font: inherit;
  font-size: 15px;
  color: var(--text-secondary);
}

.task-panel-date.set .task-panel-date-input,
.task-panel-date.set .task-panel-row-icon,
.task-panel-time.set .task-panel-time-input,
.task-panel-time.set .task-panel-row-icon {
  color: var(--text-green);
}

.task-panel-time-input:disabled {
  opacity: 0.55;
}

.task-panel-time-zone {
  color: var(--text-secondary);
  font-size: 12px;
  white-space: nowrap;
}

.task-panel-date-clear {
  display: flex;
  margin-left: auto;
  padding: 2px;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--text-secondary);
  cursor: pointer;
}

.task-panel-date-clear:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.task-panel-repeat {
  margin-top: 4px;
}

.task-panel-repeat .task-panel-row-value {
  align-items: flex-start;
}

.task-panel-repeat .task-panel-row-icon {
  margin-top: 5px;
}

.task-panel-repeat-field {
  flex: 1;
  min-width: 0;
}

/* The repeat input carries its own label; the row already names it. */
.task-panel-repeat-field :deep(.task-repeat label) {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}

.task-panel-repeat-save {
  margin-top: 8px;
  padding: 4px 10px;
  font: inherit;
  font-size: 13px;
  color: var(--text-primary);
  background: var(--bg-dialog);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  cursor: pointer;
}

.task-panel-added {
  margin: auto 0 0;
  padding-top: 20px;
  border-top: 1px solid var(--border-color);
  font-size: 13px;
  color: var(--text-secondary);
}

@media (max-width: 720px) {
  .task-panel-backdrop {
    padding: 16px;
  }

  .task-panel-body {
    flex-direction: column;
    overflow-y: auto;
  }

  .task-panel-main {
    flex: none;
    padding: 20px;
    overflow: visible;
  }

  .task-panel-rail {
    width: auto;
    padding: 20px;
    border-left: none;
    border-top: 1px solid var(--border-color);
    overflow: visible;
  }

  .task-panel-added {
    margin-top: 20px;
  }
}
</style>
