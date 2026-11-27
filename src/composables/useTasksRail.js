import { createRailState } from '../lib/railState'

// The tasks rail docked on the right of Mail and Documents.
/** @internal */
export const TASKS_RAIL_STORAGE_KEY = 'cookie.tasksRail.open'

// Module-level so the header button and the keyboard shortcut see one state.
const rail = createRailState(TASKS_RAIL_STORAGE_KEY)

export function useTasksRail() {
  return rail
}
