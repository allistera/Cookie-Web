<script setup>
import { computed, onMounted, ref } from 'vue'

import { labelChipStyle, normalizeLabelName } from '../lib/taskLabels'
import { useTaskLabelsStore } from '../stores/taskLabels'

// Chips for the labels on a task, and an input that suggests the person's
// other labels as they type. Enter on a name no label has yet still adds
// it: the task write registers it server-side with the default colour.
const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])

const labels = useTaskLabelsStore()
onMounted(() => labels.loadLabels())

const query = ref('')
const focused = ref(false)

const suggestions = computed(() => {
  const prefix = query.value.trim().replace(/^@/, '').toLowerCase()
  return labels.labels
    .filter((label) => !props.modelValue.includes(label.name) && label.name.startsWith(prefix))
    .slice(0, 8)
})
const showSuggestions = computed(() => focused.value && suggestions.value.length > 0)

function chipStyle(name) {
  return labelChipStyle(labels.byName.get(name)?.color)
}

function add(value) {
  const name = normalizeLabelName(value)
  if (!name || props.modelValue.includes(name)) return
  emit('update:modelValue', [...props.modelValue, name])
  query.value = ''
}

function remove(name) {
  emit(
    'update:modelValue',
    props.modelValue.filter((label) => label !== name),
  )
}

function onKeydown(event) {
  if (event.key === 'Enter') {
    event.preventDefault()
    if (query.value.trim()) add(query.value)
    else query.value = ''
  } else if (event.key === 'Backspace' && !query.value && props.modelValue.length) {
    remove(props.modelValue.at(-1))
  } else if (event.key === 'Escape') {
    focused.value = false
  }
}
</script>

<template>
  <div class="task-label-picker">
    <span v-for="name in modelValue" :key="name" class="task-label-chip" :style="chipStyle(name)">
      <span class="task-label-chip-text">@{{ name }}</span>
      <button
        type="button"
        class="task-label-chip-remove"
        :aria-label="`Remove ${name}`"
        :disabled="disabled"
        @click="remove(name)"
      >
        <span class="material-symbols-outlined" aria-hidden="true">close</span>
      </button>
    </span>
    <input
      v-model="query"
      class="task-label-picker-input"
      aria-label="Add label"
      :placeholder="modelValue.length ? '' : 'Add label'"
      :disabled="disabled"
      autocomplete="off"
      @focus="focused = true"
      @blur="focused = false"
      @keydown="onKeydown"
    />
    <!-- mousedown.prevent keeps the input focused, so the list is still
         open when the click lands. -->
    <ul v-if="showSuggestions" class="task-label-suggestions" role="listbox" aria-label="Labels">
      <li v-for="label in suggestions" :key="label.id" role="option">
        <button
          type="button"
          class="task-label-suggestion"
          :style="labelChipStyle(label.color)"
          @mousedown.prevent
          @click="add(label.name)"
        >
          @{{ label.name }}
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.task-label-picker {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
  min-height: 32px;
  padding: 3px 6px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-primary);
}

.task-label-picker:focus-within {
  border-color: var(--text-secondary);
}

.task-label-chip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 1px 4px 1px 7px;
  border-radius: 999px;
  font-size: 12px;
  line-height: 18px;
}

.task-label-chip-remove {
  display: inline-flex;
  align-items: center;
  border: none;
  background: none;
  padding: 0;
  color: inherit;
  cursor: pointer;
  opacity: 0.7;
}

.task-label-chip-remove:hover {
  opacity: 1;
}

.task-label-chip-remove .material-symbols-outlined {
  font-size: 14px;
}

.task-label-picker-input {
  flex: 1;
  min-width: 90px;
  border: none;
  background: transparent;
  font: inherit;
  color: inherit;
  outline: none;
}

.task-label-suggestions {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 5;
  margin: 4px 0 0;
  padding: 4px;
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 160px;
  max-width: 100%;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-primary);
  box-shadow: 0 6px 18px rgb(0 0 0 / 12%);
}

.task-label-suggestion {
  border: none;
  padding: 2px 8px;
  border-radius: 999px;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
</style>
