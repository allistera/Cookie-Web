<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import { useInboxStore } from '../stores/inbox'
import { filterContacts } from '../lib/contactSuggest'
import {
  appendRecipient,
  completedRecipients,
  currentRecipientToken,
  recipientsValid,
} from '../lib/recipients'
import { scheduleChoices } from '../utils/schedule'
import ComposerEditor from './ComposerEditor.vue'
import ScheduleMenu from './ScheduleMenu.vue'

const store = useInboxStore()

const contactSuggestOpen = ref(false)
const contactHighlight = ref(-1)
const contactSuggestions = computed(() => {
  if (!contactSuggestOpen.value) return []
  const already = new Set(completedRecipients(store.composerTo).map((a) => a.toLowerCase()))
  const pool = store.contacts.filter((contact) => !already.has(contact.address.toLowerCase()))
  return filterContacts(pool, currentRecipientToken(store.composerTo))
})

const composerToValid = computed(() => recipientsValid(store.composerTo))
const isSendDisabled = computed(
  () => store.isSendingEmail || !composerToValid.value || !store.composerTextArea.trim(),
)

const scheduleSendOpen = ref(false)
const scheduleSendOptions = computed(() => (scheduleSendOpen.value ? scheduleChoices() : []))

function selectScheduleSend(choice) {
  scheduleSendOpen.value = false
  store.sendEmailLater(choice.date.toISOString(), choice.label)
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
  if (!target?.closest('.ni-schedule-wrap')) scheduleSendOpen.value = false
}

onMounted(() => document.addEventListener('click', onDocumentClick))
onUnmounted(() => document.removeEventListener('click', onDocumentClick))
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
          v-model="store.composerSubject"
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
            placeholder="name@example.com"
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
        <button class="composer-icon-btn" title="Close" tabindex="-1" @click="store.closeComposer">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
    </div>
    <div class="composer-body">
      <div class="composer-main">
        <ComposerEditor
          ref="composerBodyRef"
          v-model="store.composerHtml"
          :snippets="store.snippets"
          @update:text="store.composerTextArea = $event"
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
          <button class="composer-icon-btn" title="Close Cookie AI" @click="store.isAiDraftActive = false">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
        <div class="gemini-draft-preview" :class="{ 'typing-cursor': store.isAiDraftLoading }">
          {{ store.isAiDraftLoading ? 'Drafting…' : store.aiDraftPreview || 'Your generated draft will appear here for review.' }}
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
    <div class="composer-footer">
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
              @click="scheduleSendOpen = !scheduleSendOpen"
            >
              <span class="material-symbols-outlined">expand_less</span>
            </button>
            <ScheduleMenu
              v-if="scheduleSendOpen"
              :choices="scheduleSendOptions"
              submit-label="Schedule"
              @select="selectScheduleSend"
            />
          </div>
        </div>
      </div>
      <div class="composer-ai-inline">
        <span class="material-symbols-outlined">auto_fix_high</span>
        <input
          v-model="store.composerAiInstruction"
          class="composer-ai-inline-input"
          maxlength="1000"
          placeholder="Describe your message"
          @keydown.enter.prevent="store.requestAiDraft"
        />
      </div>
    </div>
  </div>
</template>
