<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'

import { useTaskItemsStore } from '../stores/taskItems'

const emit = defineEmits(['close'])

const items = useTaskItemsStore()

const title = ref('')
const titleInput = ref(null)
const isSaving = ref(false)

// Add Task is reachable from anywhere in the Tasks app, including a project
// view, so it always creates in the Inbox — the tasks that belong to no
// project. Moving it afterwards is one control in the detail panel.
async function submit() {
  // Enter fires submit while a slow create is still in flight; without the
  // latch the same task would be created twice.
  if (isSaving.value) return
  const content = title.value.trim()
  if (!content) return

  isSaving.value = true
  try {
    const created = await items.createItem({ content, projectId: null })
    // A failed create has already notified; keep the dialog and the words the
    // person typed rather than binning them.
    if (created) emit('close')
  } finally {
    isSaving.value = false
  }
}

function onKeydown(event) {
  if (event.key === 'Escape') emit('close')
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  titleInput.value?.focus()
})
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="add-task-dialog-backdrop" @click="emit('close')">
    <div class="add-task-dialog" role="dialog" aria-modal="true" aria-label="Add task" @click.stop>
      <form class="add-task-dialog-form" @submit.prevent="submit()">
        <input
          ref="titleInput"
          v-model="title"
          class="add-task-dialog-input"
          placeholder="Task name"
          aria-label="Task name"
        />

        <footer class="add-task-dialog-footer">
          <span class="add-task-dialog-target">
            <span class="material-symbols-outlined" aria-hidden="true">inbox</span>
            Inbox
          </span>

          <div class="add-task-dialog-actions">
            <button type="button" class="add-task-dialog-cancel" @click="emit('close')">
              Cancel
            </button>
            <button
              type="submit"
              class="add-task-dialog-submit"
              :disabled="!title.trim() || isSaving"
            >
              Add task
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
  overflow: hidden;
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
</style>
