import { computed, ref } from 'vue'

// Shared with GET/POST/PATCH/DELETE bodies by CalendarSettings' own CRUD
// actions - exported so this stays the single source of truth for the path.
import { CALENDAR_API_URL } from '../lib/apiWorkers'

export const CALENDARS_ENDPOINT = `${CALENDAR_API_URL}/calendars`

// Module-level (not created per useCalendars() call) so CalendarView and
// CalendarSettings share one list: renaming or creating a calendar in
// Settings is visible in the already-mounted Calendar view's sidebar/color
// map immediately, instead of only after a remount re-fetches it.
const calendars = ref([])

// Module-level like `calendars` above: CalendarView and DocumentCalendarSidebar
// both call loadCalendars() on mount (often within moments of each other, e.g.
// navigating from Documents straight to Calendar), and without this guard each
// call fired its own GET /calendars. Mutations
// (create/rename/delete/sync) already write straight into `calendars.value`
// rather than refetching, so treating a successful load as good until an
// explicit force is the same "loaded once, refresh on demand" idiom the inbox
// store uses for isInboxStateLoaded.
let loaded = false
let inFlight = null
let owner = null
let generation = 0

// App sets this synchronously at the authentication boundary. Outstanding
// reads and syncs from the previous account must never repopulate the cache.
export function setCalendarsOwner(sub) {
  if (owner === (sub || null)) return
  owner = sub || null
  resetCalendarsState()
}

export const calendarSession = () => generation
export const isCalendarSessionCurrent = (session) => session === generation

const writableCalendars = computed(() =>
  calendars.value.filter((calendar) => !calendar.subscriptionUrl),
)
const subscribedCalendars = computed(() =>
  calendars.value.filter((calendar) => calendar.subscriptionUrl),
)

// @param {(init?: HeadersInit) => Promise<HeadersInit>} authHeaders
// @param {(message: string, kind?: string) => void} notify
export function useCalendars(authHeaders, notify) {
  function loadCalendars({ force = false } = {}) {
    if (loaded && !force) return Promise.resolve(true)
    if (inFlight) return inFlight
    const session = generation
    inFlight = (async () => {
      try {
        const headers = await authHeaders()
        if (session !== generation) return false
        const response = await fetch(CALENDARS_ENDPOINT, { headers })
        if (!response.ok) throw new Error(`GET calendars responded ${response.status}`)
        const body = await response.json()
        if (session !== generation) return false
        if (!Array.isArray(body.calendars)) throw new Error('Invalid calendars response')
        calendars.value = body.calendars ?? []
        loaded = true
        return true
      } catch (error) {
        if (session !== generation) return false
        console.error('Failed to load calendars:', error)
        notify('Failed to load calendars.', 'error')
        return false
      } finally {
        if (session === generation) inFlight = null
      }
    })()
    return inFlight
  }

  // Pulls a subscribed calendar's feed now. Updates the shared row with the
  // outcome and returns it, leaving any UI state to the caller.
  async function syncCalendar(id) {
    const session = generation
    const headers = await authHeaders({ 'Content-Type': 'application/json' })
    if (session !== generation) return { ok: false, errorMessage: 'Account changed' }
    const response = await fetch(CALENDARS_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'sync', id }),
    })
    const body = await response.json().catch(() => ({}))
    if (session !== generation) return { ok: false, errorMessage: 'Account changed' }
    const errorMessage = body.subscriptionError || body.error || null
    const index = calendars.value.findIndex((item) => item.id === id)
    if (index !== -1) {
      calendars.value[index] = {
        ...calendars.value[index],
        subscriptionSyncedAt:
          body.subscriptionSyncedAt ?? calendars.value[index].subscriptionSyncedAt,
        subscriptionError: errorMessage,
      }
    }
    return { ok: response.ok, errorMessage }
  }

  return { calendars, writableCalendars, subscribedCalendars, loadCalendars, syncCalendar }
}

function resetCalendarsState() {
  generation += 1
  calendars.value = []
  loaded = false
  inFlight = null
}

// Test-only: this module's state is a real singleton (by design — see the
// comments above), so specs that mount multiple calendar-touching
// components/views against a per-test fake backend need a way to clear the
// "already loaded" flag between tests, or a later test's mount would reuse
// an earlier test's cached list instead of hitting its own fake backend.
export function resetCalendarsStateForTests() {
  resetCalendarsState()
}
