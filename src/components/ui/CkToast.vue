<script setup>
import CkIcon from './CkIcon.vue'

defineProps({
  icon: { type: String, default: undefined },
  title: { type: String, default: undefined },
  message: { type: String, default: undefined },
})

defineEmits(['close'])
</script>

<template>
  <div class="ck-toast" role="status">
    <span v-if="icon" class="ck-toast__icon"><CkIcon :name="icon" :size="16" /></span>
    <div class="ck-toast__body">
      <span v-if="title" class="ck-toast__title">{{ title }}</span>
      <span v-if="message" class="ck-toast__msg">{{ message }}</span>
    </div>
    <button class="ck-toast__close" aria-label="Dismiss" @click="$emit('close')">
      <CkIcon name="x" :size="14" />
    </button>
  </div>
</template>
