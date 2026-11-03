import { readonly, ref } from 'vue'

// The calendar rail docked on the right of Mail, Documents and Tasks. Closed
// by default; the open/closed choice is kept in this browser only (no
// cross-device sync), so a private window or cleared storage starts closed.
export const CALENDAR_RAIL_STORAGE_KEY = 'cookie.calendarRail.open'

function readStored() {
  try {
    return globalThis.localStorage?.getItem(CALENDAR_RAIL_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function writeStored(value) {
  try {
    if (value) globalThis.localStorage?.setItem(CALENDAR_RAIL_STORAGE_KEY, '1')
    else globalThis.localStorage?.removeItem(CALENDAR_RAIL_STORAGE_KEY)
  } catch {
    // Storage can be blocked; the rail still opens for this page load.
  }
}

// Module-level so the header button, the keyboard shortcut and the views that
// hide their own calendar hints all see one state.
const isOpen = ref(readStored())

export function useCalendarRail() {
  function setOpen(value) {
    isOpen.value = Boolean(value)
    writeStored(isOpen.value)
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
