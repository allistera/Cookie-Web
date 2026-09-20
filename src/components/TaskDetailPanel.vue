<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import TaskLabelPicker from './TaskLabelPicker.vue'
import TaskRepeatInput from './TaskRepeatInput.vue'
import { useInlineEdit } from '../composables/useInlineEdit'
import { PRIORITIES, priorityInfo, priorityOf } from '../lib/taskPriority'
import { flattenProjectTree } from '../lib/taskProjectsTree'
import { useProjectsStore } from '../stores/projects'
import { useTaskItemsStore } from '../stores/taskItems'

const props = defineProps({ taskId: { type: String, required: true } })

const route = useRoute()
const router = useRouter()
const items = useTaskItemsStore()
const projects = useProjectsStore()

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
    if (updated && !item.value) close()
  } finally {
    savingRecurrence.value = false
  }
}

// A task with no project is in the Inbox — the same rule the sidebar encodes.
const projectName = computed(() => {
  if (!item.value?.projectId) return 'Inbox'
  return projects.projects.find((row) => row.id === item.value.projectId)?.name ?? 'Inbox'
})

// Every project, in the sidebar's order and depth, so the picker reads the
// same way the tree does. Expanding every id keeps the whole forest visible —
// a picker that hid options behind collapsed parents would be unusable.
const projectOptions = computed(() =>
  flattenProjectTree(projects.projects, new Set(projects.projects.map((row) => row.id))),
)

// 'inbox' is the select's stand-in for "no project": a value is needed for the
// option, but the wire carries null.
const selectedProject = computed(() => item.value?.projectId ?? 'inbox')

function onProjectChange(event) {
  const value = String(event.target.value ?? '')
  items.moveItem(props.taskId, value === 'inbox' ? null : value)
}

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
  Math.min(8, Math.max(2, descriptionEdit.draft.value.split('\n').length)),
)

// Sub-tasks resolve out of the same loaded list the panel's own task does —
// the list query returns them (completed included) alongside their parent.
const subtasks = computed(() => items.items.filter((row) => row.parentId === props.taskId))
const subtaskOffset = ref(0)
watch(
  () => props.taskId,
  () => {
    subtaskOffset.value = 0
  },
)
const visibleSubtasks = computed(() =>
  subtasks.value.slice(subtaskOffset.value, subtaskOffset.value + 100),
)
async function nextSubtaskPage() {
  if (subtaskOffset.value + 100 >= subtasks.value.length)
    await items.loadDetail(props.taskId, { more: true })
  if (subtaskOffset.value + 100 < subtasks.value.length) subtaskOffset.value += 100
}
const doneCount = computed(() => subtasks.value.filter((row) => row.completedAt).length)
const subtasksOpen = ref(true)

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

// Priority is a custom menu rather than a <select>: a native select cannot
// carry the coloured flag beside each level, and the flag is what makes the
// levels legible at a glance. It behaves as a listbox — one button that opens
// it, one option per level, the current one marked.
const priority = computed(() => priorityOf(item.value))
const priorityMenuOpen = ref(false)
const priorityButton = ref(null)
const priorityMenu = ref(null)

// The menu is fixed to the viewport, not absolutely positioned in the rail:
// the dialog clips its overflow, and the field sits at the bottom of the
// rail, so a menu dropping out of the button would be cut off at the
// dialog's edge. It is measured against the button once rendered, and flips
// above the button when the viewport has no room below.
const priorityMenuStyle = ref({})

function placePriorityMenu() {
  const button = priorityButton.value
  const menu = priorityMenu.value
  if (!button || !menu) return
  const rect = button.getBoundingClientRect()
  const gap = 4
  const height = menu.offsetHeight
  const fitsBelow = rect.bottom + gap + height <= window.innerHeight
  priorityMenuStyle.value = {
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    top: `${fitsBelow ? rect.bottom + gap : rect.top - gap - height}px`,
  }
}

async function togglePriorityMenu() {
  priorityMenuOpen.value = !priorityMenuOpen.value
  if (!priorityMenuOpen.value) return
  await nextTick()
  placePriorityMenu()
}

async function choosePriority(value) {
  priorityMenuOpen.value = false
  priorityButton.value?.focus()
  if (value === priority.value) return
  await items.setPriority(props.taskId, value)
}

// A click anywhere else in the panel closes the menu. The dialog stops clicks
// from reaching the backdrop (which would close the whole panel), so this is
// where an "outside" click is seen; a backdrop click closes everything anyway.
const priorityField = ref(null)

function onPanelClick(event) {
  if (!priorityMenuOpen.value) return
  if (event.target instanceof Node && priorityField.value?.contains(event.target)) return
  priorityMenuOpen.value = false
}

// Completing takes the task out of the visible list, so the panel would be
// left pointing at something that is no longer there.
const completing = ref(false)
async function complete() {
  if (completing.value) return
  completing.value = true
  const updated = await items.setCompleted(props.taskId, true)
  if (updated) close()
  else completing.value = false
}

// Deleting takes any sub-tasks with it via ON DELETE CASCADE and there is no
// undo endpoint, so it asks first and names what it is about to remove.
async function remove() {
  if (!item.value) return
  if (!confirm(`Delete "${item.value.content}"?`)) return
  const deleted = await items.deleteItem(props.taskId)
  // A failed delete has already notified; stay put rather than close over a
  // task that is still there.
  if (deleted) close()
}

function close() {
  const query = { ...route.query }
  delete query.task
  router.push({ path: '/tasks', query })
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

function onKeydown(event) {
  if (event.key !== 'Escape') return
  // Escape with the menu open is asking to leave the menu, not the panel.
  if (priorityMenuOpen.value) {
    priorityMenuOpen.value = false
    priorityButton.value?.focus()
    return
  }
  close()
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="task-panel-backdrop" @click="close()">
    <div
      class="task-panel"
      role="dialog"
      aria-modal="true"
      :aria-label="item?.content ?? 'Task'"
      @click.stop="onPanelClick($event)"
    >
      <header class="task-panel-header">
        <span class="task-panel-project">
          <span v-if="item?.projectId" class="project-symbol" aria-hidden="true"></span>
          <span v-else class="material-symbols-outlined" aria-hidden="true">inbox</span>
          {{ projectName }}
        </span>

        <div class="task-panel-actions">
          <button
            class="task-panel-delete"
            type="button"
            title="Delete task"
            aria-label="Delete task"
            @click="remove()"
          >
            <span class="material-symbols-outlined" aria-hidden="true">delete</span>
          </button>
          <button
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
              :aria-label="`Complete ${item?.content ?? 'task'}`"
              @click="complete()"
            ></button>
            <input
              v-if="titleEdit.editing.value"
              :ref="(el) => (titleEdit.inputRef.value = el)"
              v-model="titleEdit.draft.value"
              class="task-panel-title-input"
              aria-label="Task title"
              @keydown.enter.prevent="titleEdit.submit"
              @keydown.escape="titleEdit.editing.value = false"
              @blur="titleEdit.submit"
            />
            <h2 v-else class="task-panel-title" @click="titleEdit.start">{{ item?.content }}</h2>
          </div>

          <textarea
            v-if="descriptionEdit.editing.value"
            :ref="(el) => (descriptionEdit.inputRef.value = el)"
            v-model="descriptionEdit.draft.value"
            class="task-panel-description-input"
            placeholder="Add a description"
            aria-label="Task description"
            :rows="descriptionRows"
            @keydown.escape="descriptionEdit.editing.value = false"
            @blur="descriptionEdit.submit"
          ></textarea>
          <p v-else class="task-panel-description" @click="descriptionEdit.start">
            {{ item?.description || 'Add a description' }}
          </p>

          <section class="task-subtasks" aria-label="Sub-tasks">
            <header v-if="subtasks.length" class="task-subtasks-header">
              <button
                class="task-subtasks-toggle"
                type="button"
                :aria-expanded="subtasksOpen ? 'true' : 'false'"
                @click="subtasksOpen = !subtasksOpen"
              >
                <span class="material-symbols-outlined" aria-hidden="true">
                  {{ subtasksOpen ? 'keyboard_arrow_down' : 'keyboard_arrow_right' }}
                </span>
                <span class="task-subtasks-title">Sub-tasks</span>
                <span class="task-subtasks-count"
                  >{{ doneCount }}/{{ subtasks.length
                  }}<span v-if="items.detailCursors[taskId]">
                    loaded ({{ items.detailCounts[taskId]?.total }} total)</span
                  ></span
                >
              </button>
            </header>

            <template v-if="subtasksOpen">
              <ul v-if="subtasks.length" class="subtask-rows">
                <li v-for="sub in visibleSubtasks" :key="sub.id" class="subtask-row">
                  <button
                    class="subtask-check"
                    :class="{ done: sub.completedAt }"
                    type="button"
                    :aria-label="`${sub.completedAt ? 'Reopen' : 'Complete'} ${sub.content}`"
                    @click="items.setCompleted(sub.id, !sub.completedAt)"
                  >
                    <span
                      v-if="sub.completedAt"
                      class="material-symbols-outlined"
                      aria-hidden="true"
                      >check</span
                    >
                  </button>
                  <span class="subtask-content" :class="{ done: sub.completedAt }">
                    {{ sub.content }}
                  </span>
                </li>
              </ul>

              <button
                v-if="subtaskOffset > 0"
                class="add-subtask-btn"
                @click="subtaskOffset -= 100"
              >
                Previous sub-tasks
              </button>
              <button
                v-if="items.detailCursors[taskId] || subtaskOffset + 100 < subtasks.length"
                class="add-subtask-btn"
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
                <span aria-hidden="true">+</span> Add sub-task
              </button>
            </template>
          </section>
        </div>
        <aside class="task-panel-rail">
          <div class="task-panel-field">
            <h3>Project</h3>
            <select
              class="task-panel-project-select"
              aria-label="Project"
              :value="selectedProject"
              @change="onProjectChange($event)"
            >
              <option value="inbox">Inbox</option>
              <option v-for="row in projectOptions" :key="row.item.id" :value="row.item.id">
                {{ '\u00a0\u00a0'.repeat(row.depth) }}{{ row.item.name }}
              </option>
            </select>
          </div>

          <div class="task-panel-field">
            <h3>Date</h3>
            <div class="task-panel-date">
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

          <div class="task-panel-field">
            <h3>Time</h3>
            <input
              class="task-panel-time-input"
              type="time"
              aria-label="Due time"
              :value="item?.dueTime ?? ''"
              :disabled="!item?.dueDate"
              @change="onTimeChange($event)"
            />
            <p v-if="item?.dueTime" class="task-panel-time-zone">
              {{ item.timeZone || localTimeZone }}
            </p>
          </div>

          <div class="task-panel-field">
            <h3>Labels</h3>
            <TaskLabelPicker
              :model-value="item?.labels ?? []"
              :disabled="savingLabels"
              @update:model-value="onLabelsChange"
            />
          </div>

          <form class="task-panel-field" @submit.prevent="saveRecurrence">
            <TaskRepeatInput v-model="recurrenceDraft" :disabled="savingRecurrence" />
            <button class="task-panel-repeat-save" type="submit" :disabled="savingRecurrence">
              Save repeat
            </button>
          </form>

          <div class="task-panel-field">
            <h3 id="task-panel-priority-label">Priority</h3>
            <div ref="priorityField" class="task-panel-priority">
              <button
                ref="priorityButton"
                class="task-panel-priority-button"
                :class="[`priority-${priority}`, { open: priorityMenuOpen }]"
                type="button"
                aria-haspopup="listbox"
                :aria-expanded="priorityMenuOpen ? 'true' : 'false'"
                :aria-label="`Priority: ${priorityInfo(priority).label}`"
                @click="togglePriorityMenu()"
              >
                <span
                  class="material-symbols-outlined priority-flag"
                  :class="`priority-${priority}`"
                  aria-hidden="true"
                  >flag</span
                >
                <span class="task-panel-priority-short">{{ priorityInfo(priority).short }}</span>
                <span
                  class="material-symbols-outlined task-panel-priority-chevron"
                  aria-hidden="true"
                >
                  {{ priorityMenuOpen ? 'expand_less' : 'expand_more' }}
                </span>
              </button>

              <ul
                v-if="priorityMenuOpen"
                ref="priorityMenu"
                class="task-panel-priority-menu"
                :style="priorityMenuStyle"
                role="listbox"
                aria-labelledby="task-panel-priority-label"
              >
                <li
                  v-for="level in PRIORITIES"
                  :key="level.value"
                  class="task-panel-priority-option"
                  :class="{ selected: level.value === priority }"
                  role="option"
                  :aria-selected="level.value === priority ? 'true' : 'false'"
                  @click="choosePriority(level.value)"
                >
                  <span
                    class="material-symbols-outlined priority-flag"
                    :class="`priority-${level.value}`"
                    aria-hidden="true"
                    >flag</span
                  >
                  <span class="task-panel-priority-option-label">{{ level.label }}</span>
                  <span
                    v-if="level.value === priority"
                    class="material-symbols-outlined task-panel-priority-check"
                    aria-hidden="true"
                    >check</span
                  >
                </li>
              </ul>
            </div>
          </div>
        </aside>
      </div>
    </div>
  </div>
</template>

<style scoped>
.task-panel-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 48px 24px;
  background: rgba(0, 0, 0, 0.35);
}

.task-panel {
  width: 100%;
  max-width: 860px;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-dialog);
  border-radius: 10px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
  overflow: hidden;
}

.task-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color);
}

.task-panel-project {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  color: var(--text-secondary);
}

.task-panel-project .material-symbols-outlined {
  font-size: 18px;
}

.task-panel-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.task-panel-actions button {
  display: flex;
  align-items: center;
  padding: 4px;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--text-secondary);
  cursor: pointer;
}

.task-panel-actions button:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.task-panel-actions button:disabled {
  opacity: 0.35;
  cursor: default;
}

.task-panel-body {
  display: flex;
  min-height: 0;
  flex: 1;
}

.task-panel-main {
  flex: 1;
  min-width: 0;
  padding: 20px 24px;
  overflow-y: auto;
}

.task-panel-rail {
  width: 260px;
  flex: 0 0 auto;
  padding: 20px;
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
  width: 20px;
  height: 20px;
  margin-top: 3px;
  flex: 0 0 auto;
  border: 1.5px solid var(--text-secondary);
  border-radius: 50%;
  background: none;
  cursor: pointer;
}

.task-panel-check:hover {
  background: var(--bg-hover);
}

.task-panel-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  cursor: text;
}

.task-panel-description {
  margin: 10px 0 0 32px;
  color: var(--text-secondary);
  font-size: 14px;
  cursor: text;
  white-space: pre-wrap;
}

/* Editing happens in place: the field carries the same metrics as the text it
   replaces and no box of its own, so entering and leaving edit mode moves
   nothing — the caret is the only sign the field is live. */
.task-panel-title-input,
.task-panel-description-input {
  display: block;
  width: 100%;
  font: inherit;
  color: inherit;
  background: transparent;
  border: none;
  outline: none;
  padding: 0;
}

.task-panel-title-input {
  font-size: 20px;
  font-weight: 700;
}

.task-panel-description-input {
  margin: 10px 0 0 32px;
  width: calc(100% - 32px);
  font-size: 14px;
  resize: none;
  field-sizing: content;
}
.task-subtasks {
  margin: 22px 0 0 32px;
}

.task-subtasks-header {
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-color);
}

.task-subtasks-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.task-subtasks-toggle .material-symbols-outlined {
  font-size: 18px;
  color: var(--text-secondary);
}

.task-subtasks-count {
  color: var(--text-secondary);
  font-weight: 400;
}

.subtask-rows {
  list-style: none;
  margin: 0;
  padding: 0;
}

.subtask-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border-color);
}

.subtask-check {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
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
  font-size: 12px;
}

.subtask-content {
  font-size: 14px;
  min-width: 0;
}

.subtask-content.done {
  color: var(--text-secondary);
  text-decoration: line-through;
}

.add-subtask-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  padding: 6px 0;
  border: none;
  background: none;
  color: var(--text-secondary);
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}

.add-subtask-btn:hover {
  color: var(--text-primary);
}

.add-subtask-row {
  display: flex;
  margin-top: 8px;
}

.add-subtask-row input {
  flex: 1;
  font: inherit;
  font-size: 14px;
  color: inherit;
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 6px 8px;
}

.task-panel-field + .task-panel-field {
  margin-top: 18px;
  padding-top: 18px;
  border-top: 1px solid var(--border-color);
}

.task-panel-repeat-save {
  margin-top: 8px;
  padding: 4px 8px;
  font: inherit;
  font-size: 13px;
  color: var(--text-primary);
  background: var(--bg-dialog);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  cursor: pointer;
}

.task-panel-field h3 {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
}

.task-panel-project-select {
  width: 100%;
  font: inherit;
  font-size: 14px;
  color: inherit;
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 4px 6px;
}

.task-panel-date {
  display: flex;
  align-items: center;
  gap: 6px;
}

.task-panel-date-input,
.task-panel-time-input,

.task-panel-time-input:disabled {
  opacity: 0.55;
}

.task-panel-time-zone {
  margin: 6px 0 0;
  color: var(--text-secondary);
  font-size: 12px;
}

.task-panel-date-clear {
  display: flex;
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

.task-panel-priority {
  position: relative;
}

.task-panel-priority-button {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  font: inherit;
  font-size: 14px;
  color: inherit;
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 4px 6px;
  cursor: pointer;
  text-align: left;
}

.task-panel-priority-button:hover,
.task-panel-priority-button.open {
  background: var(--bg-hover);
}

.task-panel-priority-short {
  flex: 1;
}

.task-panel-priority-chevron {
  font-size: 18px;
  color: var(--text-secondary);
}

.task-panel-priority-menu {
  /* Placed from script (see placePriorityMenu); z-index only has to clear
     the dialog's own content, since the backdrop already sits above the app. */
  position: fixed;
  z-index: 1;
  margin: 0;
  padding: 4px;
  list-style: none;
  background: var(--bg-dialog);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
}

.task-panel-priority-option {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
}

.task-panel-priority-option:hover,
.task-panel-priority-option.selected {
  background: var(--bg-hover);
}

.task-panel-priority-option-label {
  flex: 1;
}

.task-panel-priority-check {
  font-size: 18px;
  color: var(--accent);
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
@media (max-width: 600px) {
  .task-panel-backdrop {
    padding: 16px;
  }

  .task-panel-body {
    flex-direction: column;
    overflow-y: auto;
  }

  .task-panel-main {
    flex: none;
    padding: 16px;
    overflow: visible;
  }

  .task-panel-rail {
    width: auto;
    padding: 16px;
    border-left: none;
    border-top: 1px solid var(--border-color);
    overflow: visible;
  }
}
</style>
