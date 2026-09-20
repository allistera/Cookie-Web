<script setup>
import { nextTick, reactive, ref } from 'vue'
import { LABEL_PALETTE as CATEGORY_PALETTE } from '../lib/labelPalette'
import { useInboxStore } from '../stores/inbox'

const store = useInboxStore()

const draft = reactive({ name: '', description: '', color: CATEGORY_PALETTE[3] })
const isSaving = ref(false)
const editingId = ref(null)
const editedName = ref('')
const editedDescription = ref('')
const isUpdating = ref(false)

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

function startEdit(category) {
  editingId.value = category.id
  editedName.value = category.name
  editedDescription.value = category.description || ''
  nextTick(() => document.querySelector('.category-edit-name')?.focus())
}

function cancelEdit() {
  editingId.value = null
  editedName.value = ''
  editedDescription.value = ''
}

async function saveEdit(category) {
  const name = editedName.value.trim()
  const description = editedDescription.value.trim()
  if (!name || isUpdating.value) return
  if (name === category.name && description === (category.description || '')) {
    cancelEdit()
    return
  }
  isUpdating.value = true
  const updated = await store.updateCategory(category, { name, description })
  isUpdating.value = false
  if (updated) cancelEdit()
}

async function setNotifications(category, event) {
  const saved = await store.setCategoryNotifications(category, event.target.checked)
  if (!saved) event.target.checked = category.notifications_enabled !== false
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
        <span>Notification</span>
        <span></span>
      </div>
      <div v-for="category in store.allCategories" :key="category.id" class="category-table-row">
        <input
          v-if="editingId === category.id"
          v-model="editedName"
          class="label-input category-edit-name"
          maxlength="50"
          :aria-label="`Edit name for ${category.name}`"
          :disabled="isUpdating"
          @keydown.enter.prevent="saveEdit(category)"
          @keydown.esc.prevent="cancelEdit"
        />
        <span
          v-else
          class="ni-category-pill"
          :style="{ color: category.color, backgroundColor: category.color + '1f' }"
        >
          {{ category.name }}
        </span>
        <input
          v-if="editingId === category.id"
          v-model="editedDescription"
          class="label-input category-edit-description"
          maxlength="200"
          placeholder="Description (optional)"
          :aria-label="`Edit description for ${category.name}`"
          :disabled="isUpdating"
          @keydown.enter.prevent="saveEdit(category)"
          @keydown.esc.prevent="cancelEdit"
        />
        <span v-else class="label-description">{{ category.description || '—' }}</span>
        <input
          type="checkbox"
          class="category-notification-checkbox"
          :checked="category.notifications_enabled !== false"
          :aria-label="`Notifications for ${category.name}`"
          :disabled="store.categoryNotificationSavingIds.has(category.id)"
          @change="setNotifications(category, $event)"
        />
        <div class="label-row-actions">
          <template v-if="editingId === category.id">
            <button
              class="ni-action-btn"
              :title="`Save ${category.name}`"
              :disabled="!editedName.trim() || isUpdating"
              @click="saveEdit(category)"
            >
              <span class="material-symbols-outlined">check</span>
            </button>
            <button
              class="ni-action-btn"
              :title="`Cancel editing ${category.name}`"
              :disabled="isUpdating"
              @click="cancelEdit"
            >
              <span class="material-symbols-outlined">close</span>
            </button>
          </template>
          <template v-else>
            <button
              class="ni-action-btn"
              :title="`Edit ${category.name}`"
              @click="startEdit(category)"
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
  grid-template-columns: 150px minmax(0, 1fr) 92px 68px;
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

.category-notification-checkbox {
  justify-self: start;
}

.category-table-row:hover .label-row-actions :deep(.ni-action-btn),
.label-row-actions :deep(.ni-action-btn:focus-visible) {
  opacity: 1;
}

@media (max-width: 720px) {
  .category-table {
    overflow-x: visible;
  }

  .category-table-head,
  .category-table-row {
    grid-template-columns: minmax(88px, 0.8fr) minmax(112px, 1.2fr) 92px 68px;
    gap: 8px;
    min-width: 0;
  }
}
</style>
