<script setup>
import CkIcon from './CkIcon.vue'

defineProps({
  onRemove: { type: Function, default: undefined },
})
</script>

<template>
  <span class="ck-tag">
    <span><slot /></span>
    <span v-if="onRemove" class="ck-tag__x" role="button" aria-label="Remove" @click="onRemove">
      <CkIcon name="x" :size="11" />
    </span>
  </span>
</template>
