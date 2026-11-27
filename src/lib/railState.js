import { readonly, ref } from 'vue'

// Whether one of the rails docked on the right (calendar, tasks) is open.
// Closed by default; the choice is kept in this browser only (no cross-device
// sync), so a private window or cleared storage starts closed.
export function createRailState(storageKey) {
  function readStored() {
    try {
      return globalThis.localStorage?.getItem(storageKey) === '1'
    } catch {
      return false
    }
  }
  const isOpen = ref(readStored())
  function setOpen(value) {
    isOpen.value = Boolean(value)
    try {
      if (isOpen.value) globalThis.localStorage?.setItem(storageKey, '1')
      else globalThis.localStorage?.removeItem(storageKey)
    } catch {
      // Storage can be blocked; the rail still opens for this page load.
    }
  }
  return {
    isOpen: readonly(isOpen),
    setOpen,
    toggle: () => setOpen(!isOpen.value),
    // Tests start from a clean slate.
    reset: () => {
      isOpen.value = readStored()
    },
  }
}
