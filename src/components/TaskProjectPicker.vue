<script setup>
import { computed, nextTick, ref, watch } from 'vue'

import { userInitial } from '../lib/taskDetail'
import { projectPickerRows } from '../lib/taskProjectsTree'
import { useProjectsStore } from '../stores/projects'

// The task panel's project chip and the list it drops: a search box, the
// Inbox, then "My Projects" with every project at its depth in the tree.
// Choosing a row is a move; null stands for the Inbox, as it does on the
// wire. Shaped after Todoist's project picker.
const props = defineProps({
  modelValue: { type: String, default: null },
  ownerName: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue'])

const projects = useProjectsStore()
const open = ref(false)
const query = ref('')
const active = ref(0)
const root = ref(null)
const button = ref(null)
const input = ref(null)
const list = ref(null)

const rows = computed(() => projectPickerRows(projects.projects, query.value))
// Where the "My Projects" heading goes: above the first project row.
const firstProjectIndex = computed(() => rows.value.findIndex((row) => !row.inbox))
const currentName = computed(
  () =>
    (props.modelValue && projects.projects.find((row) => row.id === props.modelValue)?.name) ??
    'Inbox',
)
const initial = computed(() => (props.ownerName ? userInitial(props.ownerName) : ''))

function optionId(row) {
  return `task-project-option-${row.id ?? 'inbox'}`
}
const activeId = computed(() => {
  const row = rows.value[active.value]
  return row ? optionId(row) : undefined
})

function scrollActiveIntoView() {
  list.value?.querySelector('.active')?.scrollIntoView?.({ block: 'nearest' })
}

// Typing reads from the top of the matches; an empty box starts on the
// task's own project, so Enter without a search leaves it where it is.
watch(query, () => {
  active.value = 0
})
watch(rows, () => {
  if (active.value >= rows.value.length) active.value = Math.max(0, rows.value.length - 1)
})

async function openPicker() {
  if (open.value) return
  query.value = ''
  open.value = true
  await nextTick()
  active.value = Math.max(
    0,
    rows.value.findIndex((row) => row.id === props.modelValue),
  )
  input.value?.focus()
  await nextTick()
  scrollActiveIntoView()
}

function close({ refocus = true } = {}) {
  if (!open.value) return
  open.value = false
  if (refocus) button.value?.focus()
}

function toggle() {
  if (open.value) close()
  else void openPicker()
}

function choose(row) {
  if (row.id !== props.modelValue) emit('update:modelValue', row.id)
  close()
}

function move(step) {
  const count = rows.value.length
  if (!count) return
  active.value = (active.value + step + count) % count
  void nextTick(scrollActiveIntoView)
}

function onKeydown(event) {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    move(1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    move(-1)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    const row = rows.value[active.value]
    if (row) choose(row)
  } else if (event.key === 'Escape') {
    // Escape with the list open is asking to leave the list, not the panel.
    event.stopPropagation()
    close()
  } else if (event.key === 'Tab') {
    close({ refocus: false })
  }
}

// Focus leaving the picker (a click elsewhere in the panel, Tab out) closes
// it; the list stops its own mousedown so a click on a row does not count.
function onFocusOut(event) {
  if (event.relatedTarget instanceof Node && root.value?.contains(event.relatedTarget)) return
  close({ refocus: false })
}

defineExpose({ open: openPicker })
</script>

<template>
  <div ref="root" class="task-project-picker" @focusout="onFocusOut">
    <button
      ref="button"
      type="button"
      class="task-panel-project"
      title="Project"
      :aria-label="`Project: ${currentName}`"
      aria-haspopup="listbox"
      :aria-expanded="open ? 'true' : 'false'"
      @click="toggle"
    >
      <span v-if="modelValue" class="project-symbol" aria-hidden="true"></span>
      <span v-else class="material-symbols-outlined" aria-hidden="true">inbox</span>
      <span class="task-panel-project-name">{{ currentName }}</span>
      <span class="material-symbols-outlined task-panel-project-chevron" aria-hidden="true"
        >expand_more</span
      >
    </button>
    <div v-if="open" class="task-project-menu">
      <input
        ref="input"
        v-model="query"
        type="text"
        class="task-project-search"
        role="combobox"
        aria-label="Project"
        aria-autocomplete="list"
        aria-expanded="true"
        aria-controls="task-project-options"
        :aria-activedescendant="activeId"
        autocomplete="off"
        placeholder="Type a project name"
        @keydown="onKeydown"
      />
      <ul
        id="task-project-options"
        ref="list"
        class="task-project-options"
        role="listbox"
        aria-label="Projects"
        @mousedown.prevent
      >
        <template v-for="(row, index) in rows" :key="row.id ?? 'inbox'">
          <li v-if="index === firstProjectIndex" class="task-project-heading" role="presentation">
            <span v-if="initial" class="task-project-avatar" aria-hidden="true">{{ initial }}</span>
            My Projects
          </li>
          <li
            :id="optionId(row)"
            class="task-project-option"
            :class="{ active: index === active, selected: row.id === modelValue }"
            role="option"
            :aria-selected="row.id === modelValue ? 'true' : 'false'"
            :style="{ '--depth': row.depth }"
            @click="choose(row)"
            @mousemove="active = index"
          >
            <span v-if="row.inbox" class="material-symbols-outlined" aria-hidden="true">inbox</span>
            <span v-else class="project-symbol" aria-hidden="true"></span>
            <span class="task-project-option-name">{{ row.name }}</span>
            <span
              v-if="row.id === modelValue"
              class="material-symbols-outlined task-project-check"
              aria-hidden="true"
              >check</span
            >
          </li>
        </template>
      </ul>
      <p v-if="!rows.length" class="task-project-empty">No matching projects.</p>
    </div>
  </div>
</template>

<style scoped>
.task-project-picker {
  position: relative;
}

/* The chip reads as a button: the project's mark, its name and a chevron. */
.task-panel-project {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 280px;
  padding: 6px 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: transparent;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  cursor: pointer;
}

.task-panel-project:hover,
.task-panel-project[aria-expanded='true'] {
  background: var(--bg-hover);
}

.task-panel-project:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.task-panel-project .material-symbols-outlined {
  font-size: 18px;
  color: var(--text-secondary);
}

.task-panel-project-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-panel-project-chevron {
  pointer-events: none;
}

/* The same text marker the sidebar gives a project: generated content, so a
   row's rendered text stays just its name. */
.project-symbol {
  width: 18px;
  flex: 0 0 auto;
  color: var(--text-secondary);
  font-size: 15px;
  text-align: center;
}

.project-symbol::before {
  content: '#';
}

/* The list drops out of the chip, over the body. The panel is the stacking
   context, so z-index only has to clear the body's content. */
.task-project-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 1;
  width: 300px;
  max-width: calc(100vw - 32px);
  padding: 10px 10px 4px;
  background: var(--bg-dialog);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  box-shadow: var(--shadow-lg);
}

.task-project-search {
  width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
  font: inherit;
  font-size: 15px;
  color: var(--text-primary);
}

.task-project-search::placeholder {
  color: var(--text-secondary);
}

.task-project-search:focus {
  outline: none;
  border-color: var(--accent);
}

.task-project-options {
  max-height: 320px;
  margin: 10px -10px 0;
  padding: 0 0 4px;
  overflow-y: auto;
  list-style: none;
}

.task-project-option,
.task-project-heading {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
  padding: 6px 16px;
  font-size: 15px;
}

.task-project-option {
  padding-left: calc(16px + var(--depth, 0) * 24px);
  color: var(--text-primary);
  cursor: pointer;
}

.task-project-option .material-symbols-outlined {
  font-size: 20px;
  color: var(--text-secondary);
}

.task-project-option.active,
.task-project-option.selected {
  background: var(--bg-hover);
}

.task-project-option-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-project-option .task-project-check {
  margin-left: auto;
  font-size: 18px;
  color: #d1453b;
}

.task-project-heading {
  font-weight: 700;
  color: var(--text-primary);
}

.task-project-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--accent);
  color: white;
  font-size: 12px;
  font-weight: 700;
}

.task-project-empty {
  margin: 0;
  padding: 8px 16px 10px;
  font-size: 14px;
  color: var(--text-secondary);
}
</style>
