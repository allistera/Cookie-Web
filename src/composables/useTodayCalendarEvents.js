import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useInboxStore } from '../stores/inbox'
import { dateKey, normalizeCalendarEvent } from '../utils/calendarDates'
import { calendarEventsUrl, calendarSession, isCalendarSessionCurrent } from './useCalendars'

// Today's calendar events for the inbox: the next-event chip beside the tabs
// and the "Today's Events" group at the top of the list both read them, so
// the fetch and its refresh schedule live here once rather than in each.
//
// Module-level like useCalendars' list: the first mounted consumer starts the
// polling, further consumers share it, and the last one to unmount stops it.
// Mail reading must not depend on the calendar being reachable, so a failed
// refresh simply empties the list and the hint disappears.
const REFRESH_INTERVAL_MS = 300_000
const TICK_MS = 15_000

const now = ref(new Date())
const events = ref([])
let consumers = 0
let request = 0
let timer
let lastRefresh = 0

// Today's events only (the window asked for is one day, but the account
// could change under a response), all-day ones first, then by start time.
const todayEvents = computed(() => {
  const today = dateKey(now.value)
  return events.value
    .filter((event) => event.date === today)
    .map(normalizeCalendarEvent)
    .sort(
      (left, right) =>
        Number(right.allDay) - Number(left.allDay) ||
        String(left.start).localeCompare(String(right.start)) ||
        String(left.title).localeCompare(String(right.title)),
    )
})

// A different account must never see the previous one's events, even for
// the moment before its own refresh lands.
watch(calendarSession, () => {
  events.value = []
  if (consumers) void refresh()
})

async function refresh() {
  now.value = new Date()
  const today = dateKey(now.value)
  const seq = ++request
  const session = calendarSession()
  lastRefresh = now.value.getTime()
  const store = useInboxStore()
  try {
    const headers = await store.authHeaders()
    if (!consumers || seq !== request || !isCalendarSessionCurrent(session)) return
    const response = await fetch(calendarEventsUrl(today, today), { headers })
    if (!response.ok) throw new Error('Calendar unavailable')
    const body = await response.json()
    if (!consumers || seq !== request || !isCalendarSessionCurrent(session)) return
    events.value = Array.isArray(body.events) ? body.events : []
  } catch {
    if (consumers && seq === request && isCalendarSessionCurrent(session)) events.value = []
  }
}

function tick() {
  const previousDay = dateKey(now.value)
  now.value = new Date()
  if (document.visibilityState === 'hidden') return
  if (
    previousDay !== dateKey(now.value) ||
    now.value.getTime() - lastRefresh >= REFRESH_INTERVAL_MS
  )
    void refresh()
}

function onFocus() {
  void refresh()
}

function onVisibilityChange() {
  if (document.visibilityState === 'visible') void refresh()
}

function start() {
  void refresh()
  timer = setInterval(tick, TICK_MS)
  window.addEventListener('focus', onFocus)
  document.addEventListener('visibilitychange', onVisibilityChange)
}

function stop() {
  clearInterval(timer)
  window.removeEventListener('focus', onFocus)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  request += 1
  events.value = []
}

export function useTodayCalendarEvents() {
  onMounted(() => {
    consumers += 1
    if (consumers === 1) start()
  })
  onUnmounted(() => {
    consumers -= 1
    if (consumers === 0) stop()
  })
  return { now, todayEvents }
}

// Test-only, like useCalendars' reset: the list is a real singleton, and a
// spec that leaves a consumer mounted would otherwise hand its events to the
// next test.
export function resetTodayCalendarEventsForTests() {
  request += 1
  events.value = []
}
