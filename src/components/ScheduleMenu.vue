<script setup>
import { computed, ref } from 'vue'

defineProps({
  choices: { type: Array, required: true },
})

const emit = defineEmits(['select'])
const showCustom = ref(false)
const customValue = ref('')

const minimumValue = computed(() => {
  const date = new Date(Date.now() + 60 * 1000)
  const offset = date.getTimezoneOffset() * 60 * 1000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
})

const customDate = computed(() => (customValue.value ? new Date(customValue.value) : null))
const customIsValid = computed(
  () =>
    customDate.value && !Number.isNaN(customDate.value.getTime()) && customDate.value > new Date(),
)

function detail(choice) {
  return choice.date.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

function selectCustom() {
  if (!customIsValid.value) return
  const date = customDate.value
  emit('select', {
    id: 'custom',
    label: date.toLocaleString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }),
    date,
  })
}
</script>

<template>
  <div class="ni-schedule-menu" role="menu">
    <button
      v-for="choice in choices"
      :key="choice.id"
      type="button"
      role="menuitem"
      @click="emit('select', choice)"
    >
      <span>{{ choice.label }}</span>
      <span>{{ detail(choice) }}</span>
    </button>
    <button
      type="button"
      role="menuitem"
      aria-haspopup="dialog"
      :aria-expanded="showCustom"
      @click="showCustom = !showCustom"
    >
      <span>Pick date &amp; time</span>
      <span class="material-symbols-outlined" aria-hidden="true">calendar_month</span>
    </button>
    <form
      v-if="showCustom"
      class="ni-schedule-custom"
      aria-label="Custom snooze time"
      @submit.prevent="selectCustom"
    >
      <label>
        <span>Date and time</span>
        <input v-model="customValue" type="datetime-local" :min="minimumValue" required />
      </label>
      <button type="submit" class="ni-schedule-custom-submit" :disabled="!customIsValid">
        Snooze
      </button>
    </form>
  </div>
</template>
