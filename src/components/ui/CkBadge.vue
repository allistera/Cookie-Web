<script setup>
import { computed } from 'vue'

const props = defineProps({
  tone: { type: String, default: 'neutral' },
  dot: Boolean,
})

const cls = computed(() => ['ck-badge', `ck-badge--${props.tone}`, props.dot ? 'ck-badge--dot' : ''].filter(Boolean).join(' '))
</script>

<template>
  <span :class="cls"><slot /></span>
</template>
