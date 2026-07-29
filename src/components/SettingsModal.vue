<script setup>
import { ref, reactive, computed, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth'
import { useInboxStore } from '../stores/inbox'
import {
  browserNotificationPermission,
  browserNotificationsEnabled,
  browserNotificationsSupported,
  requestBrowserNotificationPermission,
  saveBrowserNotificationsEnabled,
} from '../lib/browserNotifications'
import { getStoredTheme, setTheme } from '../lib/theme'
import { plainTextToHtml } from '../lib/composeHtml'
import { normalizeSnippetName, snippetNameIsReserved } from '../lib/snippets'
import ComposerEditor from './ComposerEditor.vue'

const store = useInboxStore()
const { user } = useAuth()
const route = useRoute()
const router = useRouter()

const isOpen = computed(() => store.activeModal === 'settings')

// --- Category navigation ---
const sections = [
  { id: 'account', label: 'Account', icon: 'person' },
  { id: 'appearance', label: 'Appearance', icon: 'palette' },
  { id: 'signature', label: 'Signature', icon: 'draw' },
  { id: 'snippets', label: 'Snippets', icon: 'bookmark' },
  { id: 'notifications', label: 'Notifications', icon: 'notifications' },
  { id: 'labels', label: 'Labels', icon: 'label' },
  { id: 'rules', label: 'Rules', icon: 'rule' },
]
const activeSection = ref('account')

watch(
  isOpen,
  (open) => {
    if (open) {
      activeSection.value = 'account'
      store.loadLabels()
      store.loadRules()
    }
  },
  { immediate: true },
)

// --- Compose snippets (persisted locally through the inbox store) ---
const snippetDraft = reactive({ name: '', html: '' })
const editingSnippetId = ref(null)
const snippetError = ref('')
const aiSnippetInstruction = ref('')
const isGeneratingSnippet = ref(false)

function resetSnippetDraft() {
  snippetDraft.name = ''
  snippetDraft.html = ''
  editingSnippetId.value = null
  snippetError.value = ''
}

function editSnippet(snippet) {
  snippetDraft.name = snippet.name
  snippetDraft.html = snippet.html
  editingSnippetId.value = snippet.id
  snippetError.value = ''
}

function saveSnippet() {
  const name = normalizeSnippetName(snippetDraft.name)
  if (!name || !snippetDraft.html.trim()) {
    snippetError.value = 'Give the snippet a name and content.'
    return
  }
  if (snippetNameIsReserved(name)) {
    snippetError.value = `/${name} is already a built-in command.`
    return
  }
  if (store.snippets.some((snippet) => snippet.name === name && snippet.id !== editingSnippetId.value)) {
    snippetError.value = `/${name} already exists.`
    return
  }
  const id = editingSnippetId.value || globalThis.crypto?.randomUUID?.() || `snippet-${Date.now()}`
  store.setSnippets([...store.snippets.filter((snippet) => snippet.id !== id), { id, name, html: snippetDraft.html }])
  resetSnippetDraft()
}

function deleteSnippet(id) {
  store.setSnippets(store.snippets.filter((snippet) => snippet.id !== id))
  if (editingSnippetId.value === id) resetSnippetDraft()
}

async function generateSnippet() {
  if (!aiSnippetInstruction.value.trim() || isGeneratingSnippet.value) return
  isGeneratingSnippet.value = true
  const snippet = await store.requestAiSnippet(aiSnippetInstruction.value)
  isGeneratingSnippet.value = false
  if (!snippet) return
  snippetDraft.name = snippet.name
  snippetDraft.html = plainTextToHtml(snippet.text)
  editingSnippetId.value = null
  snippetError.value = ''
}

// --- Appearance ---
const theme = ref(getStoredTheme())

function onThemeChange(event) {
  theme.value = event.target.value
  setTheme(theme.value)
}

const notificationOwnerId = computed(() => store.userId)
const browserPermission = ref(browserNotificationPermission())
const browserNotificationsOn = ref(false)
const isRequestingBrowserPermission = ref(false)

function syncBrowserNotificationPreference() {
  browserPermission.value = browserNotificationPermission()
  browserNotificationsOn.value =
    browserPermission.value === 'granted' && browserNotificationsEnabled(notificationOwnerId.value)
}

watch(notificationOwnerId, syncBrowserNotificationPreference, { immediate: true })
watch(isOpen, (open) => {
  if (open) syncBrowserNotificationPreference()
})

const browserNotificationStatus = computed(() => {
  if (!browserNotificationsSupported()) return 'Browser notifications are not supported here.'
  if (browserPermission.value === 'denied') {
    return 'Notifications are blocked. Allow them in your browser site settings to enable this.'
  }
  if (browserNotificationsOn.value) {
    return 'Cookie will show the sender and subject when new mail arrives in a background tab.'
  }
  return 'Show the sender and subject when new mail arrives while Cookie is open in the background.'
})

async function toggleBrowserNotifications(event) {
  const enabled = event.target.checked
  if (!enabled) {
    browserNotificationsOn.value = false
    saveBrowserNotificationsEnabled(notificationOwnerId.value, false)
    return
  }

  isRequestingBrowserPermission.value = true
  let permission = browserNotificationPermission()
  try {
    permission = await requestBrowserNotificationPermission()
  } catch (error) {
    console.error('Failed to request browser notification permission:', error)
  } finally {
    isRequestingBrowserPermission.value = false
  }
  browserPermission.value = permission
  browserNotificationsOn.value = permission === 'granted'
  event.target.checked = browserNotificationsOn.value
  saveBrowserNotificationsEnabled(notificationOwnerId.value, browserNotificationsOn.value)
}

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

// --- Tag rules ---
const RULE_FIELDS = [
  { value: 'subject', label: 'Subject' },
  { value: 'body', label: 'Body' },
  { value: 'from', label: 'From' },
  { value: 'to', label: 'To' },
]
const RULE_OPERATORS = [
  { value: 'contains', label: 'contains' },
  { value: 'equals', label: 'equals' },
  { value: 'starts_with', label: 'starts with' },
  { value: 'ends_with', label: 'ends with' },
]

function blankCondition() {
  return { field: 'subject', operator: 'contains', value: '' }
}

function blankRuleDraft() {
  return {
    name: '',
    label_id: '',
    match_type: 'all',
    conditions: [blankCondition()],
  }
}

const ruleDraft = reactive(blankRuleDraft())
const isSavingRule = ref(false)
const editingRuleId = ref(null)
const ruleError = ref('')

const userLabels = computed(() => store.labels.filter((label) => label.kind === 'user'))

function addRuleCondition() {
  ruleDraft.conditions.push(blankCondition())
}

function removeRuleCondition(index) {
  if (ruleDraft.conditions.length <= 1) return
  ruleDraft.conditions.splice(index, 1)
}

function resetRuleDraft() {
  Object.assign(ruleDraft, blankRuleDraft())
  ruleDraft.conditions = [blankCondition()]
  editingRuleId.value = null
  ruleError.value = ''
}

function editRule(rule) {
  ruleDraft.name = rule.name || ''
  ruleDraft.label_id = rule.label_id
  ruleDraft.match_type = rule.match_type
  ruleDraft.conditions = rule.conditions.map((condition) => ({ ...condition }))
  editingRuleId.value = rule.id
  ruleError.value = ''
  nextTick(() => document.querySelector('.rule-editor-form')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
}

async function submitRule() {
  if (isSavingRule.value) return
  if (!ruleDraft.label_id) {
    ruleError.value = 'Choose a label to apply.'
    return
  }
  const conditions = ruleDraft.conditions
    .map((condition) => ({ ...condition, value: condition.value.trim() }))
    .filter((condition) => condition.value)
  if (conditions.length === 0) {
    ruleError.value = 'Add at least one condition with a value.'
    return
  }

  isSavingRule.value = true
  const payload = {
    name: ruleDraft.name.trim() || null,
    label_id: ruleDraft.label_id,
    match_type: ruleDraft.match_type,
    conditions,
  }

  let ok
  if (editingRuleId.value) {
    const rule = store.rules.find((r) => r.id === editingRuleId.value)
    ok = rule ? await store.updateRule(rule, payload) : false
  } else {
    ok = Boolean(await store.createRule(payload))
  }

  isSavingRule.value = false
  if (ok) resetRuleDraft()
  else ruleError.value = 'Failed to save the rule.'
}

function labelName(labelId) {
  return store.labels.find((label) => label.id === labelId)?.name || 'Unknown label'
}

function fieldLabel(field) {
  return RULE_FIELDS.find((f) => f.value === field)?.label || field
}

function operatorLabel(operator) {
  return RULE_OPERATORS.find((o) => o.value === operator)?.label || operator
}

function toggleRuleEnabled(rule) {
  store.updateRule(rule, { enabled: !rule.enabled })
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
                <span>Theme</span>
                <small>Choose light, dark, or match your system</small>
              </div>
              <select class="settings-select" :value="theme" @change="onThemeChange">
                <option value="light">Light</option>
                <option value="dark">Dark</option>
                <option value="system">System</option>
              </select>
            </label>
          </section>

          <!-- Signature -->
          <section v-if="activeSection === 'signature'" class="settings-section">
            <h3 class="settings-section-title">Signature</h3>
            <p class="settings-signature-hint">
              Added to the bottom of new emails you compose. Type “/” for formatting.
            </p>
            <div class="settings-signature-editor">
              <ComposerEditor
                :model-value="store.signatureHtml"
                :hide-generate="true"
                placeholder="Your signature…"
                @update:model-value="store.setSignature($event)"
              />
            </div>
          </section>

          <!-- Compose snippets -->
          <section v-if="activeSection === 'snippets'" class="settings-section">
            <h3 class="settings-section-title">Compose snippets</h3>
            <p class="settings-section-hint">
              Reusable templates stored on this device. In a new email, type a trigger such as “/hello-world” and choose it from the menu.
            </p>

            <div v-if="store.snippets.length" class="snippet-list">
              <div v-for="snippet in store.snippets" :key="snippet.id" class="snippet-row">
                <span class="snippet-trigger">/{{ snippet.name }}</span>
                <div class="label-row-actions">
                  <button class="ni-action-btn" :title="`Edit /${snippet.name}`" @click="editSnippet(snippet)">
                    <span class="material-symbols-outlined">edit</span>
                  </button>
                  <button class="ni-action-btn label-delete-btn" :title="`Delete /${snippet.name}`" @click="deleteSnippet(snippet.id)">
                    <span class="material-symbols-outlined">delete</span>
                  </button>
                </div>
              </div>
            </div>

            <div class="snippet-ai-row">
              <input
                v-model="aiSnippetInstruction"
                class="label-input"
                maxlength="1000"
                placeholder="Describe a template for Cookie AI to draft…"
                @keydown.enter.prevent="generateSnippet"
              />
              <button class="btn btn-secondary" :disabled="!aiSnippetInstruction.trim() || isGeneratingSnippet" @click="generateSnippet">
                {{ isGeneratingSnippet ? 'Drafting…' : 'Generate with AI' }}
              </button>
            </div>

            <form class="snippet-editor-form" @submit.prevent="saveSnippet">
              <input v-model="snippetDraft.name" class="label-input" maxlength="50" placeholder="Trigger, e.g. hello-world" />
              <div class="settings-signature-editor snippet-editor">
                <ComposerEditor
                  :model-value="snippetDraft.html"
                  :hide-generate="true"
                  placeholder="Write your reusable template…"
                  @update:model-value="snippetDraft.html = $event"
                />
              </div>
              <p v-if="snippetError" class="snippet-error" role="alert">{{ snippetError }}</p>
              <div class="label-create-actions">
                <button v-if="editingSnippetId" type="button" class="btn btn-secondary" @click="resetSnippetDraft">Cancel</button>
                <button type="submit" class="btn btn-primary">{{ editingSnippetId ? 'Save snippet' : 'Add snippet' }}</button>
              </div>
            </form>
          </section>

          <!-- Notifications -->
          <section v-if="activeSection === 'notifications'" class="settings-section">
            <h3 class="settings-section-title">Notifications</h3>
            <label class="settings-row">
              <div class="settings-row-text">
                <span>Browser notifications</span>
                <small class="browser-notifications-status">{{ browserNotificationStatus }}</small>
              </div>
              <input
                type="checkbox"
                class="settings-switch browser-notifications-switch"
                :checked="browserNotificationsOn"
                :disabled="
                  isRequestingBrowserPermission ||
                  !notificationOwnerId ||
                  browserPermission === 'denied' ||
                  browserPermission === 'unsupported'
                "
                @change="toggleBrowserNotifications"
              />
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

          <!-- Rules -->
          <section v-if="activeSection === 'rules'" class="settings-section">
            <h3 class="settings-section-title">Rules</h3>
            <p class="settings-section-hint">
              Automatically apply a tag to new mail that matches conditions on subject, body, from, or to. Rules run when mail arrives, before AI auto-tagging.
            </p>

            <div class="rule-list" v-if="store.rules.length">
              <div class="rule-row" v-for="rule in store.rules" :key="rule.id">
                <div class="rule-row-main">
                  <span class="rule-row-name">{{ rule.name || 'Untitled rule' }}</span>
                  <span
                    class="ni-label-pill"
                    :style="{
                      color: store.labels.find((l) => l.id === rule.label_id)?.color,
                      backgroundColor: (store.labels.find((l) => l.id === rule.label_id)?.color || '#64748b') + '1f',
                    }"
                  >
                    {{ labelName(rule.label_id) }}
                  </span>
                  <span class="rule-row-summary">
                    {{ rule.match_type === 'any' ? 'Any of' : 'All of' }}:
                    {{ rule.conditions.map((c) => `${fieldLabel(c.field)} ${operatorLabel(c.operator)} "${c.value}"`).join(rule.match_type === 'any' ? ' · or ' : ' · and ') }}
                  </span>
                </div>
                <div class="rule-row-actions">
                  <input
                    type="checkbox"
                    class="settings-switch"
                    :aria-label="`Enable ${rule.name || 'rule'}`"
                    :checked="rule.enabled"
                    @change="toggleRuleEnabled(rule)"
                  />
                  <div class="label-row-actions">
                    <button class="ni-action-btn" :title="`Edit ${rule.name || 'rule'}`" @click="editRule(rule)">
                      <span class="material-symbols-outlined">edit</span>
                    </button>
                    <button
                      class="ni-action-btn label-delete-btn"
                      :title="`Delete ${rule.name || 'rule'}`"
                      @click="store.deleteRule(rule.id)"
                    >
                      <span class="material-symbols-outlined">delete</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <p v-else class="settings-section-hint">No rules yet — create your first below.</p>

            <form class="rule-editor-form" @submit.prevent="submitRule">
              <input
                v-model="ruleDraft.name"
                class="label-input"
                maxlength="100"
                placeholder="Rule name (optional)"
              />

              <div class="rule-condition-row" v-for="(condition, index) in ruleDraft.conditions" :key="index">
                <select class="settings-select" v-model="condition.field">
                  <option v-for="field in RULE_FIELDS" :key="field.value" :value="field.value">{{ field.label }}</option>
                </select>
                <select class="settings-select" v-model="condition.operator">
                  <option v-for="operator in RULE_OPERATORS" :key="operator.value" :value="operator.value">{{ operator.label }}</option>
                </select>
                <input v-model="condition.value" class="label-input" maxlength="200" placeholder="Value" />
                <button
                  type="button"
                  class="ni-action-btn label-delete-btn"
                  title="Remove condition"
                  :disabled="ruleDraft.conditions.length <= 1"
                  @click="removeRuleCondition(index)"
                >
                  <span class="material-symbols-outlined">close</span>
                </button>
              </div>
              <button type="button" class="btn btn-secondary rule-add-condition-btn" @click="addRuleCondition">
                + Add condition
              </button>

              <div class="rule-create-fields">
                <label class="settings-row">
                  <span>Match</span>
                  <select class="settings-select" v-model="ruleDraft.match_type">
                    <option value="all">All conditions</option>
                    <option value="any">Any condition</option>
                  </select>
                </label>
                <label class="settings-row">
                  <span>Apply label</span>
                  <select class="settings-select" v-model="ruleDraft.label_id">
                    <option value="" disabled>Choose a label</option>
                    <option v-for="label in userLabels" :key="label.id" :value="label.id">{{ label.name }}</option>
                  </select>
                </label>
              </div>

              <p v-if="ruleError" class="snippet-error" role="alert">{{ ruleError }}</p>
              <div class="label-create-actions">
                <button v-if="editingRuleId" type="button" class="btn btn-secondary" @click="resetRuleDraft">Cancel</button>
                <button type="submit" class="btn btn-primary" :disabled="isSavingRule">
                  {{ editingRuleId ? 'Save rule' : 'Add rule' }}
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
