<script setup>
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { useInlineEdit } from '../composables/useInlineEdit'
import { flattenProjectTree } from '../lib/taskProjectsTree'
import { useProjectsStore } from '../stores/projects'
import { useTaskItemsStore } from '../stores/taskItems'

const props = defineProps({ taskId: { type: String, required: true } })

const route = useRoute()
const router = useRouter()
const items = useTaskItemsStore()
const projects = useProjectsStore()

const item = computed(() => items.itemById(props.taskId))

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

// An empty input means the date was cleared; null is what the server treats
// as "no date", where '' would be refused as malformed.
function onDateChange(event) {
  const value = String(event.target.value ?? '')
  items.setDueDate(props.taskId, value || null)
}

// Completing takes the task out of the visible list, so the panel would be
// left pointing at something that is no longer there.
async function complete() {
  await items.setCompleted(props.taskId, true)
  close()
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
  () => [items.isLoading, items.loadedProject, item.value],
  () => {
    if (items.isLoading || items.loadedProject === null || item.value) return
    items.notify('That task no longer exists.', 'error')
    close()
  },
  { immediate: true },
)

function onKeydown(event) {
  if (event.key === 'Escape') close()
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
      @click.stop
    >
      <header class="task-panel-header">
        <span class="task-panel-project">
          <span v-if="item?.projectId" class="project-symbol" aria-hidden="true"></span>
          <span v-else class="material-symbols-outlined" aria-hidden="true">inbox</span>
          {{ projectName }}
        </span>

        <div class="task-panel-actions">
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

      <div class="task-panel-body">
        <div class="task-panel-main">
          <div class="task-panel-heading">
            <button
              class="task-panel-check"
              type="button"
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

          <input
            v-if="descriptionEdit.editing.value"
            :ref="(el) => (descriptionEdit.inputRef.value = el)"
            v-model="descriptionEdit.draft.value"
            class="task-panel-description-input"
            aria-label="Task description"
            @keydown.enter.prevent="descriptionEdit.submit"
            @keydown.escape="descriptionEdit.editing.value = false"
            @blur="descriptionEdit.submit"
          />
          <p v-else class="task-panel-description" @click="descriptionEdit.start">
            {{ item?.description || 'Add a description' }}
          </p>
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
}

.task-panel-title-input,
.task-panel-description-input {
  display: block;
  width: 100%;
  font: inherit;
  color: inherit;
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 2px 6px;
}

.task-panel-title-input {
  font-size: 20px;
  font-weight: 700;
}

.task-panel-description-input {
  margin: 10px 0 0 32px;
  width: calc(100% - 32px);
  font-size: 14px;
}
.task-panel-field + .task-panel-field {
  margin-top: 18px;
  padding-top: 18px;
  border-top: 1px solid var(--border-color);
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

.task-panel-date-input {
  flex: 1;
  min-width: 0;
  font: inherit;
  font-size: 14px;
  color: inherit;
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 4px 6px;
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
</style>
