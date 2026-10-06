<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { useInboxStore } from '../stores/inbox'

const store = useInboxStore()

// Every single-key shortcut the app binds, grouped by where it works. Keep in
// step with the handlers: App.vue ('/', '?', 'u') and TraditionalInboxView's
// onKeydown (the email list, a multi-selection and the open email).
const SECTIONS = [
  {
    title: 'General',
    shortcuts: [
      { keys: ['/'], label: 'Open the command palette' },
      { keys: ['?'], label: 'Show keyboard shortcuts' },
      { keys: ['U'], label: 'Undo the last action' },
    ],
  },
  {
    title: 'Email list',
    shortcuts: [
      { keys: ['↑', '↓'], label: 'Highlight the previous or next email' },
      { keys: ['Enter'], label: 'Open the highlighted email' },
      { keys: ['Space'], label: 'Tick or untick the highlighted email' },
      { keys: ['←', '→'], label: 'Switch inbox tab' },
    ],
  },
  {
    title: 'Ticked emails',
    shortcuts: [
      { keys: ['E'], label: 'Mark done' },
      { keys: ['Shift', 'I'], label: 'Mark read', combo: true },
      { keys: ['#'], label: 'Delete' },
      { keys: ['L'], label: 'Add a label' },
      { keys: ['Esc'], label: 'Clear the selection' },
    ],
  },
  {
    title: 'Open email',
    shortcuts: [
      { keys: ['D'], label: 'Mark done' },
      { keys: ['Esc'], label: 'Close the email' },
    ],
  },
]

const closeButton = ref(null)
let opener = null

function close() {
  store.isShortcutsHelpOpen = false
}

// While open the dialog is the only thing listening: keys are caught on the
// way down and kept from every page shortcut behind it (the inbox's Escape
// would otherwise also clear a selection or close the reader). Tab still moves
// focus, cycling within the dialog.
function onKeydown(event) {
  if (!store.isShortcutsHelpOpen) return
  event.stopPropagation()
  if (event.key === 'Escape' || (event.key === '?' && !event.repeat)) {
    event.preventDefault()
    close()
  } else if (event.key === 'Tab') {
    // The close button is the only control, so focus stays on it.
    event.preventDefault()
    closeButton.value?.focus()
  }
}

// Focus moves to the close button on open and back to whatever had it before
// once the dialog closes.
watch(
  () => store.isShortcutsHelpOpen,
  (isOpen) => {
    if (isOpen) {
      opener = document.activeElement
      nextTick(() => {
        if (store.isShortcutsHelpOpen) closeButton.value?.focus()
      })
    } else if (opener) {
      if (opener.isConnected) opener.focus?.()
      opener = null
    }
  },
  { immediate: true },
)

onMounted(() => window.addEventListener('keydown', onKeydown, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown, true))
</script>

<template>
  <div v-if="store.isShortcutsHelpOpen" class="ks-overlay" @mousedown.self="close">
    <section class="ks-panel" role="dialog" aria-modal="true" aria-labelledby="ks-title">
      <header class="ks-header">
        <h2 id="ks-title">Keyboard shortcuts</h2>
        <button
          ref="closeButton"
          type="button"
          class="ks-close"
          aria-label="Close keyboard shortcuts"
          @click="close"
        >
          <span class="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      </header>
      <div class="ks-sections">
        <section v-for="section in SECTIONS" :key="section.title" class="ks-section">
          <h3>{{ section.title }}</h3>
          <dl>
            <div v-for="shortcut in section.shortcuts" :key="shortcut.label" class="ks-row">
              <dt>
                <template v-for="(key, index) in shortcut.keys" :key="key">
                  <span v-if="index" class="ks-joiner" aria-hidden="true">{{
                    shortcut.combo ? '+' : '/'
                  }}</span>
                  <kbd class="cp-keycap">{{ key }}</kbd>
                </template>
              </dt>
              <dd>{{ shortcut.label }}</dd>
            </div>
          </dl>
        </section>
      </div>
    </section>
  </div>
</template>
