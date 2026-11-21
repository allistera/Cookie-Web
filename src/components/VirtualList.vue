<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { rowIndexAtOffset } from '../lib/virtualRows'

const props = defineProps({
  items: { type: Array, required: true },
  estimate: { type: Function, default: () => 40 },
})
const viewport = ref(null)
const scrollTop = ref(0)
const viewportHeight = ref(800)
const revision = ref(0)
const heights = new Map()
let observer
let measurementFrame
const pendingMeasurements = new Map()
let anchor = null
const focusedKey = ref(null)
const rowElements = new Map()

const layout = computed(() => {
  void revision.value
  let top = 0
  return props.items.map((item) => {
    const height = heights.get(item.key) ?? props.estimate(item)
    const row = { item, top, height }
    top += height
    return row
  })
})
const totalHeight = computed(() => {
  const last = layout.value.at(-1)
  return last ? last.top + last.height : 0
})
const rowsByKey = computed(() => new Map(layout.value.map((row) => [row.item.key, row])))
const windowRows = computed(() => {
  // Keep a focused row mounted for keyboard users even as they scroll,
  // preserving DOM order so Vue does not relocate and blur the focused node.
  const start = Math.max(0, scrollTop.value - 400)
  const end = scrollTop.value + viewportHeight.value + 400
  const rows = layout.value.slice(
    rowIndexAtOffset(layout.value, start),
    rowIndexAtOffset(layout.value, end) + 1,
  )
  const focused = rowsByKey.value.get(focusedKey.value)
  if (focused && !rows.includes(focused)) {
    if (rows.length && focused.top < rows[0].top) rows.unshift(focused)
    else rows.push(focused)
  }
  return rows
})

function onScroll() {
  scrollTop.value = viewport.value?.scrollTop ?? 0
  const index = rowIndexAtOffset(layout.value, scrollTop.value)
  const first = layout.value[index]
  anchor = first ? { key: first.item.key, index, offset: scrollTop.value - first.top } : null
}

function restoreAnchor(preservePositionWhenMissing = false) {
  if (!viewport.value) return
  const row = anchor && rowsByKey.value.get(anchor.key)
  if (row) {
    viewport.value.scrollTop = row.top + anchor.offset
  } else if (preservePositionWhenMissing && anchor && layout.value.length) {
    const fallback = layout.value[Math.min(anchor.index, layout.value.length - 1)]
    viewport.value.scrollTop = fallback ? fallback.top + anchor.offset : 0
  } else {
    viewport.value.scrollTop = 0
  }
  onScroll()
}

watch(
  () => props.items,
  async (nextItems, prevItems) => {
    const keys = new Set(nextItems.map((item) => item.key))
    const overlaps = Boolean(prevItems?.some((item) => keys.has(item.key)))
    for (const key of heights.keys()) if (!keys.has(key)) heights.delete(key)
    await nextTick()
    restoreAnchor(overlaps)
  },
)

function observeRow(key, element) {
  const previous = rowElements.get(key)
  if (previous === element) return
  if (previous) observer?.unobserve(previous)
  if (element) {
    rowElements.set(key, element)
    observer?.observe(element)
  } else rowElements.delete(key)
}

function scrollToKey(key) {
  const row = rowsByKey.value.get(key)
  if (!row || !viewport.value) return
  const bottom = row.top + row.height
  if (row.top < viewport.value.scrollTop) viewport.value.scrollTop = row.top
  else if (bottom > viewport.value.scrollTop + viewportHeight.value) {
    viewport.value.scrollTop = bottom - viewportHeight.value
  }
  onScroll()
}

// Puts keyboard focus on a row's content (the slot's root element, which the
// caller makes focusable), scrolling the row into the window first: a row
// outside it is not mounted until the next render.
async function focusKey(key) {
  scrollToKey(key)
  await nextTick()
  rowElements.get(key)?.firstElementChild?.focus({ preventScroll: true })
}

onMounted(() => {
  viewportHeight.value = viewport.value.clientHeight || 800
  if (globalThis.ResizeObserver) {
    observer = new ResizeObserver((entries) => {
      for (const entry of entries) pendingMeasurements.set(entry.target, entry)
      if (measurementFrame !== undefined) return
      measurementFrame = requestAnimationFrame(() => {
        measurementFrame = undefined
        const entries = [...pendingMeasurements.values()]
        pendingMeasurements.clear()
        let changed = false
        let changedAboveAnchor = false
        for (const entry of entries) {
          if (entry.target === viewport.value) {
            viewportHeight.value = entry.contentRect.height || 800
          } else {
            const key = entry.target.dataset.virtualKey
            const height =
              entry.borderBoxSize?.[0]?.blockSize ?? entry.target.getBoundingClientRect().height
            if (height > 0 && heights.get(key) !== height) {
              const existing = rowsByKey.value.get(key)
              if (existing && existing.top <= scrollTop.value) changedAboveAnchor = true
              heights.set(key, height)
              changed = true
            }
          }
        }
        if (changed) {
          revision.value += 1
          if (changedAboveAnchor) nextTick(() => restoreAnchor(true))
        }
      })
    })
    observer.observe(viewport.value)
    rowElements.forEach((element) => observer.observe(element))
  }
})
onBeforeUnmount(() => {
  observer?.disconnect()
  if (measurementFrame !== undefined) cancelAnimationFrame(measurementFrame)
  pendingMeasurements.clear()
})
defineExpose({ focusKey, scrollToKey })
</script>

<template>
  <div
    ref="viewport"
    class="virtual-list"
    @scroll.passive="onScroll"
    @focusin="focusedKey = $event.target.closest('[data-virtual-key]')?.dataset.virtualKey"
    @focusout="focusedKey = null"
  >
    <div class="virtual-content" :style="{ height: totalHeight + 'px' }">
      <div
        v-for="row in windowRows"
        :key="row.item.key"
        :ref="(element) => observeRow(row.item.key, element)"
        :data-virtual-key="row.item.key"
        class="virtual-row"
        :style="{ transform: `translateY(${row.top}px)` }"
      >
        <slot :item="row.item" />
      </div>
    </div>
    <div class="virtual-footer"><slot name="footer" /></div>
  </div>
</template>

<style scoped>
.virtual-list {
  overflow-y: auto;
  overflow-anchor: none;
  min-height: 0;
}
.virtual-content {
  position: relative;
  flex-shrink: 0;
}
.virtual-row {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flow-root;
}
.virtual-footer {
  flex-shrink: 0;
}
</style>
