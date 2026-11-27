import { createRailState } from '../lib/railState'

// The calendar rail docked on the right of Mail, Documents and Tasks.
/** @internal */
export const CALENDAR_RAIL_STORAGE_KEY = 'cookie.calendarRail.open'

// Module-level so the header button, the keyboard shortcut and the views that
// hide their own calendar hints all see one state.
const rail = createRailState(CALENDAR_RAIL_STORAGE_KEY)

export function useCalendarRail() {
  return rail
}
