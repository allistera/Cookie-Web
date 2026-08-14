import { computed, ref } from 'vue'

// Shared with GET/POST/PATCH/DELETE bodies by CalendarSettings' own CRUD
// actions - exported so this stays the single source of truth for the path.
export const CALENDARS_ENDPOINT = '/api/calendar-events?resource=calendars'

// Module-level (not created per useCalendars() call) so CalendarView and
// CalendarSettings share one list: renaming or creating a calendar in
// Settings is visible in the already-mounted Calendar view's sidebar/color
// map immediately, instead of only after a remount re-fetches it.
const calendars = ref([])

const writableCalendars = computed(() => calendars.value.filter((calendar) => !calendar.subscriptionUrl))
const subscribedCalendars = computed(() => calendars.value.filter((calendar) => calendar.subscriptionUrl))

// @param {(init?: HeadersInit) => Promise<HeadersInit>} authHeaders
// @param {(message: string, kind?: string) => void} notify
export function useCalendars(authHeaders, notify) {
  async function loadCalendars() {
    try {
      const headers = await authHeaders()
      const response = await fetch(CALENDARS_ENDPOINT, { headers })
      if (!response.ok) throw new Error(`GET calendars responded ${response.status}`)
      const body = await response.json()
      calendars.value = body.calendars ?? []
    } catch (error) {
      console.error('Failed to load calendars:', error)
      notify('Failed to load calendars.', 'error')
    }
  }

  return { calendars, writableCalendars, subscribedCalendars, loadCalendars }
}
