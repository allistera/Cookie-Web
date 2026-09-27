<script setup>
import { onBeforeUnmount, ref } from 'vue'

import {
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  useSidebarWidth,
} from '../composables/useSidebarWidth'

// A drag handle placed right after a left sidebar. Dragging, or the arrow
// keys, sets a temporary width shared by all sidebars (see
// useSidebarWidth); double-click or Escape returns to the default.
const KEY_STEP = 16

const { width, setWidth, resetWidth } = useSidebarWidth()
const handle = ref(null)
const dragging = ref(false)
let startX = 0
let startWidth = 0

function sidebarWidth() {
  return width.value ?? handle.value?.previousElementSibling?.offsetWidth ?? SIDEBAR_MIN_WIDTH
}

function onPointerDown(event) {
  if (event.button !== 0) return
  event.preventDefault()
  startX = event.clientX
  startWidth = sidebarWidth()
  dragging.value = true
  handle.value?.setPointerCapture?.(event.pointerId)
  document.body.classList.add('sidebar-resizing')
}

function onPointerMove(event) {
  if (!dragging.value) return
  setWidth(startWidth + event.clientX - startX)
}

function stopDragging() {
  if (!dragging.value) return
  dragging.value = false
  document.body.classList.remove('sidebar-resizing')
}

function onKeydown(event) {
  const current = sidebarWidth()
  const next = {
    ArrowLeft: current - KEY_STEP,
    ArrowRight: current + KEY_STEP,
    Home: SIDEBAR_MIN_WIDTH,
    End: SIDEBAR_MAX_WIDTH,
  }[event.key]
  if (event.key === 'Escape') {
    resetWidth()
  } else if (next === undefined) {
    return
  } else {
    setWidth(next)
  }
  event.preventDefault()
}

onBeforeUnmount(stopDragging)
</script>

<template>
  <div
    ref="handle"
    class="sidebar-resizer"
    :class="{ dragging }"
    role="separator"
    aria-orientation="vertical"
    aria-label="Resize sidebar"
    :aria-valuemin="SIDEBAR_MIN_WIDTH"
    :aria-valuemax="SIDEBAR_MAX_WIDTH"
    :aria-valuenow="width ?? undefined"
    tabindex="0"
    title="Drag to resize the sidebar. Double-click to reset."
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="stopDragging"
    @pointercancel="stopDragging"
    @lostpointercapture="stopDragging"
    @dblclick="resetWidth"
    @keydown="onKeydown"
  ></div>
</template>

<style scoped>
.sidebar-resizer {
  position: relative;
  flex: 0 0 6px;
  margin: 0 -3px;
  cursor: col-resize;
  touch-action: none;
  z-index: 2;
}

/* A thin line that appears on hover, focus and while dragging. */
.sidebar-resizer::after {
  content: '';
  position: absolute;
  top: 8px;
  bottom: 8px;
  left: 2px;
  width: 2px;
  border-radius: 1px;
  background: transparent;
  transition: background-color 0.15s;
}

.sidebar-resizer:hover::after,
.sidebar-resizer.dragging::after,
.sidebar-resizer:focus-visible::after {
  background: var(--accent-color);
}

.sidebar-resizer:focus-visible {
  outline: none;
}

@media (max-width: 760px) {
  .sidebar-resizer {
    display: none;
  }
}
</style>
