<script setup>
import { computed } from 'vue'
import CkIcon from './CkIcon.vue'

const props = defineProps({
  name: { type: String, required: true },
  label: { type: String, required: true },
  variant: { type: String, default: 'ghost' },
  size: { type: String, default: 'md' },
})

const cls = computed(() =>
  [
    'ck-iconbtn',
    props.size === 'sm' ? 'ck-iconbtn--sm' : '',
    props.variant === 'solid' ? 'ck-iconbtn--solid' : '',
  ]
    .filter(Boolean)
    .join(' '),
)

const iconSize = computed(() => (props.size === 'sm' ? 16 : 18))
</script>

<template>
  <button type="button" :class="cls" :aria-label="label" :title="label">
    <CkIcon :name="name" :size="iconSize" />
  </button>
</template>
