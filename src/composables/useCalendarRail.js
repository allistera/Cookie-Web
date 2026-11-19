import { readonly, ref } from 'vue'

// The calendar rail docked on the right of Mail, Documents and Tasks. Closed
// by default; the open/closed choice is kept in this browser only (no
// cross-device sync), so a private window or cleared storage starts closed.
export const CALENDAR_RAIL_STORAGE_KEY = 'cookie.calendarRail.open'
// The rail's calendar list is a disclosure, open by default; folding it is
// remembered the same way.
export const CALENDAR_RAIL_LIST_STORAGE_KEY = 'cookie.calendarRail.calendarsOpen'

function readStored(key, fallback) {
  try {
    const value = globalThis.localStorage?.getItem(key)
    return value == null ? fallback : value === '1'
  } catch {
    return fallback
  }
}

// The default is kept as no entry, so storage only holds a departure from it.
function writeStored(key, value, fallback) {
  try {
    if (value === fallback) globalThis.localStorage?.removeItem(key)
    else globalThis.localStorage?.setItem(key, value ? '1' : '0')
  } catch {
    // Storage can be blocked; the choice still holds for this page load.
  }
}

// Module-level so the header button, the keyboard shortcut and the views that
// hide their own calendar hints all see one state.
const isOpen = ref(readStored(CALENDAR_RAIL_STORAGE_KEY, false))
const isListOpen = ref(readStored(CALENDAR_RAIL_LIST_STORAGE_KEY, true))
// Calendars hidden from the rail's day. Module-level so the choice survives
// the rail remounting between Mail, Documents and Tasks; it is not stored, so
// a fresh page load shows every calendar again, as the Calendar view does.
const hiddenCalendars = ref(new Set())

export function useCalendarRail() {
  function setOpen(value) {
    isOpen.value = Boolean(value)
    writeStored(CALENDAR_RAIL_STORAGE_KEY, isOpen.value, false)
  }
  function setListOpen(value) {
    isListOpen.value = Boolean(value)
    writeStored(CALENDAR_RAIL_LIST_STORAGE_KEY, isListOpen.value, true)
  }
  function toggleCalendar(id) {
    const next = new Set(hiddenCalendars.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    hiddenCalendars.value = next
  }
  return {
    isOpen: readonly(isOpen),
    setOpen,
    toggle: () => setOpen(!isOpen.value),
    isListOpen: readonly(isListOpen),
    toggleList: () => setListOpen(!isListOpen.value),
    isCalendarShown: (id) => !hiddenCalendars.value.has(id),
    toggleCalendar,
    // Tests start from a clean slate.
    reset: () => {
      isOpen.value = readStored(CALENDAR_RAIL_STORAGE_KEY, false)
      isListOpen.value = readStored(CALENDAR_RAIL_LIST_STORAGE_KEY, true)
      hiddenCalendars.value = new Set()
    },
  }
}
