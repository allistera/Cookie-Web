import { readonly, ref } from 'vue'

// The left sidebars (mail, documents, tasks, calendar) can be dragged wider
// or narrower. The choice is deliberately temporary: it lives in memory for
// this page load only and every reload starts from the default widths.
export const SIDEBAR_MIN_WIDTH = 180
export const SIDEBAR_MAX_WIDTH = 480

// null until the user resizes, so each sidebar keeps its own default width.
const width = ref(null)

export function clampSidebarWidth(value) {
  return Math.round(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, value)))
}

export function useSidebarWidth() {
  return {
    width: readonly(width),
    setWidth(value) {
      width.value = clampSidebarWidth(value)
    },
    resetWidth() {
      width.value = null
    },
  }
}
