<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import { useInboxStore } from '../stores/inbox'
import { filterContacts } from '../lib/contactSuggest'
import { convertEmojiToEmoticons } from '../lib/emoticons'
import {
  appendRecipient,
  completedRecipients,
  currentRecipientToken,
  recipientsValid,
} from '../lib/recipients'
import {
  snippetRecipientValues,
  unresolvedSnippetFields,
  unresolvedSnippetWarning,
} from '../lib/snippetVariables'
import { scheduleChoices } from '../utils/schedule'
import ComposerEditor from './ComposerEditor.vue'
import ScheduleMenu from './ScheduleMenu.vue'

const store = useInboxStore()

const composerSubject = computed({
  get: () => store.composerSubject,
  set: (value) => {
    store.composerSubject = convertEmojiToEmoticons(value)
  },
})

const contactSuggestOpen = ref(false)
const contactHighlight = ref(-1)
const contactSuggestions = computed(() => {
  if (!contactSuggestOpen.value) return []
  const already = new Set(completedRecipients(store.composerTo).map((a) => a.toLowerCase()))
  const pool = store.contacts.filter((contact) => !already.has(contact.address.toLowerCase()))
  return filterContacts(pool, currentRecipientToken(store.composerTo))
})

const composerToValid = computed(() => recipientsValid(store.composerTo))
const recipientValues = computed(() => snippetRecipientValues(store.composerTo, store.contacts))
const unresolvedFields = computed(() =>
  unresolvedSnippetFields(store.composerHtml, store.composerTextArea),
)
// An upload still in flight has no attachment id yet, so sending now would
// quietly drop the file the user is watching upload.
const isSendDisabled = computed(
  () =>
    store.isSendingEmail ||
    store.composerSnippetPreviewOpen ||
    store.pendingAttachmentUploads > 0 ||
    !composerToValid.value ||
    !store.composerTextArea.trim(),
)

const attachInputRef = ref(null)

function onAttachFiles(event) {
  const input = event.target
  store.attachComposerFiles(input.files)
  // Clear the input so picking the same file twice in a row still fires.
  input.value = ''
}

// The footer is one row: the send actions and their neighbours, or — once
// the AI icon at its right edge is pressed — the Cookie AI prompt alone at
// full width. The two never share the row, so neither is squeezed.
const aiPromptOpen = ref(false)
const aiPromptRef = ref(null)

async function openAiPrompt() {
  aiPromptOpen.value = true
  await nextTick()
  aiPromptRef.value?.focus()
}

function closeAiPrompt() {
  aiPromptOpen.value = false
}

// The editor's own Generate control opens the AI panel with the draft as
// the instruction; the prompt comes up with it so that instruction can be
// read and changed. Immediate, because the panel can already be open when
// this lazily-loaded window first mounts (a reply drafted from the inbox).
// A closed composer starts its next message on the plain footer.
watch(
  () => store.isAiDraftActive,
  (active) => {
    if (active) openAiPrompt()
  },
  { immediate: true },
)
watch(
  () => store.isComposerActive,
  (active) => {
    if (!active) closeAiPrompt()
  },
)

const scheduleSendOpen = ref(false)
const scheduleSendOptions = computed(() => (scheduleSendOpen.value ? scheduleChoices() : []))
const followUpOpen = ref(false)
const followUpOptions = computed(() => (followUpOpen.value ? scheduleChoices() : []))
const followUpLabel = computed(() => {
  if (!store.composerFollowUpAt) return 'Remind me'
  return new Date(store.composerFollowUpAt).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
})

function selectScheduleSend(choice) {
  scheduleSendOpen.value = false
  if (
    store.composerFollowUpAt &&
    Date.parse(store.composerFollowUpAt) < choice.date.getTime() + 60_000
  ) {
    store.notify('Choose a reminder at least one minute after the scheduled send.', 'error')
    return
  }
  store.sendEmailLater(choice.date.toISOString(), choice.label)
}

function selectFollowUp(choice) {
  followUpOpen.value = false
  store.composerFollowUpAt = choice.date.toISOString()
}

function clearFollowUp() {
  followUpOpen.value = false
  store.composerFollowUpAt = null
}

function formatAttachmentSize(bytes) {
  const size = Number(bytes)
  if (!Number.isFinite(size) || size < 0) return ''
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function openContactSuggest() {
  contactSuggestOpen.value = true
  contactHighlight.value = -1
}

function closeContactSuggest() {
  contactSuggestOpen.value = false
  contactHighlight.value = -1
}

function moveContactHighlight(delta) {
  const count = contactSuggestions.value.length
  if (!count) return
  contactHighlight.value = (contactHighlight.value + delta + count) % count
}

function selectContact(address) {
  store.composerTo = appendRecipient(store.composerTo, address)
  closeContactSuggest()
  composerToRef.value?.focus()
}

function onContactEnter(event) {
  const choice = contactSuggestions.value[contactHighlight.value]
  if (contactSuggestOpen.value && choice) {
    event.preventDefault()
    selectContact(choice.address)
  }
}

function onComposerEscape() {
  if (contactSuggestions.value.length) {
    closeContactSuggest()
    return
  }
  if (store.isAiDraftActive) {
    store.isAiDraftActive = false
    return
  }
  store.closeComposer()
}

const composerToRef = ref(null)
const composerSubjectRef = ref(null)
const composerBodyRef = ref(null)
watch(
  () => store.isComposerActive,
  (active) => {
    if (active) nextTick(() => composerSubjectRef.value?.focus())
  },
  { immediate: true },
)

function onDocumentClick(event) {
  const target = event.target instanceof Element ? event.target : null
  if (!target?.closest('.ni-schedule-wrap')) {
    scheduleSendOpen.value = false
    followUpOpen.value = false
  }
}

// Autosave: every composer field feeds the same debounced save. Attachments
// are watched too — adding or removing one changes the draft just as much as
// typing does.
watch(
  () => [
    store.composerTo,
    store.composerSubject,
    store.composerTextArea,
    store.composerHtml,
    store.composerFollowUpAt,
    store.composerAttachments.map((attachment) => attachment.id).join(','),
  ],
  () => {
    if (store.isComposerActive) store.scheduleComposerDraftSave()
  },
)

// A closing tab never runs the pending debounce, and 'hidden' is the last
// event a mobile browser reliably delivers before backgrounding the page.
function onVisibilityChange() {
  if (document.visibilityState === 'hidden' && store.isComposerActive) {
    store.flushComposerDraft()
  }
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  document.addEventListener('visibilitychange', onVisibilityChange)
})
onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('visibilitychange', onVisibilityChange)
})
</script>

<template>
  <div
    id="composerToast"
    class="composer-toast"
    :class="{ active: store.isComposerActive, 'ai-active': store.isAiDraftActive }"
    @keydown.esc="onComposerEscape"
  >
    <div class="composer-draft-row">
      <div class="composer-draft-title">
        <input
          ref="composerSubjectRef"
          v-model="composerSubject"
          class="composer-subject-inline"
          placeholder="Hello"
          @keydown.tab.exact.prevent="composerToRef?.focus()"
        />
        <span class="composer-draft-to">to</span>
        <span class="composer-to-wrap">
          <input
            ref="composerToRef"
            v-model="store.composerTo"
            class="composer-to-inline"
            type="email"
            multiple
            autocomplete="off"
            placeholder="name@example.com, name2@example.com"
            title="Send to several people by separating addresses with commas"
            @focus="openContactSuggest"
            @input="openContactSuggest"
            @blur="closeContactSuggest"
            @keydown.tab.exact.prevent="composerBodyRef?.focus()"
            @keydown.shift.tab.prevent="composerSubjectRef?.focus()"
            @keydown.down.prevent="moveContactHighlight(1)"
            @keydown.up.prevent="moveContactHighlight(-1)"
            @keydown.enter="onContactEnter"
          />
          <div v-if="contactSuggestions.length" class="composer-suggestions">
            <div
              v-for="(contact, i) in contactSuggestions"
              :key="contact.address"
              class="suggestion-item"
              :class="{ highlighted: i === contactHighlight }"
              @mousedown.prevent="selectContact(contact.address)"
              @mouseenter="contactHighlight = i"
            >
              <span class="material-symbols-outlined text-purple">person</span>
              <span class="composer-suggest-text">
                <span v-if="contact.name" class="composer-suggest-name">{{ contact.name }}</span>
                <span class="composer-suggest-address">{{ contact.address }}</span>
              </span>
            </div>
          </div>
        </span>
      </div>
      <div class="composer-window-actions">
        <button
          class="composer-icon-btn"
          title="Close"
          aria-label="Close composer"
          tabindex="-1"
          @click="store.closeComposer"
        >
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
    </div>
    <div class="composer-body">
      <div class="composer-main">
        <div
          v-if="store.composerAttachments.length"
          class="composer-attachments"
          aria-label="Attachments"
        >
          <div
            v-for="attachment in store.composerAttachments"
            :key="attachment.id"
            class="composer-attachment-chip"
          >
            <span class="material-symbols-outlined" aria-hidden="true">attach_file</span>
            <span class="composer-attachment-name">{{ attachment.filename || 'Attachment' }}</span>
            <span v-if="attachment.size_bytes != null" class="composer-attachment-size">
              {{ formatAttachmentSize(attachment.size_bytes) }}
            </span>
            <button
              type="button"
              class="composer-attachment-remove"
              :aria-label="`Remove ${attachment.filename || 'attachment'}`"
              @click="store.removeComposerAttachment(attachment.id)"
            >
              <span class="material-symbols-outlined" aria-hidden="true">close</span>
            </button>
          </div>
        </div>
        <ComposerEditor
          ref="composerBodyRef"
          v-model="store.composerHtml"
          :snippets="store.snippets"
          :recipient-values="recipientValues"
          @update:text="store.composerTextArea = $event"
          @preview-state="store.composerSnippetPreviewOpen = $event"
          @generate="store.openAiDraft()"
          @focus-prev="composerToRef?.focus()"
        />
      </div>

      <aside class="composer-ai-sidebar" :class="{ active: store.isAiDraftActive }">
        <div class="gemini-draft-header">
          <div class="gemini-badge">
            <span class="material-symbols-outlined gemini-color font-sm">auto_awesome</span>
            <span>Cookie AI</span>
          </div>
          <button
            class="composer-icon-btn"
            title="Close Cookie AI"
            aria-label="Close Cookie AI"
            @click="store.isAiDraftActive = false"
          >
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
        <div class="gemini-draft-preview" :class="{ 'typing-cursor': store.isAiDraftLoading }">
          {{
            store.isAiDraftLoading
              ? 'Drafting…'
              : store.aiDraftPreview || 'Your generated draft will appear here for review.'
          }}
        </div>
        <div class="gemini-draft-actions">
          <button
            class="btn btn-primary composer-send-btn"
            :class="{ highlighted: isSendDisabled }"
            :disabled="!store.aiDraftPreview"
            @click="store.insertAiDraft"
          >
            Insert
          </button>
        </div>
      </aside>
    </div>
    <p v-if="unresolvedFields.length" class="snippet-unresolved-warning" role="alert">
      {{ unresolvedSnippetWarning(unresolvedFields) }}
    </p>
    <div class="composer-footer">
      <div v-if="aiPromptOpen" class="composer-ai-inline">
        <span class="material-symbols-outlined gemini-color" aria-hidden="true">auto_fix_high</span>
        <input
          ref="aiPromptRef"
          v-model="store.composerAiInstruction"
          class="composer-ai-inline-input"
          maxlength="1000"
          placeholder="Describe your message"
          aria-label="Describe your message"
          @keydown.enter.prevent="store.requestAiDraft()"
          @keydown.escape.stop="closeAiPrompt"
        />
        <button
          type="button"
          class="composer-icon-btn composer-ai-close"
          title="Back to send options"
          aria-label="Close Cookie AI prompt"
          @click="closeAiPrompt"
        >
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
      <template v-else>
        <div class="composer-send-actions">
          <div class="composer-send-split">
            <button
              class="btn btn-primary composer-send-btn composer-send-btn-split"
              :disabled="isSendDisabled"
              :aria-busy="store.isSendingEmail"
              @click="store.sendEmail"
            >
              {{ store.isSendingEmail ? 'Sending…' : 'Send' }}
            </button>
            <div class="ni-schedule-wrap ni-schedule-wrap-upward">
              <button
                type="button"
                class="btn btn-primary composer-schedule-caret"
                :disabled="isSendDisabled"
                aria-haspopup="menu"
                :aria-expanded="scheduleSendOpen"
                title="Schedule send"
                aria-label="Schedule send"
                @click="scheduleSendOpen = !scheduleSendOpen"
              >
                <span class="material-symbols-outlined">expand_less</span>
              </button>
              <ScheduleMenu
                v-if="scheduleSendOpen"
                :choices="scheduleSendOptions"
                submit-label="Schedule"
                custom-label="Custom send time"
                @select="selectScheduleSend"
              />
            </div>
          </div>
          <input
            ref="attachInputRef"
            type="file"
            class="composer-attach-input"
            multiple
            tabindex="-1"
            aria-hidden="true"
            @change="onAttachFiles"
          />
          <button
            type="button"
            class="btn btn-text composer-attach-btn"
            :disabled="store.pendingAttachmentUploads > 0"
            :aria-busy="store.pendingAttachmentUploads > 0"
            title="Attach files"
            @click="attachInputRef?.click()"
          >
            <span class="material-symbols-outlined">attach_file</span>
            <span>{{ store.pendingAttachmentUploads > 0 ? 'Uploading…' : 'Attach' }}</span>
          </button>
          <div class="ni-schedule-wrap ni-schedule-wrap-upward">
            <button
              type="button"
              class="btn btn-text composer-follow-up-btn"
              :class="{ active: store.composerFollowUpAt }"
              aria-haspopup="menu"
              :aria-expanded="followUpOpen"
              :title="
                store.composerFollowUpAt ? 'Change follow-up reminder' : 'Remind me if no reply'
              "
              @click="followUpOpen = !followUpOpen"
            >
              <span class="material-symbols-outlined">notification_add</span>
              <span>{{ followUpLabel }}</span>
            </button>
            <ScheduleMenu
              v-if="followUpOpen"
              :choices="followUpOptions"
              submit-label="Remind me"
              custom-label="Custom follow-up time"
              :clear-label="store.composerFollowUpAt ? 'Clear reminder' : ''"
              @select="selectFollowUp"
              @clear="clearFollowUp"
            />
          </div>
        </div>
        <button
          type="button"
          class="composer-ai-toggle"
          title="Write with Cookie AI"
          aria-label="Write with Cookie AI"
          @click="openAiPrompt"
        >
          <span class="material-symbols-outlined gemini-color" aria-hidden="true"
            >auto_fix_high</span
          >
        </button>
      </template>
    </div>
  </div>
</template>
