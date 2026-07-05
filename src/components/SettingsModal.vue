<script setup>
import { ref, reactive, computed, watch } from 'vue'
import { useAuth } from '../composables/useAuth'
import { useInboxStore } from '../stores/inbox'

const store = useInboxStore()
const { user } = useAuth()

const isOpen = computed(() => store.activeModal === 'settings')

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
</script>

<template>
  <div class="modal-overlay" :class="{ active: isOpen }">
    <div class="modal-container settings-modal-container">
      <div class="modal-header">
        <div class="modal-title">
          <span class="material-symbols-outlined text-blue">settings</span>
          <span>Settings</span>
        </div>
        <button class="close-modal-btn" @click="store.closeTodoModal">&times;</button>
      </div>

      <div class="modal-body settings-body">
        <!-- Account -->
        <section class="settings-section">
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
        <section class="settings-section">
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
        <section class="settings-section">
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
      </div>

      <div class="modal-footer">
        <button class="btn btn-secondary" @click="store.closeTodoModal">Close</button>
      </div>
    </div>
  </div>
</template>
