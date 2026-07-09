<script setup>
import { computed, ref, nextTick, onMounted, onUnmounted, watch } from 'vue'

import { useInboxStore } from '../stores/inbox'
import { useCommands } from '../composables/useCommands'

const store = useInboxStore()
const { commands, filterCommands } = useCommands()

const query = ref('')
const selectedIndex = ref(0)
const inputRef = ref(null)
const listRef = ref(null)

const visibleCommands = computed(() => filterCommands(commands.value, query.value))

watch(query, () => {
  selectedIndex.value = 0
})

function open() {
  store.isCommandPaletteOpen = true
  query.value = ''
  selectedIndex.value = 0
  nextTick(() => inputRef.value?.focus())
}

function close() {
  store.isCommandPaletteOpen = false
}

// Cmd+K / Ctrl+K toggles the palette. A modifier chord is safe to catch even
// while an input has focus, so no target guard is needed.
function onGlobalKeydown(e) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    if (store.isCommandPaletteOpen) close()
    else open()
  }
}

onMounted(() => document.addEventListener('keydown', onGlobalKeydown))
onUnmounted(() => document.removeEventListener('keydown', onGlobalKeydown))

function move(delta) {
  const count = visibleCommands.value.length
  if (!count) return
  selectedIndex.value = (selectedIndex.value + delta + count) % count
  nextTick(() => {
    listRef.value?.querySelector('.cp-item.selected')?.scrollIntoView?.({ block: 'nearest' })
  })
}

function runCommand(cmd) {
  if (!cmd) return
  if (cmd.comingSoon) {
    store.notify('Coming soon.')
  } else {
    cmd.run()
  }
  close()
}

function runSelected() {
  runCommand(visibleCommands.value[selectedIndex.value])
}

function onInputKeydown(e) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    move(1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    move(-1)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    runSelected()
  } else if (e.key === 'Escape') {
    // Escape must close only the palette — never the reading panel behind it.
    e.preventDefault()
    e.stopPropagation()
    close()
  }
}
</script>

<template>
  <div
    class="cp-overlay"
    :class="{ active: store.isCommandPaletteOpen }"
    @click.self="close"
  >
    <div class="cp-panel" role="dialog" aria-label="Command palette">
      <div class="cp-header">
        <span class="material-symbols-outlined">cookie</span>
        <span>Cookie Command</span>
      </div>
      <input
        ref="inputRef"
        v-model="query"
        class="cp-input"
        type="text"
        aria-label="Search commands"
        @keydown="onInputKeydown"
      />
      <div class="cp-list" ref="listRef">
        <div
          v-for="(cmd, index) in visibleCommands"
          :key="cmd.id"
          class="cp-item"
          :class="{ selected: index === selectedIndex, 'coming-soon': cmd.comingSoon }"
          @mouseenter="selectedIndex = index"
          @click="runCommand(cmd)"
        >
          <span class="cp-item-icon">
            <span class="material-symbols-outlined" :style="cmd.iconColor ? { color: cmd.iconColor } : undefined">{{ cmd.icon }}</span>
          </span>
          <span class="cp-item-title">{{ cmd.title }}</span>
          <span class="cp-soon-tag" v-if="cmd.comingSoon">Soon</span>
          <span class="cp-keycap" v-if="cmd.keyHint">{{ cmd.keyHint }}</span>
        </div>
        <div class="cp-no-results" v-if="!visibleCommands.length">No matching commands</div>
      </div>
    </div>
  </div>
</template>
