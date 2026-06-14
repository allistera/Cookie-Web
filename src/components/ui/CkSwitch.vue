<script setup>
const model = defineModel({ type: Boolean })

defineProps({
  label: { type: String, default: '' },
})
</script>

<template>
  <label class="ck-switch">
    <input v-model="model" type="checkbox" role="switch" />
    <span class="ck-switch__track"><span class="ck-switch__thumb" /></span>
    <span v-if="label" class="ck-switch__label">{{ label }}</span>
  </label>
</template>
