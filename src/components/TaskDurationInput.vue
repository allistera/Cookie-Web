<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  modelValue: { type: Number, default: null },
  disabled: { type: Boolean, default: false },
  saving: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])
const draft = ref('')
const error = ref('')
const editing = ref(false)
watch(
  [() => props.modelValue, () => props.saving],
  ([value, saving]) => {
    if (saving || editing.value) return
    draft.value = value ?? ''
    error.value = ''
  },
  { immediate: true },
)

function save(event) {
  const input = event.target
  if (!input.validity.valid) {
    error.value = 'Enter a whole number from 1 to 1440 minutes.'
    return
  }
  error.value = ''
  editing.value = false
  const value = input.value === '' ? null : Number(input.value)
  emit('update:modelValue', value)
}
</script>

<template>
  <div class="task-duration">
    <div class="task-duration-field">
      <input
        v-model="draft"
        type="number"
        min="1"
        max="1440"
        step="1"
        placeholder="No estimate"
        aria-label="Estimated duration in minutes"
        :aria-invalid="error ? 'true' : undefined"
        :disabled="disabled"
        @input="editing = true"
        @change="save"
      />
      <span>min</span>
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.task-duration-field {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-secondary);
  font-size: 13px;
}
.task-duration-field input {
  width: 100%;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font: inherit;
}
.task-duration-field input:focus-visible {
  outline: 2px solid var(--accent-color);
  outline-offset: 2px;
}
.task-duration p {
  margin: 6px 0 0;
  color: var(--text-secondary);
  font-size: 12px;
}
</style>
