<script setup>
import { computed } from 'vue'

const props = defineProps({
  name: { type: String, default: '' },
  src: { type: String, default: undefined },
  size: { type: String, default: 'md' },
  square: Boolean,
  tone: { type: String, default: undefined },
})

const initials = computed(() =>
  props.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join(''),
)

const cls = computed(() =>
  ['ck-avatar', `ck-avatar--${props.size}`, props.square ? 'ck-avatar--sq' : ''].filter(Boolean).join(' '),
)
</script>

<template>
  <span :class="cls" :style="tone ? { background: tone } : undefined" :title="name">
    <img v-if="src" :src="src" :alt="name" />
    <template v-else>{{ initials || '?' }}</template>
  </span>
</template>
