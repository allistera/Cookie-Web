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
import { settingsSectionGroups, settingsSections } from '../lib/settingsSections'
import { getStoredTheme, setTheme } from '../lib/theme'
import { plainTextToHtml } from '../lib/composeHtml'
import { normalizeSnippetName, snippetNameIsReserved } from '../lib/snippets'
import CalendarSettings from '../components/CalendarSettings.vue'
import ComposerEditor from '../components/ComposerEditor.vue'
import DocumentTemplateSettings from '../components/DocumentTemplateSettings.vue'
import DailyNoteSettings from '../components/DailyNoteSettings.vue'
import AutoArchiveSettings from '../components/AutoArchiveSettings.vue'

const store = useInboxStore()
const { user } = useAuth()
const route = useRoute()
const router = useRouter()

const sectionGroups = settingsSectionGroups
const sections = settingsSections
const settingsSearch = ref('')
const activeSection = computed(() => {
  const requested = String(route.params.section || '')
  return sections.some((section) => section.id === requested) ? requested : 'account'
})
const activeSectionLabel = computed(
  () => sections.find((section) => section.id === activeSection.value)?.label || 'Account',
)
const filteredSectionGroups = computed(() => {
  const query = settingsSearch.value.trim().toLowerCase()
  if (!query) return sectionGroups
  return sectionGroups
    .map((group) => ({
      ...group,
      sections: group.sections.filter((section) => section.label.toLowerCase().includes(query)),
    }))
    .filter((group) => group.sections.length)
})

watch(
  () => route.params.section,
  (section) => {
    if (!sections.some((candidate) => candidate.id === section)) {
      router.replace({ name: 'settings', params: { section: 'account' } })
    }
  },
  { immediate: true },
)

store.loadLabels()
store.loadRules()
store.loadInterests()
store.loadSpamRetention()

// --- Personalisation (server-side: the enricher Worker reads these) ---
const interestDraft = ref('')
const interestError = ref('')
const isSavingInterests = ref(false)

// Every edit writes the whole list straight through, so the overnight run can
// never use a list the user believes they changed.
async function persistInterests(next) {
  interestError.value = ''
  isSavingInterests.value = true
  try {
    await store.saveInterests(next)
  } catch {
    interestError.value = 'Could not save. Try again.'
  } finally {
    isSavingInterests.value = false
  }
}

async function addInterest() {
  const value = interestDraft.value.trim()
  if (!value) return
  if (store.interests.some((i) => i.toLowerCase() === value.toLowerCase())) {
    interestError.value = 'Already on the list.'
    return
  }
  interestDraft.value = ''
  await persistInterests([...store.interests, value])
}

async function removeInterest(interest) {
  await persistInterests(store.interests.filter((i) => i !== interest))
}

// --- Compose snippets (persisted locally through the inbox store) ---
// --- Spam retention ---
// The input is a local draft so a half-typed number never hits the server;
// it re-syncs whenever the stored value changes (initial load, or a save
// whose server-normalized result differs from what was typed).
const spamRetentionDraft = ref(String(store.spamRetentionDays))
const spamRetentionError = ref('')
const isSavingSpamRetention = ref(false)
watch(
  () => store.spamRetentionDays,
  (days) => {
    spamRetentionDraft.value = String(days)
  },
)
// v-model on a number input hands back a number once typed into, hence String().
const spamRetentionDirty = computed(
  () => String(spamRetentionDraft.value).trim() !== String(store.spamRetentionDays),
)

async function saveSpamRetention() {
  const { minDays, maxDays } = store.spamRetentionBounds
  const days = Number(spamRetentionDraft.value)
  if (!Number.isInteger(days) || days < minDays || days > maxDays) {
    spamRetentionError.value = `Enter a whole number of days from ${minDays} to ${maxDays}.`
    return
  }
  spamRetentionError.value = ''
  isSavingSpamRetention.value = true
  try {
    await store.saveSpamRetention(days)
    store.notify(`Spam will be deleted after ${days} ${days === 1 ? 'day' : 'days'}.`)
  } catch (error) {
    console.error('Failed to save spam retention:', error)
    spamRetentionError.value = 'Could not save. Please try again.'
  } finally {
    isSavingSpamRetention.value = false
  }
}

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
  if (
    store.snippets.some((snippet) => snippet.name === name && snippet.id !== editingSnippetId.value)
  ) {
    snippetError.value = `/${name} already exists.`
    return
  }
  const id = editingSnippetId.value || globalThis.crypto?.randomUUID?.() || `snippet-${Date.now()}`
  store.setSnippets([
    ...store.snippets.filter((snippet) => snippet.id !== id),
    { id, name, html: snippetDraft.html },
  ])
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
watch(activeSection, syncBrowserNotificationPreference)

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
    // 'conditions' (subject/body/from/to matching) or 'ai' (a plain-language
    // prompt Cookie AI judges each new message against).
    kind: 'conditions',
    prompt: '',
    action: 'apply_label',
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
  editingRuleId.value = null
  ruleError.value = ''
}

function editRule(rule) {
  ruleDraft.name = rule.name || ''
  ruleDraft.kind = rule.kind === 'ai' ? 'ai' : 'conditions'
  ruleDraft.prompt = rule.prompt || ''
  ruleDraft.action = rule.action || 'apply_label'
  ruleDraft.label_id = rule.label_id || ''
  ruleDraft.match_type = rule.match_type
  ruleDraft.conditions = rule.conditions.length
    ? rule.conditions.map((condition) => ({ ...condition }))
    : [blankCondition()]
  editingRuleId.value = rule.id
  ruleError.value = ''
  nextTick(() =>
    document
      .querySelector('.rule-editor-form')
      ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }),
  )
}

async function submitRule() {
  if (isSavingRule.value) return
  if (ruleDraft.action === 'apply_label' && !ruleDraft.label_id) {
    ruleError.value = 'Choose a label to apply.'
    return
  }
  const payload = {
    name: ruleDraft.name.trim() || null,
    kind: ruleDraft.kind,
    action: ruleDraft.action,
  }
  if (ruleDraft.kind === 'ai') {
    const prompt = ruleDraft.prompt.trim()
    if (!prompt) {
      ruleError.value = 'Describe the mail this rule should catch.'
      return
    }
    payload.prompt = prompt
  } else {
    const conditions = ruleDraft.conditions
      .map((condition) => ({ ...condition, value: condition.value.trim() }))
      .filter((condition) => condition.value)
    if (conditions.length === 0) {
      ruleError.value = 'Add at least one condition with a value.'
      return
    }
    payload.match_type = ruleDraft.match_type
    payload.conditions = conditions
  }

  isSavingRule.value = true
  // label_id is omitted entirely for mark_done: the API treats the key's
  // mere presence (even null) as "set this label", so switching a rule to
  // mark_done must drop the key rather than null it out.
  if (ruleDraft.action === 'apply_label') payload.label_id = ruleDraft.label_id

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
  <div class="settings-page">
    <aside class="settings-sidebar">
      <router-link class="settings-back-link" to="/">
        <span class="material-symbols-outlined" aria-hidden="true">arrow_back</span>
        <span>Back to app</span>
      </router-link>

      <label class="settings-search">
        <span class="material-symbols-outlined" aria-hidden="true">search</span>
        <input v-model="settingsSearch" type="search" placeholder="Search settings…" />
      </label>

      <nav class="settings-nav" aria-label="Settings">
        <div v-for="group in filteredSectionGroups" :key="group.label" class="settings-nav-group">
          <h2 class="settings-nav-label">{{ group.label }}</h2>
          <router-link
            v-for="section in group.sections"
            :key="section.id"
            :to="{ name: 'settings', params: { section: section.id } }"
            class="settings-nav-item"
            :class="{ active: activeSection === section.id }"
          >
            <span class="material-symbols-outlined" aria-hidden="true">{{ section.icon }}</span>
            <span>{{ section.label }}</span>
          </router-link>
        </div>
        <p v-if="filteredSectionGroups.length === 0" class="settings-nav-empty">
          No settings found
        </p>
      </nav>
    </aside>

    <main class="settings-main">
      <div class="settings-content">
        <header class="settings-page-header">
          <h1>{{ activeSectionLabel }}</h1>
        </header>

        <div class="settings-pane">
          <!-- Account -->
          <section v-if="activeSection === 'account'" class="settings-section">
            <h3 class="settings-section-title">Profile</h3>
            <div class="settings-account-row">
              <img
                :src="user?.picture || '/rose_avatar.webp'"
                :alt="user?.name"
                class="settings-avatar"
              />
              <div class="settings-account-info">
                <span class="settings-account-name">{{ user?.name || 'Allister' }}</span>
                <span class="settings-account-email">{{ user?.email || '' }}</span>
                <span class="settings-account-provider">Signed in with Google via Auth0</span>
              </div>
            </div>
          </section>

          <!-- Appearance -->
          <section v-if="activeSection === 'appearance'" class="settings-section">
            <h3 class="settings-section-title">Theme</h3>
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
            <h3 class="settings-section-title">Email signature</h3>
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
              Reusable templates stored on this device. In a new email, type a trigger such as
              “/hello-world” and choose it from the menu.
            </p>

            <div v-if="store.snippets.length" class="snippet-list">
              <div v-for="snippet in store.snippets" :key="snippet.id" class="snippet-row">
                <span class="snippet-trigger">/{{ snippet.name }}</span>
                <div class="label-row-actions">
                  <button
                    class="ni-action-btn"
                    :title="`Edit /${snippet.name}`"
                    @click="editSnippet(snippet)"
                  >
                    <span class="material-symbols-outlined">edit</span>
                  </button>
                  <button
                    class="ni-action-btn label-delete-btn"
                    :title="`Delete /${snippet.name}`"
                    @click="deleteSnippet(snippet.id)"
                  >
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
              <button
                class="btn btn-secondary"
                :disabled="!aiSnippetInstruction.trim() || isGeneratingSnippet"
                @click="generateSnippet"
              >
                {{ isGeneratingSnippet ? 'Drafting…' : 'Generate with AI' }}
              </button>
            </div>

            <form class="snippet-editor-form" @submit.prevent="saveSnippet">
              <input
                v-model="snippetDraft.name"
                class="label-input"
                maxlength="50"
                placeholder="Trigger, e.g. hello-world"
              />
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
                <button
                  v-if="editingSnippetId"
                  type="button"
                  class="btn btn-secondary"
                  @click="resetSnippetDraft"
                >
                  Cancel
                </button>
                <button type="submit" class="btn btn-primary">
                  {{ editingSnippetId ? 'Save snippet' : 'Add snippet' }}
                </button>
              </div>
            </form>
          </section>

          <!-- Notifications -->
          <section v-if="activeSection === 'notifications'" class="settings-section">
            <h3 class="settings-section-title">Browser notifications</h3>
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
          <AutoArchiveSettings v-if="activeSection === 'auto-archive'" />

          <!-- Personalisation -->
          <section
            v-if="activeSection === 'spam'"
            class="settings-section"
            data-testid="spam-section"
          >
            <h3 class="settings-section-title">Delete spam automatically</h3>
            <p class="settings-section-hint">
              Mail in Spam is deleted once it has been there this many days. The default is
              {{ store.spamRetentionBounds.defaultDays }} days. Anything you mark Not spam before
              then is kept.
            </p>

            <form class="spam-retention" @submit.prevent="saveSpamRetention">
              <label class="spam-retention-field">
                <span>Delete spam after</span>
                <input
                  v-model="spamRetentionDraft"
                  class="label-input spam-retention-input"
                  type="number"
                  inputmode="numeric"
                  :min="store.spamRetentionBounds.minDays"
                  :max="store.spamRetentionBounds.maxDays"
                  step="1"
                  :disabled="isSavingSpamRetention"
                  aria-label="Days to keep spam before deleting it"
                />
                <span>days</span>
              </label>
              <button
                class="btn btn-primary"
                type="submit"
                :disabled="
                  isSavingSpamRetention || !store.spamRetentionLoaded || !spamRetentionDirty
                "
              >
                Save
              </button>
            </form>
            <p v-if="spamRetentionError" class="settings-error" role="alert">
              {{ spamRetentionError }}
            </p>
          </section>

          <section
            v-if="activeSection === 'personalisation'"
            class="settings-section"
            data-testid="personalisation-section"
          >
            <h3 class="settings-section-title">AI Today interests</h3>
            <p class="settings-section-hint">
              Topics AI Today ranks your daily news against — GitHub projects and Product Hunt
              launches are picked to match these. UK headlines are never filtered. Leave the list
              empty to see the day's top items unpersonalised.
            </p>

            <ul v-if="store.interests.length" class="interest-chips" data-testid="interest-chips">
              <li v-for="interest in store.interests" :key="interest" class="interest-chip">
                <span>{{ interest }}</span>
                <button
                  class="interest-remove"
                  :title="`Remove ${interest}`"
                  :aria-label="`Remove ${interest}`"
                  :disabled="isSavingInterests"
                  @click="removeInterest(interest)"
                >
                  <span class="material-symbols-outlined">close</span>
                </button>
              </li>
            </ul>
            <p v-else class="settings-section-hint">
              No topics yet — add a few, like "Cloudflare Workers" or "self-hosting".
            </p>

            <form class="interest-add" @submit.prevent="addInterest">
              <input
                v-model="interestDraft"
                class="label-input"
                type="text"
                maxlength="60"
                placeholder="Add a topic"
                :disabled="isSavingInterests"
                aria-label="Add a personalisation topic"
              />
              <button
                class="btn btn-primary"
                type="submit"
                :disabled="isSavingInterests || !interestDraft.trim()"
              >
                Add
              </button>
            </form>
            <p v-if="interestError" class="snippet-error">{{ interestError }}</p>
          </section>

          <section v-if="activeSection === 'labels'" class="settings-section">
            <h3 class="settings-section-title">Email labels</h3>
            <p class="settings-section-hint">
              Cookie AI uses enabled label descriptions to auto-tag new mail. Deleting a label
              removes it from every message.
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

          <!-- Calendar -->
          <section v-if="activeSection === 'calendar'" class="settings-section">
            <CalendarSettings />
          </section>

          <!-- Document templates -->
          <section v-if="activeSection === 'document-templates'" class="settings-section">
            <DocumentTemplateSettings />
          </section>

          <!-- Daily notes -->
          <section v-if="activeSection === 'daily-notes'" class="settings-section">
            <DailyNoteSettings />
          </section>

          <!-- Rules -->
          <section v-if="activeSection === 'rules'" class="settings-section">
            <h3 class="settings-section-title">Email rules</h3>
            <p class="settings-section-hint">
              Automatically apply a tag or mark mail done when new mail matches conditions on
              subject, body, from, or to — or describe the mail in plain language and let Cookie AI
              decide. Condition rules run the moment mail arrives; AI rules run with AI
              auto-tagging.
            </p>

            <div class="rule-list" v-if="store.rules.length">
              <div class="rule-row" v-for="rule in store.rules" :key="rule.id">
                <div class="rule-row-main">
                  <span class="rule-row-name">{{ rule.name || 'Untitled rule' }}</span>
                  <span
                    v-if="rule.action === 'mark_done'"
                    class="ni-label-pill"
                    :style="{ color: '#64748b', backgroundColor: '#64748b1f' }"
                  >
                    Mark done
                  </span>
                  <span
                    v-else
                    class="ni-label-pill"
                    :style="{
                      color: store.labels.find((l) => l.id === rule.label_id)?.color,
                      backgroundColor:
                        (store.labels.find((l) => l.id === rule.label_id)?.color || '#64748b') +
                        '1f',
                    }"
                  >
                    {{ labelName(rule.label_id) }}
                  </span>
                  <span v-if="rule.kind === 'ai'" class="rule-row-summary rule-row-summary-ai">
                    <span
                      class="material-symbols-outlined gemini-color rule-row-ai-icon"
                      aria-hidden="true"
                      >auto_fix_high</span
                    >
                    Cookie AI: "{{ rule.prompt }}"
                  </span>
                  <span v-else class="rule-row-summary">
                    {{ rule.match_type === 'any' ? 'Any of' : 'All of' }}:
                    {{
                      rule.conditions
                        .map(
                          (c) => `${fieldLabel(c.field)} ${operatorLabel(c.operator)} "${c.value}"`,
                        )
                        .join(rule.match_type === 'any' ? ' · or ' : ' · and ')
                    }}
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
                    <button
                      class="ni-action-btn"
                      :title="`Edit ${rule.name || 'rule'}`"
                      @click="editRule(rule)"
                    >
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

              <label class="settings-row rule-kind-row">
                <span>Rule type</span>
                <select class="settings-select" v-model="ruleDraft.kind" aria-label="Rule type">
                  <option value="conditions">Conditions</option>
                  <option value="ai">Cookie AI prompt</option>
                </select>
              </label>

              <label v-if="ruleDraft.kind === 'ai'" class="rule-prompt-field">
                <span class="rule-prompt-label">
                  <span
                    class="material-symbols-outlined gemini-color rule-row-ai-icon"
                    aria-hidden="true"
                    >auto_fix_high</span
                  >
                  Describe the mail this rule should catch
                </span>
                <textarea
                  v-model="ruleDraft.prompt"
                  class="label-input rule-prompt-input"
                  rows="3"
                  maxlength="500"
                  placeholder="e.g. Receipts and order confirmations from online shops"
                  aria-label="AI prompt"
                ></textarea>
              </label>

              <div
                v-for="(condition, index) in ruleDraft.conditions"
                v-else
                class="rule-condition-row"
                :key="index"
              >
                <select class="settings-select" v-model="condition.field">
                  <option v-for="field in RULE_FIELDS" :key="field.value" :value="field.value">
                    {{ field.label }}
                  </option>
                </select>
                <select class="settings-select" v-model="condition.operator">
                  <option
                    v-for="operator in RULE_OPERATORS"
                    :key="operator.value"
                    :value="operator.value"
                  >
                    {{ operator.label }}
                  </option>
                </select>
                <input
                  v-model="condition.value"
                  class="label-input"
                  maxlength="200"
                  placeholder="Value"
                />
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
              <button
                v-if="ruleDraft.kind === 'conditions'"
                type="button"
                class="btn btn-secondary rule-add-condition-btn"
                @click="addRuleCondition"
              >
                + Add condition
              </button>

              <div class="rule-create-fields">
                <label v-if="ruleDraft.kind === 'conditions'" class="settings-row">
                  <span>Match</span>
                  <select class="settings-select" v-model="ruleDraft.match_type">
                    <option value="all">All conditions</option>
                    <option value="any">Any condition</option>
                  </select>
                </label>
                <label class="settings-row">
                  <span>Action</span>
                  <select class="settings-select" v-model="ruleDraft.action">
                    <option value="apply_label">Apply a label</option>
                    <option value="mark_done">Mark done</option>
                  </select>
                </label>
                <label v-if="ruleDraft.action === 'apply_label'" class="settings-row">
                  <span>Apply label</span>
                  <select class="settings-select" v-model="ruleDraft.label_id">
                    <option value="" disabled>Choose a label</option>
                    <option v-for="label in userLabels" :key="label.id" :value="label.id">
                      {{ label.name }}
                    </option>
                  </select>
                </label>
              </div>

              <p v-if="ruleError" class="snippet-error" role="alert">{{ ruleError }}</p>
              <div class="label-create-actions">
                <button
                  v-if="editingRuleId"
                  type="button"
                  class="btn btn-secondary"
                  @click="resetRuleDraft"
                >
                  Cancel
                </button>
                <button type="submit" class="btn btn-primary" :disabled="isSavingRule">
                  {{ editingRuleId ? 'Save rule' : 'Add rule' }}
                </button>
              </div>
            </form>
          </section>
        </div>
      </div>
    </main>
  </div>
</template>
