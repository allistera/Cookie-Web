<script setup>
import { computed } from 'vue'
import CkIcon from './CkIcon.vue'

const props = defineProps({
  variant: { type: String, default: 'primary' },
  size: { type: String, default: 'md' },
  iconLeft: { type: String, default: undefined },
  iconRight: { type: String, default: undefined },
  block: Boolean,
})

const cls = computed(() =>
  [
    'ck-btn',
    `ck-btn--${props.variant}`,
    props.size === 'sm' ? 'ck-btn--sm' : props.size === 'lg' ? 'ck-btn--lg' : '',
    props.block ? 'ck-btn--block' : '',
  ]
    .filter(Boolean)
    .join(' '),
)

const iconSize = computed(() => (props.size === 'sm' ? 15 : 16))
</script>

<template>
  <button type="button" :class="cls">
    <CkIcon v-if="iconLeft" :name="iconLeft" :size="iconSize" />
    <span v-if="$slots.default"><slot /></span>
    <CkIcon v-if="iconRight" :name="iconRight" :size="16" />
  </button>
</template>
