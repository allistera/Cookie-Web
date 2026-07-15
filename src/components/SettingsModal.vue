<script setup>
import { ref, reactive, computed, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth'
import { useInboxStore } from '../stores/inbox'

const store = useInboxStore()
const { user } = useAuth()
const route = useRoute()
const router = useRouter()

const isOpen = computed(() => store.activeModal === 'settings')

// --- Category navigation ---
const sections = [
  { id: 'account', label: 'Account', icon: 'person' },
  { id: 'appearance', label: 'Appearance', icon: 'palette' },
  { id: 'notifications', label: 'Notifications', icon: 'notifications' },
  { id: 'labels', label: 'Labels', icon: 'label' },
]
const activeSection = ref('account')

watch(
  isOpen,
  (open) => {
    if (open) {
      activeSection.value = 'account'
      store.loadLabels()
    }
  },
  { immediate: true },
)

// --- Appearance ---
const isDarkMode = ref(document.documentElement.getAttribute('data-theme') === 'dark')

function toggleDarkMode() {
  store.toggleTheme()
  isDarkMode.value = document.documentElement.getAttribute('data-theme') === 'dark'
}

// --- Notification preferences (persisted locally) ---
const PREFS_KEY = 'cookie-settings-prefs'

const defaultPrefs = {
  emailSummaries: true,
  todoReminders: true,
  aiSuggestions: true,
}

function loadPrefs() {
  try {
    return { ...defaultPrefs, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }
  } catch {
    return { ...defaultPrefs }
  }
}

const prefs = reactive(loadPrefs())

watch(prefs, (val) => {
  localStorage.setItem(PREFS_KEY, JSON.stringify(val))
})

// --- Labels ---
const LABEL_PALETTE = [
  '#e5484d',
  '#e58f1a',
  '#2f9e44',
  '#1a73e8',
  '#7048e8',
  '#d6409f',
  '#0ca678',
  '#64748b',
]

const newLabel = reactive({ name: '', description: '', color: LABEL_PALETTE[3] })
const isSavingLabel = ref(false)
const editingLabelId = ref(null)
const editedLabelName = ref('')
const isRenamingLabel = ref(false)

async function submitLabel() {
  if (!newLabel.name.trim() || isSavingLabel.value) return
  isSavingLabel.value = true
  const created = await store.createLabel({
    name: newLabel.name.trim(),
    color: newLabel.color,
    description: newLabel.description.trim(),
  })
  if (created) {
    newLabel.name = ''
    newLabel.description = ''
    newLabel.color = LABEL_PALETTE[3]
  }
  isSavingLabel.value = false
}

function startRenamingLabel(label) {
  editingLabelId.value = label.id
  editedLabelName.value = label.name
  nextTick(() => document.querySelector('.label-rename-input')?.focus())
}

function cancelRenamingLabel() {
  editingLabelId.value = null
  editedLabelName.value = ''
}

async function submitLabelRename(label) {
  const name = editedLabelName.value.trim()
  if (!name || isRenamingLabel.value) return
  if (name === label.name) {
    cancelRenamingLabel()
    return
  }

  const previousName = label.name
  isRenamingLabel.value = true
  const renamed = await store.renameLabel(label, name)
  isRenamingLabel.value = false

  if (renamed) {
    if (route.query.filter === 'label' && route.query.label === previousName) {
      await router.replace({ query: { ...route.query, label: name } })
    }
    cancelRenamingLabel()
  }
}
</script>

<template>
  <div class="modal-overlay" :class="{ active: isOpen }">
    <div class="modal-container settings-modal-container">
      <div class="modal-header">
        <div class="modal-title">
          <span class="material-symbols-outlined text-blue">settings</span>
          <span>Settings</span>
        </div>
        <button class="close-modal-btn" @click="store.activeModal = null">&times;</button>
      </div>

      <div class="modal-body settings-body settings-layout">
        <!-- Category sidebar -->
        <nav class="settings-nav">
          <button
            v-for="section in sections"
            :key="section.id"
            class="settings-nav-item"
            :class="{ active: activeSection === section.id }"
            @click="activeSection = section.id"
          >
            <span class="material-symbols-outlined">{{ section.icon }}</span>
            <span>{{ section.label }}</span>
          </button>
        </nav>

        <!-- Panes -->
        <div class="settings-pane">
          <!-- Account -->
          <section v-if="activeSection === 'account'" class="settings-section">
            <h3 class="settings-section-title">Account</h3>
            <div class="settings-account-row">
              <img :src="user?.picture || '/rose_avatar.jpg'" :alt="user?.name" class="settings-avatar" />
              <div class="settings-account-info">
                <span class="settings-account-name">{{ user?.name || 'Allister' }}</span>
                <span class="settings-account-email">{{ user?.email || '' }}</span>
                <span class="settings-account-provider">Signed in with Google via Auth0</span>
              </div>
            </div>
          </section>

          <!-- Appearance -->
          <section v-if="activeSection === 'appearance'" class="settings-section">
            <h3 class="settings-section-title">Appearance</h3>
            <label class="settings-row">
              <div class="settings-row-text">
                <span>Dark mode</span>
                <small>Switch between light and dark themes</small>
              </div>
              <input type="checkbox" class="settings-switch" :checked="isDarkMode" @change="toggleDarkMode" />
            </label>
          </section>

          <!-- Notifications -->
          <section v-if="activeSection === 'notifications'" class="settings-section">
            <h3 class="settings-section-title">Notifications</h3>
            <label class="settings-row">
              <div class="settings-row-text">
                <span>Email summaries</span>
                <small>Daily digest of new mail and topics</small>
              </div>
              <input type="checkbox" class="settings-switch" v-model="prefs.emailSummaries" />
            </label>
            <label class="settings-row">
              <div class="settings-row-text">
                <span>To-do reminders</span>
                <small>Nudges when suggested to-dos are due</small>
              </div>
              <input type="checkbox" class="settings-switch" v-model="prefs.todoReminders" />
            </label>
            <label class="settings-row">
              <div class="settings-row-text">
                <span>AI suggestions</span>
                <small>Let Gemini surface suggested questions</small>
              </div>
              <input type="checkbox" class="settings-switch" v-model="prefs.aiSuggestions" />
            </label>
          </section>

          <!-- Labels -->
          <section v-if="activeSection === 'labels'" class="settings-section">
            <h3 class="settings-section-title">Labels</h3>
            <p class="settings-section-hint">
              Cookie AI uses enabled label descriptions to auto-tag new mail. Deleting a label removes it from every message.
            </p>

            <div class="label-table" v-if="store.labels.length">
              <div class="label-table-head">
                <span>Label</span>
                <span>Description</span>
                <span>Auto-tag</span>
                <span></span>
              </div>
              <div class="label-table-row" v-for="label in store.labels" :key="label.id">
                <input
                  v-if="editingLabelId === label.id"
                  v-model="editedLabelName"
                  class="label-input label-rename-input"
                  maxlength="50"
                  :aria-label="`Rename ${label.name}`"
                  :disabled="isRenamingLabel"
                  @keydown.enter.prevent="submitLabelRename(label)"
                  @keydown.esc.prevent="cancelRenamingLabel"
                />
                <span
                  v-else
                  class="ni-label-pill"
                  :style="{ color: label.color, backgroundColor: label.color + '1f' }"
                >
                  {{ label.name }}
                </span>
                <span class="label-description">{{ label.description || '—' }}</span>
                <input
                  v-if="label.kind === 'user'"
                  type="checkbox"
                  class="settings-switch label-auto-tag-switch"
                  :aria-label="`Auto-tag ${label.name}`"
                  :checked="label.auto_apply"
                  @change="store.setLabelAutoApply(label, $event.target.checked)"
                />
                <span v-else class="label-system-note">System</span>
                <div v-if="label.kind === 'user'" class="label-row-actions">
                  <template v-if="editingLabelId === label.id">
                    <button
                      class="ni-action-btn label-save-btn"
                      :title="`Save ${label.name}`"
                      :disabled="!editedLabelName.trim() || isRenamingLabel"
                      @click="submitLabelRename(label)"
                    >
                      <span class="material-symbols-outlined">check</span>
                    </button>
                    <button
                      class="ni-action-btn label-cancel-btn"
                      :title="`Cancel renaming ${label.name}`"
                      :disabled="isRenamingLabel"
                      @click="cancelRenamingLabel"
                    >
                      <span class="material-symbols-outlined">close</span>
                    </button>
                  </template>
                  <template v-else>
                    <button
                      class="ni-action-btn label-edit-btn"
                      :title="`Rename ${label.name}`"
                      @click="startRenamingLabel(label)"
                    >
                      <span class="material-symbols-outlined">edit</span>
                    </button>
                    <button
                      class="ni-action-btn label-delete-btn"
                      :title="`Delete ${label.name}`"
                      @click="store.deleteLabel(label.id)"
                    >
                      <span class="material-symbols-outlined">delete</span>
                    </button>
                  </template>
                </div>
              </div>
            </div>
            <p v-else class="settings-section-hint">No labels yet — create your first below.</p>

            <form class="label-create-form" @submit.prevent="submitLabel">
              <div class="label-create-fields">
                <input
                  v-model="newLabel.name"
                  class="label-input"
                  placeholder="Label name"
                  maxlength="50"
                />
                <input
                  v-model="newLabel.description"
                  class="label-input label-input-desc"
                  placeholder="Description (optional)"
                  maxlength="200"
                />
              </div>
              <div class="label-create-actions">
                <div class="label-palette">
                  <button
                    v-for="color in LABEL_PALETTE"
                    :key="color"
                    type="button"
                    class="label-color-swatch"
                    :class="{ selected: newLabel.color === color }"
                    :style="{ backgroundColor: color }"
                    :title="color"
                    @click="newLabel.color = color"
                  ></button>
                </div>
                <button
                  type="submit"
                  class="btn btn-primary"
                  :disabled="!newLabel.name.trim() || isSavingLabel"
                >
                  Create
                </button>
              </div>
            </form>
          </section>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn btn-secondary" @click="store.activeModal = null">Close</button>
      </div>
    </div>
  </div>
</template>
