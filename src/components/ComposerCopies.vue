<script setup>
// The Cc and Bcc lines: under the "to" field in the composer window, and
// under the heading of the reader's reply box. A line shows once it is added
// ("+ cc", "+ bcc") or holds an address. Each is a comma-separated list like
// the "to" field, with the same contact suggestions.
import { computed, nextTick, reactive, ref } from 'vue'

import { filterContacts } from '../lib/contactSuggest'
import { appendRecipient, completedRecipients, currentRecipientToken } from '../lib/recipients'

const props = defineProps({
  cc: { type: String, default: '' },
  bcc: { type: String, default: '' },
  contacts: { type: Array, default: () => [] },
  // Whether the "+ cc" and "+ bcc" links and the remove buttons are on offer:
  // the composer shows them while its header has the focus.
  editing: { type: Boolean, default: true },
})

// exit: the keyboard focus is leaving these lines. 'forward' is Tab past the
// last one (on to the message body); 'back' is a removed line that had the
// focus and no other line to hand it to.
const emit = defineEmits(['update:cc', 'update:bcc', 'exit'])

const KINDS = ['cc', 'bcc']
const LABELS = { cc: 'Cc', bcc: 'Bcc' }

// Added by hand and maybe still empty; a line with an address shows anyway.
const added = reactive({ cc: false, bcc: false })
const shown = computed(() => KINDS.filter((kind) => added[kind] || props[kind].trim()))
const offered = computed(() =>
  props.editing ? KINDS.filter((kind) => !shown.value.includes(kind)) : [],
)

const inputs = {}

function focusLine(kind) {
  const input = inputs[kind]
  if (!input) return false
  input.focus()
  return true
}

async function add(kind) {
  added[kind] = true
  await nextTick()
  focusLine(kind)
}

function remove(kind) {
  const hadFocus = document.activeElement === inputs[kind]
  added[kind] = false
  closeSuggest()
  emit(`update:${kind}`, '')
  if (!hadFocus) return
  const other = shown.value.find((line) => line !== kind)
  if (!other || !focusLine(other)) emit('exit', 'back')
}

// One line suggests at a time: the one being typed in.
const suggestFor = ref(null)
const highlight = ref(-1)
const suggestions = computed(() => {
  const value = props[suggestFor.value]
  if (!value) return []
  const already = new Set(completedRecipients(value).map((address) => address.toLowerCase()))
  const pool = props.contacts.filter((contact) => !already.has(contact.address.toLowerCase()))
  return filterContacts(pool, currentRecipientToken(value))
})

function openSuggest(kind) {
  suggestFor.value = kind
  highlight.value = -1
}

function closeSuggest() {
  suggestFor.value = null
  highlight.value = -1
}

function moveHighlight(delta) {
  const count = suggestions.value.length
  if (!count) return
  highlight.value = (highlight.value + delta + count) % count
}

function pick(kind, address) {
  emit(`update:${kind}`, appendRecipient(props[kind], address))
  closeSuggest()
  focusLine(kind)
}

function onInput(kind, event) {
  emit(`update:${kind}`, event.target.value)
  openSuggest(kind)
}

function onEnter(kind, event) {
  const choice = suggestions.value[highlight.value]
  if (!choice) return
  event.preventDefault()
  pick(kind, choice.address)
}

// Escape closes the suggestions first; only a second press reaches whatever
// the parent does with it (closing the composer).
function onEscape(event) {
  if (!suggestions.value.length) return
  event.stopPropagation()
  closeSuggest()
}

function onTab(kind, event) {
  if (shown.value.at(-1) !== kind) return
  event.preventDefault()
  emit('exit', 'forward')
}

defineExpose({
  // Puts away the lines that were added and left empty.
  collapse() {
    added.cc = false
    added.bcc = false
  },
  focusFirst: () => focusLine(shown.value[0]),
  focusLast: () => focusLine(shown.value.at(-1)),
})
</script>

<template>
  <div v-if="shown.length" class="composer-copy-rows">
    <div v-for="kind in shown" :key="kind" class="composer-copy-row" :data-copy="kind">
      <span class="composer-copy-label" aria-hidden="true">{{ kind }}</span>
      <span class="composer-to-wrap">
        <input
          :ref="(element) => (inputs[kind] = element)"
          :value="props[kind]"
          class="composer-copy-input"
          type="email"
          multiple
          autocomplete="off"
          placeholder="name@example.com"
          :aria-label="LABELS[kind]"
          :title="`${LABELS[kind]} several people by separating addresses with commas`"
          @input="onInput(kind, $event)"
          @focus="openSuggest(kind)"
          @blur="closeSuggest"
          @keydown.tab.exact="onTab(kind, $event)"
          @keydown.down.prevent="moveHighlight(1)"
          @keydown.up.prevent="moveHighlight(-1)"
          @keydown.enter="onEnter(kind, $event)"
          @keydown.esc="onEscape"
        />
        <div v-if="suggestFor === kind && suggestions.length" class="composer-suggestions">
          <div
            v-for="(contact, i) in suggestions"
            :key="contact.address"
            class="suggestion-item"
            :class="{ highlighted: i === highlight }"
            @mousedown.prevent="pick(kind, contact.address)"
            @mouseenter="highlight = i"
          >
            <span class="material-symbols-outlined text-purple">person</span>
            <span class="composer-suggest-text">
              <span v-if="contact.name" class="composer-suggest-name">{{ contact.name }}</span>
              <span class="composer-suggest-address">{{ contact.address }}</span>
            </span>
          </div>
        </div>
      </span>
      <!-- mousedown is cancelled on these controls so a click leaves the focus
           where it was: the header keeps it, and its links stay on offer. -->
      <button
        v-if="editing"
        type="button"
        class="composer-icon-btn composer-copy-remove"
        :title="`Remove ${LABELS[kind]}`"
        :aria-label="`Remove ${LABELS[kind]}`"
        tabindex="-1"
        @mousedown.prevent
        @click="remove(kind)"
      >
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>
  </div>
  <div v-if="offered.length" class="composer-copy-links">
    <button
      v-for="kind in offered"
      :key="kind"
      type="button"
      class="composer-copy-add"
      :aria-label="`Add ${LABELS[kind]}`"
      tabindex="-1"
      @mousedown.prevent
      @click="add(kind)"
    >
      + {{ kind }}
    </button>
  </div>
</template>
