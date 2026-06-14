<script setup>
import { computed } from 'vue'

const props = defineProps({
  accent: Boolean,
  interactive: Boolean,
  sunken: Boolean,
})

const cls = computed(() =>
  [
    'ck-card',
    props.sunken ? 'ck-card--sunken' : '',
    props.interactive ? 'ck-card--interactive' : '',
    props.accent ? 'ck-card--accent' : '',
  ]
    .filter(Boolean)
    .join(' '),
)
</script>

<template>
  <div :class="cls"><slot /></div>
</template>
