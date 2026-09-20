<script setup>
import { nextTick, onMounted, reactive, ref } from 'vue'

import { DEFAULT_LABEL_COLOR, LABEL_PALETTE } from '../lib/labelPalette'
import { labelChipStyle, normalizeLabelName } from '../lib/taskLabels'
import { useTaskLabelsStore } from '../stores/taskLabels'

// Settings > Tasks > Task Labels. The same store the Tasks sidebar edits,
// laid out like the email Categories page: a table of what exists, a
// create form beneath it. Rename and recolour are one inline edit per row.
const store = useTaskLabelsStore()
onMounted(() => store.loadLabels())

const draft = reactive({ name: '', color: LABEL_PALETTE[3] })
const isSaving = ref(false)
const editingId = ref(null)
const editedName = ref('')
const editedColor = ref(DEFAULT_LABEL_COLOR)
const isUpdating = ref(false)

async function createLabel() {
  const name = normalizeLabelName(draft.name)
  if (!name || isSaving.value) return
  isSaving.value = true
  const created = await store.createLabel({ name, color: draft.color })
  if (created) {
    draft.name = ''
    draft.color = LABEL_PALETTE[3]
  }
  isSaving.value = false
}

function startEdit(label) {
  editingId.value = label.id
  editedName.value = label.name
  editedColor.value = label.color
  nextTick(() => document.querySelector('.task-label-edit-name')?.focus())
}

function cancelEdit() {
  editingId.value = null
}

async function saveEdit(label) {
  const name = normalizeLabelName(editedName.value)
  if (!name || isUpdating.value) return
  isUpdating.value = true
  try {
    if (name !== label.name) {
      const renamed = await store.renameLabel(label.id, name)
      if (!renamed) return
    }
    if (editedColor.value !== label.color) {
      const recoloured = await store.recolourLabel(label.id, editedColor.value)
      if (!recoloured) return
    }
    editingId.value = null
  } finally {
    isUpdating.value = false
  }
}

// Deleting strips the label from every task that carries it, so the count
// is named first. A label on no task just goes.
async function removeLabel(label) {
  if (label.taskCount) {
    const plural = label.taskCount === 1 ? 'task' : 'tasks'
    if (!confirm(`Remove @${label.name} from ${label.taskCount} ${plural} and delete it?`)) return
  }
  await store.deleteLabel(label.id)
}

function countText(label) {
  if (!label.taskCount) return 'No tasks'
  return `${label.taskCount} ${label.taskCount === 1 ? 'task' : 'tasks'}`
}
</script>

<template>
  <section class="settings-section task-label-settings">
    <h3 class="settings-section-title">Task labels</h3>
    <p class="settings-section-hint">
      Labels tag tasks across projects. Renaming or recolouring a label changes it on every task;
      deleting a label removes it from its tasks.
    </p>

    <div v-if="store.labels.length" class="task-label-table">
      <div class="task-label-table-head">
        <span>Label</span>
        <span>Tasks</span>
        <span></span>
      </div>
      <div v-for="label in store.labels" :key="label.id" class="task-label-table-row">
        <div v-if="editingId === label.id" class="task-label-edit">
          <input
            v-model="editedName"
            class="label-input task-label-edit-name"
            maxlength="40"
            :aria-label="`Edit name for ${label.name}`"
            :disabled="isUpdating"
            @keydown.enter.prevent="saveEdit(label)"
            @keydown.esc.prevent="cancelEdit"
          />
          <div class="label-palette" role="group" :aria-label="`Colour for ${label.name}`">
            <button
              v-for="color in LABEL_PALETTE"
              :key="color"
              type="button"
              class="label-color-swatch"
              :class="{ selected: editedColor === color }"
              :style="{ backgroundColor: color }"
              :title="color"
              :aria-label="`Use ${color}`"
              :disabled="isUpdating"
              @click="editedColor = color"
            ></button>
          </div>
        </div>
        <span v-else class="ni-category-pill task-label-pill" :style="labelChipStyle(label.color)">
          @{{ label.name }}
        </span>
        <span class="task-label-count">{{ countText(label) }}</span>
        <div class="label-row-actions">
          <template v-if="editingId === label.id">
            <button
              class="ni-action-btn"
              :title="`Save ${label.name}`"
              :aria-label="`Save ${label.name}`"
              :disabled="!normalizeLabelName(editedName) || isUpdating"
              @click="saveEdit(label)"
            >
              <span class="material-symbols-outlined">check</span>
            </button>
            <button
              class="ni-action-btn"
              :title="`Cancel editing ${label.name}`"
              :aria-label="`Cancel editing ${label.name}`"
              :disabled="isUpdating"
              @click="cancelEdit"
            >
              <span class="material-symbols-outlined">close</span>
            </button>
          </template>
          <template v-else>
            <button
              class="ni-action-btn"
              :title="`Edit ${label.name}`"
              :aria-label="`Edit ${label.name}`"
              @click="startEdit(label)"
            >
              <span class="material-symbols-outlined">edit</span>
            </button>
            <button
              class="ni-action-btn label-delete-btn"
              :title="`Delete ${label.name}`"
              :aria-label="`Delete label ${label.name}`"
              @click="removeLabel(label)"
            >
              <span class="material-symbols-outlined">delete</span>
            </button>
          </template>
        </div>
      </div>
    </div>
    <p v-else class="settings-section-hint">No labels yet — create your first below.</p>

    <form class="label-create-form" @submit.prevent="createLabel">
      <div class="label-create-fields">
        <input
          v-model="draft.name"
          class="label-input"
          placeholder="Label name"
          aria-label="New label name"
          maxlength="40"
        />
      </div>
      <div class="label-create-actions">
        <div class="label-palette" role="group" aria-label="Label colour">
          <button
            v-for="color in LABEL_PALETTE"
            :key="color"
            type="button"
            class="label-color-swatch"
            :class="{ selected: draft.color === color }"
            :style="{ backgroundColor: color }"
            :title="color"
            :aria-label="`Use ${color}`"
            @click="draft.color = color"
          ></button>
        </div>
        <button
          type="submit"
          class="btn btn-primary"
          :disabled="!normalizeLabelName(draft.name) || isSaving"
        >
          Create
        </button>
      </div>
    </form>
  </section>
</template>

<style scoped>
.task-label-table {
  display: flex;
  flex-direction: column;
  margin-bottom: 20px;
}

.task-label-table-head,
.task-label-table-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 90px 68px;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border-color);
}

.task-label-table-head {
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}

.task-label-pill {
  justify-self: start;
}

.task-label-count {
  color: var(--text-secondary);
  font-size: 13px;
}

.task-label-edit {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.task-label-edit-name {
  max-width: 180px;
}

.task-label-table-row:hover .label-row-actions :deep(.ni-action-btn),
.label-row-actions :deep(.ni-action-btn:focus-visible) {
  opacity: 1;
}
</style>
