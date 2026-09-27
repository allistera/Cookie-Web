import { computed, onBeforeUnmount, onMounted, ref, toValue } from 'vue'

// Two-finger horizontal trackpad swipes (macOS delivers them as wheel events
// with deltaX) move between neighbouring tabs, with the content following
// the fingers like pages laid side by side. Only the given element takes
// part: the browser's own swipe for back/forward keeps working everywhere
// else, since the element alone opts out with overscroll-behavior-x and
// preventDefault.

// Horizontal travel (px) that commits to the next tab.
const COMMIT_DISTANCE = 120
// Silence after the last wheel event that counts as the fingers lifting.
const GESTURE_END_MS = 140
// Momentum keeps sending events after a commit; ignore them until quiet.
const COOLDOWN_QUIET_MS = 220
const SLIDE_MS = 180
// Past the first/last tab the content only moves this fraction, as a hint.
const EDGE_RESISTANCE = 0.25

/**
 * @param {import('vue').MaybeRefOrGetter<HTMLElement | null | undefined>} target
 * @param {{
 *   enabled: () => boolean,
 *   canGo: (direction: 1 | -1) => boolean,
 *   go: (direction: 1 | -1) => void,
 *   reducedMotion?: () => boolean,
 * }} options
 */
export function useSwipeTabs(target, options) {
  const offset = ref(0)
  const animating = ref(false)
  let travel = 0
  let endTimer = null
  let cooldownTimer = null
  let coolingDown = false
  let committing = false
  let element = null

  const reducedMotion =
    options.reducedMotion ??
    (() => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)

  const style = computed(() =>
    offset.value || animating.value
      ? {
          transform: `translateX(${offset.value}px)`,
          transition: animating.value ? `transform ${SLIDE_MS}ms ease-out` : 'none',
        }
      : undefined,
  )

  function slideTo(value) {
    animating.value = true
    offset.value = value
    return new Promise((resolve) => setTimeout(resolve, SLIDE_MS))
  }

  function snapBack() {
    travel = 0
    if (!offset.value) return
    slideTo(0).then(() => {
      if (!committing) animating.value = false
    })
  }

  async function commit(direction) {
    committing = true
    travel = 0
    clearTimeout(endTimer)
    startCooldown()
    const width = element?.clientWidth || 400
    if (reducedMotion()) {
      offset.value = 0
      options.go(direction)
      committing = false
      return
    }
    // Slide the current tab out, switch, bring the new one in from the
    // other side: the tabs read as one strip of pages.
    await slideTo(-direction * width)
    options.go(direction)
    animating.value = false
    offset.value = direction * width
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    await slideTo(0)
    animating.value = false
    committing = false
  }

  function startCooldown() {
    coolingDown = true
    clearTimeout(cooldownTimer)
    cooldownTimer = setTimeout(() => {
      coolingDown = false
    }, COOLDOWN_QUIET_MS)
  }

  /** @param {WheelEvent} event */
  function onWheel(event) {
    if (!options.enabled() || event.ctrlKey) return
    const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY)
    if (!horizontal && !travel) return
    // Claim the gesture here so the browser does not also navigate history.
    event.preventDefault()
    if (coolingDown || committing) {
      // Trailing momentum from a committed swipe; wait for it to stop.
      startCooldown()
      return
    }
    travel -= event.deltaX
    const direction = travel < 0 ? 1 : -1
    const allowed = options.canGo(direction)
    offset.value = allowed ? travel : travel * EDGE_RESISTANCE
    animating.value = false
    clearTimeout(endTimer)
    if (allowed && Math.abs(travel) >= COMMIT_DISTANCE) {
      commit(direction)
      return
    }
    endTimer = setTimeout(snapBack, GESTURE_END_MS)
  }

  onMounted(() => {
    element = toValue(target) ?? null
    element?.addEventListener('wheel', onWheel, { passive: false })
  })

  onBeforeUnmount(() => {
    element?.removeEventListener('wheel', onWheel)
    clearTimeout(endTimer)
    clearTimeout(cooldownTimer)
  })

  return { offset, style }
}
