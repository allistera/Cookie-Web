<script setup>
import { ref, reactive, computed, watch, nextTick, onBeforeUnmount } from 'vue'
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
import { getLegacySignature, clearLegacySignature } from '../lib/signature'
import { getLegacySnippets, clearLegacySnippets } from '../lib/snippets'
import CalendarSettings from '../components/CalendarSettings.vue'
import ComposerEditor from '../components/ComposerEditor.vue'
import DocumentTemplateSettings from '../components/DocumentTemplateSettings.vue'
import DailyNoteSettings from '../components/DailyNoteSettings.vue'
import AutoArchiveSettings from '../components/AutoArchiveSettings.vue'
import OutOfOfficeSettings from '../components/OutOfOfficeSettings.vue'
import AiTodaySettings from '../components/AiTodaySettings.vue'
import CategorySettings from '../components/CategorySettings.vue'
import TaskLabelSettings from '../components/TaskLabelSettings.vue'

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
store.loadCategories()
store.loadRules()
store.loadInterests()
store.loadSpamRetention()

// --- Personalisation (server-side: the enricher Worker reads these) ---
const interestDraft = ref('')
const interestError = ref('')
const isSavingInterests = ref(false)

// Every edit writes the whole list straight through, so a scheduled run can
// never use a list the user believes they changed.
async function persistInterests(next, personaliseGithub = store.personaliseGithub) {
  interestError.value = ''
  isSavingInterests.value = true
  try {
    await store.saveInterests(next, personaliseGithub)
  } catch {
    interestError.value = 'Could not save. Try again.'
  } finally {
    isSavingInterests.value = false
  }
}

async function toggleGithubPersonalisation(event) {
  const checkbox = event.target
  await persistInterests(store.interests, checkbox.checked)
  checkbox.checked = store.personaliseGithub
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

// --- Account-scoped composer preferences and reviewed legacy import ---
const snippetDraft = reactive({ name: '', html: '' })
const editingSnippetId = ref(null)
const snippetError = ref('')
const snippetConflict = ref(false)
const signatureDraft = ref(store.signatureHtml)
const signatureTouched = ref(false)
const signatureEditVersion = ref(0)
const signatureError = ref('')
const signatureConflict = ref(false)
const legacySignature = ref('')
const legacySnippets = ref([])
const importSignature = ref(false)
const importSnippets = ref(false)
const importError = ref('')
const importConflict = ref(false)
const legacyAvailable = computed(() =>
  Boolean(legacySignature.value || legacySnippets.value.length),
)
const aiSnippetInstruction = ref('')
const isGeneratingSnippet = ref(false)
let snippetGenerationVersion = 0
let snippetDraftSession = 0

function refreshLegacyValues() {
  legacySignature.value = getLegacySignature()
  legacySnippets.value = getLegacySnippets()
}

watch(
  () => user.value?.sub,
  (sub) => {
    store.setComposeOwner(sub)
    signatureDraft.value = store.signatureHtml
    signatureTouched.value = false
    signatureEditVersion.value += 1
    signatureError.value = ''
    signatureConflict.value = false
    resetSnippetDraft()
    snippetConflict.value = false
    importSignature.value = false
    importSnippets.value = false
    importError.value = ''
    importConflict.value = false
    aiSnippetInstruction.value = ''
    isGeneratingSnippet.value = false
    snippetGenerationVersion += 1
    refreshLegacyValues()
    if (sub) store.loadComposePreferences()
  },
  { immediate: true },
)

watch(
  () => store.signatureHtml,
  (html) => {
    if (!signatureTouched.value) signatureDraft.value = html
  },
)

function updateSignatureDraft(html) {
  signatureDraft.value = html
  signatureTouched.value = true
  signatureEditVersion.value += 1
}

async function saveSignature() {
  if (signatureConflict.value || store.composePreferencesSaving) return
  const ownerGeneration = store.composeGeneration
  const editVersion = signatureEditVersion.value
  const draft = signatureDraft.value
  const saved = await store.saveComposePreferences({ signatureHtml: draft })
  if (ownerGeneration !== store.composeGeneration) return
  if (saved) {
    if (editVersion === signatureEditVersion.value) {
      signatureTouched.value = false
      signatureDraft.value = store.signatureHtml
    }
    signatureError.value = ''
  } else {
    signatureError.value = store.composePreferencesError
    signatureConflict.value = store.composePreferencesConflict
  }
}

function useLatestSignature() {
  signatureDraft.value = store.signatureHtml
  signatureTouched.value = false
  signatureConflict.value = false
  signatureError.value = ''
}

async function overwriteLatestSignature() {
  signatureConflict.value = false
  await saveSignature()
}

async function importLegacyValues() {
  if (importConflict.value || store.composePreferencesSaving) return
  if (!importSignature.value && !importSnippets.value) {
    importError.value = 'Choose the local values you want to import.'
    return
  }
  const ownerGeneration = store.composeGeneration
  const selectedSignature = importSignature.value
  const selectedSnippets = importSnippets.value
  const signature = selectedSignature ? legacySignature.value : store.signatureHtml
  const snippets = selectedSnippets ? legacySnippets.value : store.snippets
  const saved = await store.saveComposePreferences({
    signatureHtml: signature,
    snippets,
  })
  if (ownerGeneration !== store.composeGeneration) return
  if (!saved) {
    importError.value = store.composePreferencesError
    importConflict.value = store.composePreferencesConflict
    return
  }
  // Another tab may change an old key while this request is pending. Remove
  // only the exact sanitized value the user reviewed and imported.
  if (selectedSignature && getLegacySignature() === signature) clearLegacySignature()
  if (selectedSnippets && JSON.stringify(getLegacySnippets()) === JSON.stringify(snippets))
    clearLegacySnippets()
  if (selectedSignature) importSignature.value = false
  if (selectedSnippets) importSnippets.value = false
  importConflict.value = false
  importError.value = ''
  refreshLegacyValues()
  if (!signatureTouched.value) signatureDraft.value = store.signatureHtml
}

function reviewImportAgain() {
  importConflict.value = false
  importError.value = ''
}

function resetSnippetDraft() {
  snippetDraftSession += 1
  snippetDraft.name = ''
  snippetDraft.html = ''
  editingSnippetId.value = null
  snippetError.value = ''
}

function editSnippet(snippet) {
  snippetDraftSession += 1
  snippetDraft.name = snippet.name
  snippetDraft.html = snippet.html
  editingSnippetId.value = snippet.id
  snippetError.value = ''
}

async function saveSnippet() {
  if (store.composePreferencesSaving) return
  if (!editingSnippetId.value && store.snippets.length >= 50) {
    snippetError.value = 'You can save up to 50 snippets.'
    return
  }
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
  const ownerGeneration = store.composeGeneration
  const draft = {
    name: snippetDraft.name,
    html: snippetDraft.html,
    editingId: editingSnippetId.value,
    session: snippetDraftSession,
  }
  const saved = await store.saveComposePreferences({
    snippets: [
      ...store.snippets.filter((snippet) => snippet.id !== id),
      { id, name, html: snippetDraft.html },
    ],
  })
  if (ownerGeneration !== store.composeGeneration || draft.session !== snippetDraftSession) return
  if (saved) {
    snippetConflict.value = false
    snippetError.value = ''
    if (
      snippetDraft.name === draft.name &&
      snippetDraft.html === draft.html &&
      editingSnippetId.value === draft.editingId
    ) {
      resetSnippetDraft()
    } else if (draft.editingId === null && editingSnippetId.value === null) {
      // This is still the same new draft, but it changed during creation.
      // The next save must update the created snippet rather than add a duplicate.
      editingSnippetId.value = id
    }
  } else {
    snippetError.value = store.composePreferencesError
    snippetConflict.value = store.composePreferencesConflict
  }
}

async function deleteSnippet(id) {
  if (store.composePreferencesSaving) return
  const ownerGeneration = store.composeGeneration
  const draft = {
    name: snippetDraft.name,
    html: snippetDraft.html,
    editingId: editingSnippetId.value,
  }
  const saved = await store.saveComposePreferences({
    snippets: store.snippets.filter((snippet) => snippet.id !== id),
  })
  if (ownerGeneration !== store.composeGeneration) return
  if (saved) {
    snippetConflict.value = false
    snippetError.value = ''
    if (
      editingSnippetId.value === id &&
      snippetDraft.name === draft.name &&
      snippetDraft.html === draft.html &&
      editingSnippetId.value === draft.editingId
    )
      resetSnippetDraft()
  } else {
    snippetError.value = store.composePreferencesError
    snippetConflict.value = store.composePreferencesConflict
  }
}

async function generateSnippet() {
  if (!aiSnippetInstruction.value.trim() || isGeneratingSnippet.value) return
  const ownerGeneration = store.composeGeneration
  const version = ++snippetGenerationVersion
  isGeneratingSnippet.value = true
  const snippet = await store.requestAiSnippet(aiSnippetInstruction.value)
  if (ownerGeneration !== store.composeGeneration || version !== snippetGenerationVersion) return
  isGeneratingSnippet.value = false
  if (!snippet) return
  snippetDraftSession += 1
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
const ntfyError = ref('')
const isNtfyLoading = ref(false)
const isNtfyTesting = ref(false)

function syncBrowserNotificationPreference() {
  browserPermission.value = browserNotificationPermission()
  browserNotificationsOn.value =
    browserPermission.value === 'granted' && browserNotificationsEnabled(notificationOwnerId.value)
}

watch(notificationOwnerId, syncBrowserNotificationPreference, { immediate: true })
watch(activeSection, (section) => {
  syncBrowserNotificationPreference()
  if (section === 'notifications' && notificationOwnerId.value && !store.ntfySubscription) {
    isNtfyLoading.value = true
    store
      .loadNtfySubscription()
      .catch((error) => {
        console.error('Failed to load ntfy subscription:', error)
        ntfyError.value = 'Could not load ntfy settings.'
      })
      .finally(() => {
        isNtfyLoading.value = false
      })
  }
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

const ntfyStatus = computed(() => {
  if (isNtfyLoading.value) return 'Loading…'
  if (store.isNtfyEnabled) return 'Cookie will send new mail alerts to your ntfy topic.'
  if (store.ntfySubscription) return 'Paused. Your topic is kept, so turn this back on any time.'
  return 'Turn on to create a private topic to subscribe to in the ntfy app.'
})

// The switch is controlled by the store, so a failed request snaps it back.
async function toggleNtfy(event) {
  const enabled = event.target.checked
  ntfyError.value = ''
  isNtfyLoading.value = true
  try {
    if (enabled) await store.createNtfySubscription()
    else await store.disableNtfySubscription()
  } catch (error) {
    console.error(`Failed to ${enabled ? 'enable' : 'disable'} ntfy notifications:`, error)
    ntfyError.value = `Could not ${enabled ? 'enable' : 'disable'} ntfy notifications. Please try again.`
  } finally {
    isNtfyLoading.value = false
    event.target.checked = store.isNtfyEnabled
  }
}

async function copyNtfyUrl() {
  if (!store.ntfySubscription?.subscribeUrl || !navigator.clipboard) return
  await navigator.clipboard.writeText(store.ntfySubscription.subscribeUrl)
}

async function sendNtfyTest() {
  ntfyError.value = ''
  isNtfyTesting.value = true
  try {
    await store.sendNtfyTest()
    store.notify('Test notification sent.')
  } catch (error) {
    console.error('Failed to send ntfy test notification:', error)
    ntfyError.value =
      error?.code === 'ntfy_rate_limited'
        ? 'ntfy is temporarily rate-limiting notifications. Try again shortly.'
        : error?.code === 'ntfy_unavailable'
          ? 'The notification service is temporarily unavailable. Try again shortly.'
          : 'Could not send the test notification. Please try again.'
  } finally {
    isNtfyTesting.value = false
  }
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
const ruleInstruction = ref('')
const isGeneratingRule = ref(false)
const ruleDraftReady = ref(false)
const ruleGenerationError = ref('')
let ruleGenerationVersion = 0
onBeforeUnmount(() => {
  ruleGenerationVersion++
})

async function generateRuleDraft() {
  if (isGeneratingRule.value || !ruleInstruction.value.trim()) return
  const version = ++ruleGenerationVersion
  isGeneratingRule.value = true
  ruleGenerationError.value = ''
  try {
    const draft = await store.requestAiRuleDraft(ruleInstruction.value)
    if (version !== ruleGenerationVersion) return
    Object.assign(ruleDraft, blankRuleDraft(), draft, {
      label_id: draft.label_id || '',
      prompt: draft.prompt || '',
    })
    ruleDraftReady.value = true
    ruleError.value = ''
    await nextTick()
    document.querySelector('.rule-editor-form > input')?.focus()
  } catch (error) {
    if (version === ruleGenerationVersion)
      ruleGenerationError.value = error.message || 'AI rule generation failed. Please try again.'
  } finally {
    if (version === ruleGenerationVersion) isGeneratingRule.value = false
  }
}

const userLabels = computed(() => store.labels.filter((label) => label.kind === 'user'))

function addRuleCondition() {
  if (ruleDraft.conditions.length >= 10) return
  ruleDraft.conditions.push(blankCondition())
}

function removeRuleCondition(index) {
  if (ruleDraft.conditions.length <= 1) return
  ruleDraft.conditions.splice(index, 1)
}

function resetRuleDraft() {
  ruleGenerationVersion++
  isGeneratingRule.value = false
  ruleDraftReady.value = false
  ruleInstruction.value = ''
  ruleGenerationError.value = ''
  Object.assign(ruleDraft, blankRuleDraft())
  editingRuleId.value = null
  ruleError.value = ''
}

function editRule(rule) {
  resetRuleDraft()
  ruleDraftReady.value = true
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
  if (isSavingRule.value || !ruleDraftReady.value) return
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
          <OutOfOfficeSettings v-if="activeSection === 'out-of-office'" />
          <div
            v-if="
              (activeSection === 'signature' || activeSection === 'snippets') &&
              legacyAvailable &&
              store.composePreferencesLoaded
            "
            class="settings-legacy-import"
          >
            <h3>Import old values from this browser</h3>
            <p>
              These values were saved without an account. Review them before choosing whether to
              replace this account's synced signature or snippets. Nothing is imported
              automatically.
            </p>
            <label v-if="legacySignature" class="settings-legacy-option">
              <input v-model="importSignature" type="checkbox" />
              <span>Replace synced signature with this local signature:</span>
            </label>
            <div v-if="legacySignature" class="settings-legacy-preview" v-html="legacySignature" />
            <label v-if="legacySnippets.length" class="settings-legacy-option">
              <input v-model="importSnippets" type="checkbox" />
              <span
                >Replace synced snippets with these {{ legacySnippets.length }} local
                snippets:</span
              >
            </label>
            <ul v-if="legacySnippets.length" class="settings-legacy-list">
              <li v-for="snippet in legacySnippets" :key="snippet.id">
                /{{ snippet.name }}
                <div class="settings-legacy-preview" v-html="snippet.html" />
              </li>
            </ul>
            <p v-if="importConflict" class="snippet-error" role="alert">
              The account's newer values are loaded. Review them below before applying this import.
              Current snippets:
              {{ store.snippets.map((snippet) => `/${snippet.name}`).join(', ') || 'none' }}.
            </p>
            <div v-if="importConflict" class="settings-legacy-preview">
              Latest account signature: <span v-html="store.signatureHtml || 'None'" />
            </div>
            <p v-else-if="importError" class="snippet-error" role="alert">{{ importError }}</p>
            <div class="settings-sync-actions">
              <button
                v-if="importConflict"
                type="button"
                class="btn btn-secondary"
                @click="reviewImportAgain"
              >
                I reviewed the latest values
              </button>
              <button
                type="button"
                class="btn btn-secondary"
                :disabled="importConflict || store.composePreferencesSaving"
                @click="importLegacyValues"
              >
                Import selected values
              </button>
            </div>
          </div>

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
              Synced with your account and added to new emails. Type “/” for formatting.
            </p>
            <p v-if="!store.composePreferencesLoaded" role="status">
              {{
                store.composePreferencesLoading
                  ? 'Loading synced signature…'
                  : store.composePreferencesError || 'Sign in to load your signature.'
              }}
            </p>
            <button
              v-if="
                !store.composePreferencesLoaded &&
                !store.composePreferencesLoading &&
                store.composeOwnerSub
              "
              type="button"
              class="btn btn-secondary"
              @click="store.loadComposePreferences()"
            >
              Retry
            </button>
            <div v-if="store.composePreferencesLoaded" class="settings-signature-editor">
              <ComposerEditor
                :model-value="signatureDraft"
                :hide-generate="true"
                placeholder="Your signature…"
                @update:model-value="updateSignatureDraft"
              />
            </div>
            <p v-if="signatureError" class="snippet-error" role="alert">{{ signatureError }}</p>
            <div v-if="signatureConflict" class="settings-legacy-preview">
              Latest saved signature: <span v-html="store.signatureHtml || 'None'" />
            </div>
            <div v-if="store.composePreferencesLoaded" class="settings-sync-actions">
              <button
                v-if="signatureConflict"
                type="button"
                class="btn btn-secondary"
                @click="useLatestSignature"
              >
                Use latest
              </button>
              <button
                v-if="signatureConflict"
                type="button"
                class="btn btn-primary"
                :disabled="store.composePreferencesSaving"
                @click="overwriteLatestSignature"
              >
                Save my draft over latest
              </button>
              <button
                v-else
                type="button"
                class="btn btn-primary"
                :disabled="!signatureTouched || store.composePreferencesSaving"
                @click="saveSignature"
              >
                {{ store.composePreferencesSaving ? 'Saving…' : 'Save signature' }}
              </button>
            </div>
          </section>

          <!-- Compose snippets -->
          <section v-if="activeSection === 'snippets'" class="settings-section">
            <h3 class="settings-section-title">Compose snippets</h3>
            <p class="settings-section-hint">
              Reusable templates synced with your account. In a new email, type a trigger such as
              “/hello-world” and choose it from the menu.
            </p>
            <p class="settings-section-hint">
              Add <code>&#123;&#123;recipient.first_name&#125;&#125;</code>,
              <code>&#123;&#123;recipient.name&#125;&#125;</code>, or
              <code>&#123;&#123;recipient.email&#125;&#125;</code>, and editable fields such as
              <code>&#123;&#123;fill:meeting time&#125;&#125;</code>. Cookie previews these before
              insertion. Fill or remove missing fields before sending.
            </p>
            <p v-if="!store.composePreferencesLoaded" role="status">
              {{
                store.composePreferencesLoading
                  ? 'Loading synced snippets…'
                  : store.composePreferencesError || 'Sign in to load your snippets.'
              }}
            </p>
            <button
              v-if="
                !store.composePreferencesLoaded &&
                !store.composePreferencesLoading &&
                store.composeOwnerSub
              "
              type="button"
              class="btn btn-secondary"
              @click="store.loadComposePreferences()"
            >
              Retry
            </button>

            <template v-if="store.composePreferencesLoaded">
              <div v-if="store.snippets.length" class="snippet-list">
                <div v-for="snippet in store.snippets" :key="snippet.id" class="snippet-row">
                  <span class="snippet-trigger">/{{ snippet.name }}</span>
                  <div class="label-row-actions">
                    <button
                      class="ni-action-btn"
                      :title="`Edit /${snippet.name}`"
                      :aria-label="`Edit snippet /${snippet.name}`"
                      :disabled="store.composePreferencesSaving"
                      @click="editSnippet(snippet)"
                    >
                      <span class="material-symbols-outlined">edit</span>
                    </button>
                    <button
                      class="ni-action-btn label-delete-btn"
                      :title="`Delete /${snippet.name}`"
                      :aria-label="`Delete snippet /${snippet.name}`"
                      :disabled="store.composePreferencesSaving"
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
                <p v-if="snippetConflict" class="settings-section-hint">
                  The synced list above is the latest version. Review it, then save your draft again
                  if you want to apply it.
                </p>
                <div class="label-create-actions">
                  <button
                    v-if="editingSnippetId"
                    type="button"
                    class="btn btn-secondary"
                    @click="resetSnippetDraft"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    class="btn btn-primary"
                    :disabled="store.composePreferencesSaving"
                  >
                    {{
                      snippetConflict
                        ? 'Save my draft over latest'
                        : editingSnippetId
                          ? 'Save snippet'
                          : 'Add snippet'
                    }}
                  </button>
                </div>
              </form>
            </template>
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
            <h3 class="settings-section-title settings-section-title-spaced">ntfy notifications</h3>
            <p class="settings-section-hint">
              Receive Cookie alerts in the ntfy iOS app. Install ntfy, subscribe to your private
              topic, then leave this on.
            </p>
            <label class="settings-row">
              <div class="settings-row-text">
                <span>ntfy notifications</span>
                <small>{{ ntfyStatus }}</small>
              </div>
              <input
                type="checkbox"
                class="settings-switch ntfy-switch"
                :checked="store.isNtfyEnabled"
                :disabled="isNtfyLoading || !notificationOwnerId"
                @change="toggleNtfy"
              />
            </label>
            <div
              v-if="store.ntfySubscription"
              class="ntfy-subscription"
              data-testid="ntfy-subscription"
            >
              <p>Subscribe in ntfy to:</p>
              <code>{{ store.ntfySubscription.subscribeUrl }}</code>
              <div class="label-create-actions">
                <button type="button" class="btn btn-secondary" @click="copyNtfyUrl">
                  Copy topic URL
                </button>
                <button
                  type="button"
                  class="btn btn-secondary"
                  :disabled="isNtfyTesting || isNtfyLoading || !store.isNtfyEnabled"
                  @click="sendNtfyTest"
                >
                  {{ isNtfyTesting ? 'Sending…' : 'Send test notification' }}
                </button>
              </div>
            </div>
            <p v-if="ntfyError" class="settings-error" role="alert">{{ ntfyError }}</p>
          </section>

          <!-- Labels -->
          <AutoArchiveSettings v-if="activeSection === 'auto-archive'" />
          <AiTodaySettings v-if="activeSection === 'ai-today'" />

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
              Topics used to personalise Product Hunt launches and, optionally, GitHub repositories.
              UK headlines are never filtered.
            </p>
            <label class="settings-section-hint">
              <input
                type="checkbox"
                :checked="store.personaliseGithub"
                :disabled="!store.interestsLoaded || isSavingInterests"
                @change="toggleGithubPersonalisation"
              />
              Personalise GitHub repositories
            </label>
            <p class="settings-section-hint">
              Off by default: show all repositories from the daily top GitHub feed. Changes apply
              when AI Today next refreshes.
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
                      :aria-label="`Save ${label.name}`"
                      :disabled="!editedLabelName.trim() || isRenamingLabel"
                      @click="submitLabelRename(label)"
                    >
                      <span class="material-symbols-outlined">check</span>
                    </button>
                    <button
                      class="ni-action-btn label-cancel-btn"
                      :title="`Cancel renaming ${label.name}`"
                      :aria-label="`Cancel renaming ${label.name}`"
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
                      :aria-label="`Rename ${label.name}`"
                      @click="startRenamingLabel(label)"
                    >
                      <span class="material-symbols-outlined">edit</span>
                    </button>
                    <button
                      class="ni-action-btn label-delete-btn"
                      :title="`Delete ${label.name}`"
                      :aria-label="`Delete ${label.name}`"
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
                    :aria-label="`Use label colour ${color}`"
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

          <CategorySettings v-if="activeSection === 'categories'" />

          <!-- Tasks -->
          <TaskLabelSettings v-if="activeSection === 'task-labels'" />

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
                      :aria-label="`Edit ${rule.name || 'rule'}`"
                      @click="editRule(rule)"
                    >
                      <span class="material-symbols-outlined">edit</span>
                    </button>
                    <button
                      class="ni-action-btn label-delete-btn"
                      :title="`Delete ${rule.name || 'rule'}`"
                      :aria-label="`Delete ${rule.name || 'rule'}`"
                      @click="store.deleteRule(rule.id)"
                    >
                      <span class="material-symbols-outlined">delete</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <p v-else class="settings-section-hint">No rules yet — create your first below.</p>

            <form
              v-if="!ruleDraftReady"
              class="rule-generator-form"
              @submit.prevent="generateRuleDraft"
            >
              <label class="rule-prompt-field">
                <span class="rule-prompt-label">Describe your filter</span>
                <textarea
                  v-model="ruleInstruction"
                  class="label-input rule-prompt-input"
                  rows="3"
                  maxlength="1000"
                  aria-label="Describe your filter"
                  placeholder="e.g. Tag emails from billing@zoom.us as Finance"
                  :disabled="isGeneratingRule"
                ></textarea>
              </label>
              <p class="settings-section-hint">
                Describe which incoming emails to match and what to do with them. Cookie will
                prepare a rule for you to review — nothing is saved yet.
              </p>
              <p v-if="ruleGenerationError" class="snippet-error" role="alert">
                {{ ruleGenerationError }}
              </p>
              <div class="label-create-actions">
                <button
                  v-if="isGeneratingRule"
                  type="button"
                  class="btn btn-secondary"
                  @click="resetRuleDraft"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  class="btn btn-primary"
                  :disabled="isGeneratingRule || !ruleInstruction.trim()"
                >
                  {{ isGeneratingRule ? 'Generating…' : 'Generate Rule' }}
                </button>
              </div>
            </form>

            <form v-else class="rule-editor-form" @submit.prevent="submitRule">
              <p class="settings-section-hint">
                {{
                  editingRuleId
                    ? 'Edit your rule below.'
                    : 'Review your generated rule and correct anything before creating it.'
                }}
              </p>
              <input
                v-model="ruleDraft.name"
                aria-label="Rule name"
                class="label-input"
                maxlength="100"
                placeholder="Rule name (optional)"
              />

              <p class="settings-section-hint">
                {{
                  ruleDraft.kind === 'ai'
                    ? 'AI matching: Cookie judges new mail against the description below during AI auto-tagging.'
                    : 'Exact matching: these conditions run as new mail arrives.'
                }}
              </p>

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
                <select
                  class="settings-select"
                  v-model="condition.field"
                  :aria-label="`Condition ${index + 1} field`"
                >
                  <option v-for="field in RULE_FIELDS" :key="field.value" :value="field.value">
                    {{ field.label }}
                  </option>
                </select>
                <select
                  class="settings-select"
                  v-model="condition.operator"
                  :aria-label="`Condition ${index + 1} operator`"
                >
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
                  :aria-label="`Condition ${index + 1} value`"
                  class="label-input"
                  maxlength="200"
                  placeholder="Value"
                />
                <button
                  type="button"
                  class="ni-action-btn label-delete-btn"
                  title="Remove condition"
                  aria-label="Remove condition"
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
                :disabled="ruleDraft.conditions.length >= 10"
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
              <p v-if="ruleDraft.action === 'mark_done'" class="settings-section-hint">
                Matching mail will be archived and marked read. It remains available in Done.
              </p>
              <div class="label-create-actions">
                <button
                  type="button"
                  class="btn btn-secondary"
                  :disabled="isSavingRule"
                  @click="resetRuleDraft"
                >
                  Cancel
                </button>
                <button
                  v-if="!editingRuleId"
                  type="button"
                  class="btn btn-secondary"
                  :disabled="isSavingRule"
                  @click="ruleDraftReady = false"
                >
                  Back to description
                </button>
                <button type="submit" class="btn btn-primary" :disabled="isSavingRule">
                  {{ editingRuleId ? 'Save rule' : 'Create Rule' }}
                </button>
              </div>
            </form>
          </section>
        </div>
      </div>
    </main>
  </div>
</template>
