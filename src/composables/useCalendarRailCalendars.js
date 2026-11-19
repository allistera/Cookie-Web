import { readonly, ref } from 'vue'

// The calendar list inside the calendar rail (CalendarRail.vue). Kept apart
// from useCalendarRail, which App.vue imports into the entry chunk, so this
// state loads with the rail's own lazy chunk.
//
// The list is a disclosure, open by default; folding it is remembered in this
// browser only, like the rail's open state.
export const CALENDAR_RAIL_LIST_STORAGE_KEY = 'cookie.calendarRail.calendarsOpen'

function readListOpen() {
  try {
    return globalThis.localStorage?.getItem(CALENDAR_RAIL_LIST_STORAGE_KEY) !== '0'
  } catch {
    return true
  }
}

// Module-level so the choices survive the rail remounting between Mail,
// Documents and Tasks.
const isListOpen = ref(readListOpen())
// Calendars hidden from the rail's day. Not stored, so a fresh page load shows
// every calendar again, as the Calendar view does.
const hiddenCalendars = ref(new Set())

export function useCalendarRailCalendars() {
  function toggleList() {
    isListOpen.value = !isListOpen.value
    try {
      // The default (open) is kept as no entry.
      if (isListOpen.value) globalThis.localStorage?.removeItem(CALENDAR_RAIL_LIST_STORAGE_KEY)
      else globalThis.localStorage?.setItem(CALENDAR_RAIL_LIST_STORAGE_KEY, '0')
    } catch {
      // Storage can be blocked; the choice still holds for this page load.
    }
  }
  function toggleCalendar(id) {
    const next = new Set(hiddenCalendars.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    hiddenCalendars.value = next
  }
  return {
    isListOpen: readonly(isListOpen),
    toggleList,
    isCalendarShown: (id) => !hiddenCalendars.value.has(id),
    toggleCalendar,
    // Tests start from a clean slate.
    reset: () => {
      isListOpen.value = readListOpen()
      hiddenCalendars.value = new Set()
    },
  }
}
