<script setup>
import { computed } from 'vue'
import {
  ArrowRight,
  Bell,
  Calendar,
  Check,
  Clock,
  Construction,
  Layers,
  Pencil,
  Plug,
  RotateCcw,
  Search,
  Send,
  Settings,
  SlidersHorizontal,
  Sparkles,
  X,
} from '@lucide/vue'

const ICONS = {
  'arrow-right': ArrowRight,
  bell: Bell,
  calendar: Calendar,
  check: Check,
  clock: Clock,
  construction: Construction,
  layers: Layers,
  pencil: Pencil,
  plug: Plug,
  'rotate-ccw': RotateCcw,
  search: Search,
  send: Send,
  settings: Settings,
  'sliders-horizontal': SlidersHorizontal,
  sparkles: Sparkles,
  x: X,
}

const props = defineProps({
  name: { type: String, required: true },
  size: { type: Number, default: 18 },
  strokeWidth: { type: Number, default: 2 },
  color: { type: String, default: undefined },
})

const icon = computed(() => ICONS[props.name])
</script>

<template>
  <component :is="icon" v-if="icon" :size="size" :stroke-width="strokeWidth" :color="color" />
</template>
