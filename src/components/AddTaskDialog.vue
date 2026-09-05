<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

import TaskRepeatInput from './TaskRepeatInput.vue'
import { useTaskItemsStore } from '../stores/taskItems'
import { useProjectsStore } from '../stores/projects'
import { flattenProjectTree } from '../lib/taskProjectsTree'
import { PRIORITIES } from '../lib/taskPriority'

const emit = defineEmits(['close'])
const items = useTaskItemsStore()
const projects = useProjectsStore()
const mode = ref('ai')
const text = ref('')
const titleInput = ref(null)
const isSaving = ref(false)
const error = ref('')
const parsedText = ref(null)
const draft = ref({
  content: '',
  description: '',
  projectId: null,
  dueDate: '',
  dueTime: '',
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  priority: 4,
  recurrence: '',
  labels: [],
})
const labelsText = ref('')
const projectOptions = computed(() =>
  flattenProjectTree(projects.projects, new Set(projects.projects.map((row) => row.id))),
)
const canSubmit = computed(
  () =>
    Boolean(mode.value === 'ai' ? text.value.trim() : draft.value.content.trim()) &&
    !isSaving.value,
)

async function interpret() {
  const input = text.value.trim()
  if (parsedText.value === input) return
  const parsed = await items.interpretItem(input)
  draft.value = { ...draft.value, ...parsed }
  labelsText.value = (parsed.labels ?? []).map((label) => `@${label}`).join(' ')
  parsedText.value = input
}

async function showAdvanced() {
  if (isSaving.value) return
  mode.value = 'advanced'
  error.value = ''
  if (text.value.trim()) {
    isSaving.value = true
    try {
      await interpret()
    } catch (failure) {
      draft.value.content = text.value.trim()
      error.value =
        failure.userMessage || 'Could not interpret the text. You can enter the details below.'
    } finally {
      isSaving.value = false
    }
  }
  await nextTick()
  titleInput.value?.focus()
}

async function submit() {
  if (!canSubmit.value) return
  isSaving.value = true
  error.value = ''
  try {
    if (mode.value === 'ai') await interpret()
    if (!draft.value.content.trim()) {
      mode.value = 'advanced'
      error.value = 'Add a task name. Your parsed details are ready below.'
      return
    }
    const task = {
      content: draft.value.content.trim(),
      projectId: draft.value.projectId ?? null,
    }
    if (draft.value.description?.trim()) task.description = draft.value.description.trim()
    if (draft.value.dueDate) task.dueDate = draft.value.dueDate
    if (draft.value.dueTime) {
      task.dueTime = draft.value.dueTime
      task.timeZone =
        draft.value.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    }
    if (draft.value.priority !== 4) task.priority = draft.value.priority
    if (draft.value.recurrence?.trim()) task.recurrence = draft.value.recurrence.trim()
    const labels = labelsText.value
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((label) => label.replace(/^@/, ''))
    if (labels.length) task.labels = labels
    const created = await items.createItem(task)
    if (created) emit('close')
    else
      error.value =
        'Could not save the task. Your details have been kept; try again or use Advanced.'
  } catch (failure) {
    error.value =
      failure.userMessage ||
      'Could not interpret that task. Try a clear name and date, or use Advanced.'
  } finally {
    isSaving.value = false
  }
}

function close() {
  if (!isSaving.value) emit('close')
}

function onKeydown(event) {
  if (event.key === 'Escape') close()
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  titleInput.value?.focus()
})
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="add-task-dialog-backdrop" @click="close">
    <div class="add-task-dialog" role="dialog" aria-modal="true" aria-label="Add task" @click.stop>
      <form class="add-task-dialog-form" @submit.prevent="submit">
        <header class="add-task-heading">
          <h2>New task</h2>
          <p v-if="mode === 'ai'">Describe the task in your own words.</p>
        </header>
        <template v-if="mode === 'ai'">
          <textarea
            ref="titleInput"
            v-model="text"
            class="add-task-dialog-input add-task-ai-input"
            aria-label="Describe your task"
            name="task-natural-language"
            placeholder="Call plumber Friday 3pm p1 #Work @home"
            maxlength="1000"
            :disabled="isSaving"
            @keydown.enter.exact.prevent="submit"
            @keydown.meta.enter.prevent="submit"
            @keydown.ctrl.enter.prevent="submit"
          ></textarea>
          <p class="add-task-hint">
            Use p1–p4, #Project and @label. Press Enter to add; Shift Enter for a new line.
          </p>
        </template>
        <div v-else class="add-task-fields">
          <label
            >Task name
            <input
              ref="titleInput"
              v-model="draft.content"
              class="add-task-dialog-input"
              aria-label="Task name"
              maxlength="500"
              :disabled="isSaving"
              required
            />
          </label>
          <label
            >Description
            <textarea
              v-model="draft.description"
              aria-label="Description"
              maxlength="10000"
              :disabled="isSaving"
            ></textarea>
          </label>
          <label
            >Project
            <select v-model="draft.projectId" aria-label="Project" :disabled="isSaving">
              <option :value="null">Inbox</option>
              <option v-for="row in projectOptions" :key="row.item.id" :value="row.item.id">
                {{ '\u00a0\u00a0'.repeat(row.depth) }}{{ row.item.name }}
              </option>
            </select>
          </label>
          <div class="add-task-schedule">
            <label
              >Due date<input
                v-model="draft.dueDate"
                type="date"
                aria-label="Due date"
                :disabled="isSaving"
                @change="!draft.dueDate && (draft.dueTime = '')"
            /></label>
            <label
              >Due time<input
                v-model="draft.dueTime"
                type="time"
                aria-label="Due time"
                :disabled="isSaving || !draft.dueDate"
            /></label>
          </div>
          <p v-if="draft.dueTime" class="add-task-time-zone">
            {{ draft.timeZone || 'Local time' }}
          </p>
          <label
            >Priority
            <select v-model="draft.priority" aria-label="Priority" :disabled="isSaving">
              <option v-for="level in PRIORITIES" :key="level.value" :value="level.value">
                {{ level.label }}
              </option>
            </select>
          </label>
          <label
            >Labels<input
              v-model="labelsText"
              aria-label="Labels"
              placeholder="@home @errands"
              :disabled="isSaving"
          /></label>
          <TaskRepeatInput v-model="draft.recurrence" :disabled="isSaving" />
        </div>
        <p v-if="error" class="add-task-error" role="alert">{{ error }}</p>
        <footer class="add-task-dialog-footer">
          <div v-if="mode === 'ai'" class="add-task-dialog-meta">
            <span class="add-task-dialog-target">
              <span class="material-symbols-outlined" aria-hidden="true">inbox</span>
              Inbox
            </span>
            <button
              type="button"
              class="add-task-advanced"
              :disabled="isSaving"
              @click="showAdvanced"
            >
              Advanced
            </button>
          </div>
          <span v-else class="add-task-dialog-target">{{
            projects.projects.find((row) => row.id === draft.projectId)?.name || 'Inbox'
          }}</span>
          <div class="add-task-dialog-actions">
            <button
              type="button"
              class="add-task-dialog-cancel"
              :disabled="isSaving"
              @click="close"
            >
              Cancel
            </button>
            <button type="submit" class="add-task-dialog-submit" :disabled="!canSubmit">
              {{ isSaving ? 'Working…' : 'Add task' }}
            </button>
          </div>
        </footer>
      </form>
    </div>
  </div>
</template>

<style scoped>
.add-task-dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.35);
}

.add-task-dialog {
  width: 100%;
  max-width: 560px;
  background: var(--bg-dialog);
  border-radius: 10px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
  max-height: calc(100dvh - 48px);
  overflow-y: auto;
}

.add-task-dialog-input {
  display: block;
  width: 100%;
  padding: 18px 20px 12px;
  font: inherit;
  font-size: 18px;
  color: inherit;
  background: transparent;
  border: none;
}

.add-task-dialog-input:focus {
  outline: none;
}

.add-task-dialog-repeat {
  padding: 0 20px 16px;
}

.add-task-dialog-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-top: 1px solid var(--border-color);
}

.add-task-dialog-target {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  color: var(--text-secondary);
}

.add-task-dialog-target .material-symbols-outlined {
  font-size: 18px;
}

.add-task-dialog-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.add-task-dialog-meta {
  display: flex;
  align-items: center;
  gap: 14px;
}

.add-task-dialog-actions button {
  padding: 6px 14px;
  font: inherit;
  font-size: 14px;
  border-radius: 6px;
  cursor: pointer;
}

.add-task-dialog-cancel {
  border: 1px solid var(--border-color);
  background: transparent;
  color: var(--text-primary);
}

.add-task-dialog-cancel:hover {
  background: var(--bg-hover);
}

.add-task-dialog-submit {
  border: 1px solid transparent;
  background: var(--accent);
  color: #fff;
}

.add-task-dialog-submit:hover:not(:disabled) {
  background: var(--accent-hover);
}

.add-task-dialog-submit:disabled {
  opacity: 0.5;
  cursor: default;
}
.add-task-heading {
  padding: 18px 20px 0;
}

.add-task-heading h2 {
  margin: 0;
  font-size: 20px;
}

.add-task-heading p,
.add-task-hint,
.add-task-time-zone {
  color: var(--text-secondary);
  font-size: 13px;
}

.add-task-heading p {
  margin: 6px 0;
}

.add-task-ai-input {
  min-height: 130px;
  resize: vertical;
}

.add-task-hint {
  margin: 0;
  padding: 0 20px 18px;
}

.add-task-fields {
  display: grid;
  gap: 12px;
  padding: 16px 20px;
}

.add-task-fields label {
  display: grid;
  gap: 5px;
  font-size: 13px;
  color: var(--text-secondary);
}

.add-task-fields input,
.add-task-fields textarea,
.add-task-fields select {
  width: 100%;
  box-sizing: border-box;
  padding: 7px 9px;
  font: inherit;
  font-size: 14px;
  color: var(--text-primary);
  background: var(--bg-dialog);
  border: 1px solid var(--border-color);
  border-radius: 6px;
}

.add-task-schedule {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.add-task-schedule label {
  min-width: 0;
}

.add-task-time-zone {
  margin: -6px 0 0;
}

.add-task-error {
  margin: 0;
  padding: 8px 20px 16px;
  color: var(--color-danger, #b42318);
  font-size: 14px;
}

.add-task-advanced {
  border: none;
  background: none;
  color: var(--text-secondary);
  font: inherit;
  cursor: pointer;
}
</style>
