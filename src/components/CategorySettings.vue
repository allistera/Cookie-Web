<script setup>
import { nextTick, reactive, ref } from 'vue'
import { useInboxStore } from '../stores/inbox'

const store = useInboxStore()

const CATEGORY_PALETTE = [
  '#e5484d',
  '#e58f1a',
  '#2f9e44',
  '#1a73e8',
  '#7048e8',
  '#d6409f',
  '#0ca678',
  '#64748b',
]

const draft = reactive({ name: '', description: '', color: CATEGORY_PALETTE[3] })
const isSaving = ref(false)
const editingId = ref(null)
const editedName = ref('')
const isRenaming = ref(false)

async function createCategory() {
  if (!draft.name.trim() || isSaving.value) return
  isSaving.value = true
  const created = await store.createCategory({
    name: draft.name.trim(),
    color: draft.color,
    description: draft.description.trim(),
  })
  if (created) {
    draft.name = ''
    draft.description = ''
    draft.color = CATEGORY_PALETTE[3]
  }
  isSaving.value = false
}

function startRename(category) {
  editingId.value = category.id
  editedName.value = category.name
  nextTick(() => document.querySelector('.category-rename-input')?.focus())
}

function cancelRename() {
  editingId.value = null
  editedName.value = ''
}

async function saveRename(category) {
  const name = editedName.value.trim()
  if (!name || isRenaming.value) return
  if (name === category.name) {
    cancelRename()
    return
  }
  isRenaming.value = true
  const renamed = await store.renameCategory(category, name)
  isRenaming.value = false
  if (renamed) cancelRename()
}
</script>

<template>
  <section class="settings-section category-settings">
    <h3 class="settings-section-title">Email categories</h3>
    <p class="settings-section-hint">
      Use Categories for a message's single primary grouping. Assigning another Category replaces
      the current one; deleting a Category clears it from its messages.
    </p>

    <div v-if="store.allCategories.length" class="category-table">
      <div class="category-table-head">
        <span>Category</span>
        <span>Description</span>
        <span></span>
      </div>
      <div v-for="category in store.allCategories" :key="category.id" class="category-table-row">
        <input
          v-if="editingId === category.id"
          v-model="editedName"
          class="label-input category-rename-input"
          maxlength="50"
          :aria-label="`Rename ${category.name}`"
          :disabled="isRenaming"
          @keydown.enter.prevent="saveRename(category)"
          @keydown.esc.prevent="cancelRename"
        />
        <span
          v-else
          class="ni-category-pill"
          :style="{ color: category.color, backgroundColor: category.color + '1f' }"
        >
          {{ category.name }}
        </span>
        <span class="label-description">{{ category.description || '—' }}</span>
        <div class="label-row-actions">
          <template v-if="editingId === category.id">
            <button
              class="ni-action-btn"
              :title="`Save ${category.name}`"
              :disabled="!editedName.trim() || isRenaming"
              @click="saveRename(category)"
            >
              <span class="material-symbols-outlined">check</span>
            </button>
            <button
              class="ni-action-btn"
              :title="`Cancel renaming ${category.name}`"
              :disabled="isRenaming"
              @click="cancelRename"
            >
              <span class="material-symbols-outlined">close</span>
            </button>
          </template>
          <template v-else>
            <button
              class="ni-action-btn"
              :title="`Rename ${category.name}`"
              @click="startRename(category)"
            >
              <span class="material-symbols-outlined">edit</span>
            </button>
            <button
              class="ni-action-btn label-delete-btn"
              :title="`Delete ${category.name}`"
              @click="store.deleteCategory(category.id)"
            >
              <span class="material-symbols-outlined">delete</span>
            </button>
          </template>
        </div>
      </div>
    </div>
    <p v-else class="settings-section-hint">No categories yet — create your first below.</p>

    <form class="label-create-form" @submit.prevent="createCategory">
      <div class="label-create-fields">
        <input
          v-model="draft.name"
          class="label-input"
          placeholder="Category name"
          maxlength="50"
        />
        <input
          v-model="draft.description"
          class="label-input label-input-desc"
          placeholder="Description (optional)"
          maxlength="200"
        />
      </div>
      <div class="label-create-actions">
        <div class="label-palette" aria-label="Category colour">
          <button
            v-for="color in CATEGORY_PALETTE"
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
        <button type="submit" class="btn btn-primary" :disabled="!draft.name.trim() || isSaving">
          Create
        </button>
      </div>
    </form>
  </section>
</template>

<style scoped>
.category-table {
  display: flex;
  flex-direction: column;
  margin-bottom: 20px;
}

.category-table-head,
.category-table-row {
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr) 68px;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border-color);
}

.category-table-head {
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}

.category-table-row .ni-category-pill {
  justify-self: start;
}

.category-table-row:hover .label-row-actions :deep(.ni-action-btn),
.label-row-actions :deep(.ni-action-btn:focus-visible) {
  opacity: 1;
}

@media (max-width: 720px) {
  .category-table {
    overflow-x: auto;
  }

  .category-table-head,
  .category-table-row {
    min-width: 520px;
  }
}
</style>
