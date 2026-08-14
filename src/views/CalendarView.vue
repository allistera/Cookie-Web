<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useInboxStore } from '../stores/inbox'

const store = useInboxStore()

const today = new Date()
const REFERENCE_DATE = new Date(today.getFullYear(), today.getMonth(), today.getDate())
const DAY_HOUR_HEIGHT = 96
const WEEK_HOUR_HEIGHT = 72
const START_HOUR = 8
const END_HOUR = 19

const SNAP_MINUTES = 15

const viewMode = ref('day')
const selectedDate = ref(new Date(REFERENCE_DATE))
const showNewEvent = ref(false)
const eventForm = ref(null)
const editingEventId = ref(null)
const eventFormReadOnly = ref(false)
const eventTitleInput = ref(null)
const dragDraft = ref(null)
const conflictVisible = ref(true)

const calendars = ref([])
const visibleCalendars = ref(new Set())
const CALENDARS_ENDPOINT = '/api/calendar-events?resource=calendars'

// Manually-created calendars accept events; subscribed ones are entirely
// sync-managed, so they're excluded from anywhere an event gets filed.
const writableCalendars = computed(() => calendars.value.filter((calendar) => !calendar.subscriptionUrl))
const subscribedCalendars = computed(() => calendars.value.filter((calendar) => calendar.subscriptionUrl))
const calendarSections = computed(() => [
  { id: 'calendars', label: 'Calendars', calendars: writableCalendars.value },
  ...(subscribedCalendars.value.length
    ? [{ id: 'subscribed-calendars', label: 'Subscribed calendars', calendars: subscribedCalendars.value }]
    : []),
])

const calendarColorById = computed(() => new Map(calendars.value.map((calendar) => [calendar.id, calendar.color])))

// Sets the --event-color custom property an event chip reads for its tint, so
// entries visually match their owning calendar the same way the sidebar list
// does. Left unset (falls back to the neutral default) for a calendar that's
// been removed or hasn't loaded yet — status tones (conflict/accepted/
// suggested/dark) still take over via CSS class specificity regardless.
function eventColorVars(event) {
  const color = calendarColorById.value.get(event.calendar)
  return color ? { '--event-color': color } : {}
}

async function loadCalendars() {
  try {
    const headers = await store.authHeaders()
    const response = await fetch(CALENDARS_ENDPOINT, { headers })
    if (!response.ok) throw new Error(`GET calendars responded ${response.status}`)
    const { calendars: rows } = await response.json()
    calendars.value = rows
    visibleCalendars.value = new Set(rows.map((calendar) => calendar.id))
  } catch (error) {
    console.error('Failed to load calendars:', error)
    store.notify('Failed to load calendars.', 'error')
  }
}

function defaultCalendarId() {
  return (
    writableCalendars.value.find((calendar) => calendar.name === 'Personal')?.id ??
    writableCalendars.value[0]?.id
  )
}

const events = ref([])

// Events are fetched in a padded window around the visible date rather than
// the user's whole history — the API windows non-recurring rows by event_date
// and clips recurring expansion to from/to. loadedEventRange remembers what
// the last successful fetch covered; navigation refetches only once the view
// needs dates outside it, so week-to-week browsing stays free.
const EVENT_RANGE_VIEW_DAYS = 45
const EVENT_RANGE_PAD_DAYS = 60
const loadedEventRange = ref(null)
let eventsRequestSeq = 0

// The visible grid needs at most ±45 days around selectedDate (a month grid
// spans six weeks); the insights rail additionally always needs the conflict
// window and the auto-scheduled week anchored on REFERENCE_DATE.
function requiredEventRange() {
  const bounds = [
    addDays(selectedDate.value, -EVENT_RANGE_VIEW_DAYS),
    addDays(selectedDate.value, EVENT_RANGE_VIEW_DAYS),
    addDays(REFERENCE_DATE, -7),
    addDays(REFERENCE_DATE, CONFLICT_WINDOW_DAYS + 1),
  ].map((date) => date.getTime())
  return { from: new Date(Math.min(...bounds)), to: new Date(Math.max(...bounds)) }
}

async function loadEvents() {
  const required = requiredEventRange()
  const from = dateKey(addDays(required.from, -EVENT_RANGE_PAD_DAYS))
  const to = dateKey(addDays(required.to, EVENT_RANGE_PAD_DAYS))
  const seq = ++eventsRequestSeq
  try {
    const headers = await store.authHeaders()
    const response = await fetch(`/api/calendar-events?from=${from}&to=${to}`, { headers })
    if (!response.ok) throw new Error(`GET /api/calendar-events responded ${response.status}`)
    const { events: rows } = await response.json()
    // A rapid navigation may have started a newer load for a different
    // window; dropping the stale response keeps events/loadedEventRange
    // describing the same fetch.
    if (seq !== eventsRequestSeq) return
    events.value = rows.map((event) => ({
      ...event,
      // Older calendar rows can predate the all_day flag. Midnight events
      // spanning a complete day are still all-day events and must never be
      // positioned against the visible hourly timeline.
      allDay:
        event.allDay === true ||
        (String(event.start).startsWith('00:00') && Number(event.duration) >= 24 * 60),
    }))
    loadedEventRange.value = { from, to }
  } catch (error) {
    console.error('Failed to load calendar events:', error)
    store.notify('Failed to load calendar events.', 'error')
  }
}

watch(selectedDate, () => {
  if (!loadedEventRange.value) return
  const required = requiredEventRange()
  if (dateKey(required.from) < loadedEventRange.value.from || dateKey(required.to) > loadedEventRange.value.to) {
    loadEvents()
  }
})

const visibleEvents = computed(() =>
  events.value.filter((event) => visibleCalendars.value.has(event.calendar)),
)
// All-day events (e.g. holidays synced from a subscribed calendar) render in
// a compact banner rather than being positioned by start time/duration in
// the hourly grid — that's what previously made one stretch across the
// entire visible timeline.
const timedVisibleEvents = computed(() => visibleEvents.value.filter((event) => !event.allDay))
const allDayVisibleEvents = computed(() => visibleEvents.value.filter((event) => event.allDay))

const dateKey = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

const addDays = (date, days) => {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

const startOfWeek = (date) => {
  const start = new Date(date)
  const mondayOffset = (start.getDay() + 6) % 7
  start.setDate(start.getDate() - mondayOffset)
  return start
}

// The real current week (anchored on REFERENCE_DATE/"today"), independent of
// whatever day/week/month the user has navigated to — the "Auto-scheduled"
// insight card reports on this week, not the one being viewed.
const THIS_WEEK_DATE_KEYS = new Set(
  Array.from({ length: 7 }, (_, index) => dateKey(addDays(startOfWeek(REFERENCE_DATE), index))),
)
// Genuine count, not fabricated copy: true only for events flagged
// is_auto_scheduled server-side (migration 0033). No feature sets that flag
// yet, so this reads 0 until an actual auto-scheduling feature exists.
const autoScheduledCount = computed(
  () =>
    visibleEvents.value.filter((event) => event.autoScheduled && THIS_WEEK_DATE_KEYS.has(event.date))
      .length,
)

// Only surfaced within a bounded lookahead: a double-booking three months out
// is easy to fix before it matters, so it isn't worth an actionable warning
// today the way one happening this week or next is.
const CONFLICT_WINDOW_DAYS = 30

const eventInterval = (event) => {
  const start = new Date(`${event.date}T${event.start}:00`)
  return { start, end: new Date(start.getTime() + event.duration * 60_000) }
}

// The first (earliest-starting) pair of timed events whose intervals overlap
// within the next CONFLICT_WINDOW_DAYS, or null if there isn't one. All-day
// events (holidays, etc.) are excluded — they aren't "conflicts" in the
// scheduling sense. Exported shape mirrors the card's original hardcoded
// copy: "<later event>" overlaps "<earlier event>" by N min on <day>.
const detectedConflict = computed(() => {
  const windowStart = REFERENCE_DATE
  const windowEnd = addDays(REFERENCE_DATE, CONFLICT_WINDOW_DAYS)
  const candidates = visibleEvents.value
    .filter((event) => !event.allDay)
    .filter((event) => {
      const eventDate = new Date(`${event.date}T00:00:00`)
      return eventDate >= windowStart && eventDate <= windowEnd
    })
    .map((event) => ({ event, ...eventInterval(event) }))
    .sort((a, b) => a.start - b.start)

  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const earlier = candidates[i]
      const later = candidates[j]
      // Sorted by start, so once a candidate starts at/after this one's end,
      // every later candidate does too — the no-conflict common case is
      // linear instead of scanning all pairs.
      if (later.start >= earlier.end) break
      if (earlier.start < later.end) {
        const overlapMs = Math.min(earlier.end, later.end) - Math.max(earlier.start, later.start)
        return {
          earlierTitle: earlier.event.title,
          laterTitle: later.event.title,
          overlapMinutes: Math.round(overlapMs / 60_000),
          dayLabel: formatWeekdayShort(earlier.start),
        }
      }
    }
  }
  return null
})

// One formatter instance per shape, not per call — Intl.DateTimeFormat
// construction is expensive and several of these run inside render paths
// (header title, week headings, drag re-renders).
const LONG_DATE_FMT = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
})
const MONTH_FMT = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' })
const SHORT_MONTH_DAY_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
const WEEKDAY_SHORT_FMT = new Intl.DateTimeFormat('en-US', { weekday: 'short' })
const TIME_FMT = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })

const formatLongDate = (date) => LONG_DATE_FMT.format(date)
const formatMonth = (date) => MONTH_FMT.format(date)
const formatShortMonthDay = (date) => SHORT_MONTH_DAY_FMT.format(date)
const formatWeekdayShort = (date) => WEEKDAY_SHORT_FMT.format(date)

const headerTitle = computed(() => {
  if (viewMode.value === 'day') return formatLongDate(selectedDate.value)
  if (viewMode.value === 'month') return formatMonth(selectedDate.value)
  const start = startOfWeek(selectedDate.value)
  const end = addDays(start, 6)
  const endLabel = start.getMonth() === end.getMonth() ? end.getDate() : formatShortMonthDay(end)
  return `${formatShortMonthDay(start)} – ${endLabel}, ${end.getFullYear()}`
})

const weekDays = computed(() => {
  const start = startOfWeek(selectedDate.value)
  return Array.from({ length: 7 }, (_, index) => addDays(start, index))
})

const monthDays = computed(() => {
  const first = new Date(selectedDate.value.getFullYear(), selectedDate.value.getMonth(), 1)
  const last = new Date(selectedDate.value.getFullYear(), selectedDate.value.getMonth() + 1, 0)
  const gridStart = startOfWeek(first)
  const gridEnd = addDays(startOfWeek(last), 6)
  const days = []
  for (let date = gridStart; date <= gridEnd; date = addDays(date, 1)) days.push(date)
  return days
})

const hours = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, index) => START_HOUR + index)
const weekBodyHeight = (END_HOUR - START_HOUR) * WEEK_HOUR_HEIGHT
const dayBodyHeight = (END_HOUR - START_HOUR) * DAY_HOUR_HEIGHT

const eventsForDay = computed(() =>
  timedVisibleEvents.value.filter((event) => event.date === dateKey(selectedDate.value)),
)
const allDayEventsForDay = computed(() =>
  allDayVisibleEvents.value.filter((event) => event.date === dateKey(selectedDate.value)),
)
const allDayEventsForWeek = computed(() =>
  weekDays.value.map((date) => allDayVisibleEvents.value.filter((event) => event.date === dateKey(date))),
)

const timeLabel = (hour) => {
  if (hour === 12) return '12 PM'
  if (hour > 12) return `${hour - 12} PM`
  return `${hour} AM`
}

const parseStart = (start) => {
  const [hour, minute] = start.split(':').map(Number)
  return { hour, minute }
}

const eventPosition = (event, hourHeight) => {
  const { hour, minute } = parseStart(event.start)
  const startMinutes = hour * 60 + minute
  const endMinutes = startMinutes + Number(event.duration)
  const visibleStart = START_HOUR * 60
  const visibleEnd = END_HOUR * 60
  const clippedStart = Math.max(startMinutes, visibleStart)
  const clippedEnd = Math.min(endMinutes, visibleEnd)

  if (clippedEnd <= clippedStart) return { display: 'none' }

  return {
    top: `${((clippedStart - visibleStart) / 60) * hourHeight}px`,
    height: `${Math.max(((clippedEnd - clippedStart) / 60) * hourHeight, 38)}px`,
    ...eventColorVars(event),
  }
}

const weekEventStyle = (event) => {
  const dayIndex = weekDays.value.findIndex((date) => dateKey(date) === event.date)
  return {
    ...eventPosition(event, WEEK_HOUR_HEIGHT),
    left: `calc(${dayIndex} * (100% / 7) + 8px)`,
    width: 'calc(100% / 7 - 16px)',
  }
}

const snapMinutes = (minutes) => Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES
const clampMinutes = (minutes) =>
  Math.min(Math.max(minutes, START_HOUR * 60), END_HOUR * 60)

const minutesFromOffset = (offsetY, hourHeight) =>
  clampMinutes(snapMinutes(START_HOUR * 60 + (offsetY / hourHeight) * 60))

const minutesToTimeString = (minutes) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

const timeStringToMinutes = (value) => {
  const [hour, minute] = value.split(':').map(Number)
  return hour * 60 + minute
}

const dragRangeStyle = ({ hourHeight, anchorMinutes, currentMinutes }) => {
  const start = Math.min(anchorMinutes, currentMinutes)
  const end = Math.max(anchorMinutes, currentMinutes)
  return {
    top: `${(start - START_HOUR * 60) * (hourHeight / 60)}px`,
    height: `${Math.max((end - start) * (hourHeight / 60), 6)}px`,
  }
}

const dayDragPreviewStyle = computed(() => {
  if (!dragDraft.value || dragDraft.value.view !== 'day') return null
  return dragRangeStyle(dragDraft.value)
})

const weekDragPreviewStyle = computed(() => {
  if (!dragDraft.value || dragDraft.value.view !== 'week') return null
  const dayIndex = weekDays.value.findIndex((date) => dateKey(date) === dateKey(dragDraft.value.date))
  return {
    ...dragRangeStyle(dragDraft.value),
    left: `calc(${dayIndex} * (100% / 7) + 8px)`,
    width: 'calc(100% / 7 - 16px)',
  }
})

const eventTime = (event) => {
  const { hour, minute } = parseStart(event.start)
  const suffix = hour >= 12 ? 'PM' : 'AM'
  const displayHour = hour % 12 || 12
  return `${displayHour}:${String(minute).padStart(2, '0')} ${suffix}`
}

const isToday = (date) => dateKey(date) === dateKey(REFERENCE_DATE)
const isCurrentMonth = (date) => date.getMonth() === selectedDate.value.getMonth()
// One O(N) bucketing pass instead of a full-array filter per month cell —
// the 42-cell month grid made that O(42×N) on every render.
const visibleEventsByDate = computed(() => {
  const byDate = new Map()
  for (const event of visibleEvents.value) {
    const bucket = byDate.get(event.date)
    if (bucket) bucket.push(event)
    else byDate.set(event.date, [event])
  }
  return byDate
})
const EMPTY_EVENTS = []
const eventsForDate = (date) => visibleEventsByDate.value.get(dateKey(date)) ?? EMPTY_EVENTS

// The week grid previously filtered every timed event against all seven day
// keys inline in the template — O(events × 7) per render, and drag-to-create
// re-renders on every snapped mousemove.
const weekDateKeys = computed(() => new Set(weekDays.value.map(dateKey)))
const weekTimedEvents = computed(() =>
  timedVisibleEvents.value.filter((event) => weekDateKeys.value.has(event.date)),
)

const now = ref(new Date())
let nowTimer = null

const nowMinutes = computed(() => now.value.getHours() * 60 + now.value.getMinutes())
// Hide the line entirely when the wall clock falls outside the rendered
// 8 AM–7 PM grid, rather than clamping it to the edges.
const nowVisible = computed(
  () => nowMinutes.value >= START_HOUR * 60 && nowMinutes.value <= END_HOUR * 60,
)
const nowLabel = computed(() => TIME_FMT.format(now.value))
const dayCurrentTimeStyle = computed(() => ({
  top: `${(nowMinutes.value - START_HOUR * 60) * (DAY_HOUR_HEIGHT / 60)}px`,
}))
const todayWeekIndex = computed(() => weekDays.value.findIndex((date) => isToday(date)))
const weekCurrentTimeStyle = computed(() => ({
  top: `${(nowMinutes.value - START_HOUR * 60) * (WEEK_HOUR_HEIGHT / 60)}px`,
  left: `calc(${todayWeekIndex.value} * (100% / 7))`,
  width: 'calc(100% / 7)',
}))

function toggleCalendar(calendarId) {
  const next = new Set(visibleCalendars.value)
  if (next.has(calendarId)) next.delete(calendarId)
  else next.add(calendarId)
  visibleCalendars.value = next
}

function setView(mode) {
  viewMode.value = mode
}

function navigate(direction) {
  const next = new Date(selectedDate.value)
  if (viewMode.value === 'month') next.setMonth(next.getMonth() + direction)
  else next.setDate(next.getDate() + direction * (viewMode.value === 'week' ? 7 : 1))
  selectedDate.value = next
}

function goToday() {
  selectedDate.value = new Date(REFERENCE_DATE)
}

const REPEAT_FREQUENCIES = ['none', 'daily', 'weekly', 'monthly', 'yearly']
const WEEKDAY_OPTIONS = [
  { code: 'MO', label: 'M' },
  { code: 'TU', label: 'T' },
  { code: 'WE', label: 'W' },
  { code: 'TH', label: 'T' },
  { code: 'FR', label: 'F' },
  { code: 'SA', label: 'S' },
  { code: 'SU', label: 'S' },
]

function parseRepeatFrequency(recurrenceRule) {
  if (!recurrenceRule) return 'none'
  const freq = recurrenceRule.split(';')[0].toLowerCase()
  return REPEAT_FREQUENCIES.includes(freq) ? freq : 'none'
}

function parseRepeatUntil(recurrenceRule) {
  const match = recurrenceRule?.match(/UNTIL=(\d{4}-\d{2}-\d{2})/)
  return match ? match[1] : ''
}

function parseRepeatDays(recurrenceRule) {
  const match = recurrenceRule?.match(/BYDAY=([A-Z,]+)/)
  return match ? match[1].split(',') : []
}

function openNewEvent(prefill) {
  editingEventId.value = null
  eventFormReadOnly.value = false
  const prefillDate = prefill?.date
  eventForm.value = {
    title: prefill?.title || '',
    description: prefill?.description || '',
    location: prefill?.location || '',
    date: prefillDate instanceof Date ? dateKey(prefillDate) : prefillDate || dateKey(selectedDate.value),
    start: prefill?.start ?? (prefill ? minutesToTimeString(prefill.startMinutes) : '14:00'),
    end: prefill?.end ?? (prefill ? minutesToTimeString(prefill.endMinutes) : '14:30'),
    calendar: defaultCalendarId(),
    repeat: 'none',
    repeatUntil: '',
    repeatDays: [],
  }
  showNewEvent.value = true
}

function toggleRepeatDay(code) {
  const days = eventForm.value.repeatDays
  eventForm.value.repeatDays = days.includes(code) ? days.filter((day) => day !== code) : [...days, code]
}

function editEvent(event) {
  editingEventId.value = event.seriesId ?? event.id
  // Subscribed-calendar events are entirely sync-managed — the dialog opens
  // read-only rather than letting the user hit a 403 on save/delete.
  eventFormReadOnly.value = !writableCalendars.value.some((calendar) => calendar.id === event.calendar)
  eventForm.value = {
    title: event.title,
    description: event.description || '',
    location: event.location || '',
    date: event.date,
    start: event.start,
    // An all-day event's 1440-minute duration would overflow into an
    // invalid "24:00" end time; there's no meaningful end-of-day time to
    // show anyway since it's rendered as an all-day banner, not a slot.
    end: event.allDay ? '23:59' : minutesToTimeString(timeStringToMinutes(event.start) + event.duration),
    calendar: event.calendar,
    repeat: parseRepeatFrequency(event.recurrenceRule),
    repeatUntil: parseRepeatUntil(event.recurrenceRule),
    repeatDays: parseRepeatDays(event.recurrenceRule),
  }
  showNewEvent.value = true
}

function closeNewEvent() {
  showNewEvent.value = false
  eventForm.value = null
  editingEventId.value = null
}

async function saveEvent() {
  const title = eventForm.value.title.trim()
  if (!title) return
  const { date, start, end, location, description, repeat, repeatUntil, repeatDays } = eventForm.value
  const duration = Math.max(timeStringToMinutes(end) - timeStringToMinutes(start), SNAP_MINUTES)
  const trimmedLocation = location.trim() || null
  const trimmedDescription = description.trim() || null
  const calendar = eventForm.value.calendar || defaultCalendarId()
  if (!calendar) {
    store.notify('Create a calendar before adding events.', 'error')
    return
  }

  const fields = {
    title,
    date,
    start,
    duration,
    location: trimmedLocation,
    description: trimmedDescription,
    calendar,
    repeat,
    repeatUntil: repeat === 'none' ? null : repeatUntil || null,
    repeatDays: repeat === 'weekly' && repeatDays.length ? repeatDays : null,
  }

  try {
    const headers = await store.authHeaders({ 'Content-Type': 'application/json' })
    if (editingEventId.value) {
      const existing = events.value.find((event) => (event.seriesId ?? event.id) === editingEventId.value)
      const response = await fetch('/api/calendar-events', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ id: editingEventId.value, ...fields, tone: existing?.tone ?? null }),
      })
      if (!response.ok) throw new Error(`PATCH /api/calendar-events responded ${response.status}`)
    } else {
      const response = await fetch('/api/calendar-events', {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...fields, tone: 'accepted' }),
      })
      if (!response.ok) throw new Error(`POST /api/calendar-events responded ${response.status}`)
    }
    // Recurring series are expanded into occurrences server-side, so a full
    // reload is the simplest way to keep every occurrence in sync.
    await loadEvents()
    closeNewEvent()
  } catch (error) {
    console.error('Failed to save calendar event:', error)
    store.notify('Failed to save event.', 'error')
  }
}

async function deleteEvent() {
  if (!editingEventId.value) return
  const id = editingEventId.value
  try {
    const headers = await store.authHeaders({ 'Content-Type': 'application/json' })
    const response = await fetch('/api/calendar-events', {
      method: 'DELETE',
      headers,
      body: JSON.stringify({ id }),
    })
    if (!response.ok) throw new Error(`DELETE /api/calendar-events responded ${response.status}`)
    await loadEvents()
    closeNewEvent()
  } catch (error) {
    console.error('Failed to delete calendar event:', error)
    store.notify('Failed to delete event.', 'error')
  }
}

watch(showNewEvent, (open) => {
  if (open) nextTick(() => eventTitleInput.value?.focus())
})

// The command palette's "Create Event" command (opened with '/') bumps this
// counter instead of calling into the view directly.
watch(
  () => store.calendarNewEventRequestId,
  () => {
    const draft = store.calendarNewEventDraft
    store.calendarNewEventDraft = null
    openNewEvent(draft)
  },
)

function beginDrag(event, date, hourHeight, view) {
  if (event.button !== 0) return
  event.preventDefault()
  const rect = event.currentTarget.getBoundingClientRect()
  const minutes = minutesFromOffset(event.clientY - rect.top, hourHeight)
  dragDraft.value = {
    date: new Date(date),
    hourHeight,
    rectTop: rect.top,
    anchorMinutes: minutes,
    currentMinutes: minutes,
    view,
  }
  window.addEventListener('mousemove', onDragMove)
  window.addEventListener('mouseup', onDragEnd)
}

function onDragMove(event) {
  if (!dragDraft.value) return
  const { hourHeight, rectTop, currentMinutes } = dragDraft.value
  const minutes = minutesFromOffset(event.clientY - rectTop, hourHeight)
  // Minutes snap to 15-minute steps, so most mousemoves resolve to the same
  // value — skip them instead of re-rendering the whole grid per pixel.
  if (minutes === currentMinutes) return
  dragDraft.value = { ...dragDraft.value, currentMinutes: minutes }
}

function onDragEnd() {
  window.removeEventListener('mousemove', onDragMove)
  window.removeEventListener('mouseup', onDragEnd)
  if (!dragDraft.value) return
  const { date, anchorMinutes, currentMinutes } = dragDraft.value
  const startMinutes = Math.min(anchorMinutes, currentMinutes)
  const endMinutes =
    currentMinutes === anchorMinutes
      ? clampMinutes(startMinutes + 30)
      : Math.max(anchorMinutes, currentMinutes)
  dragDraft.value = null
  openNewEvent({ date, startMinutes, endMinutes })
}

function onKeydown(event) {
  if (event.key === 'Escape' && showNewEvent.value) closeNewEvent()
}

onMounted(async () => {
  document.addEventListener('keydown', onKeydown)
  nowTimer = setInterval(() => {
    now.value = new Date()
  }, 60_000)
  await Promise.all([loadCalendars(), loadEvents()])
  if (store.calendarNewEventDraft) {
    const draft = store.calendarNewEventDraft
    store.calendarNewEventDraft = null
    openNewEvent(draft)
  }
})
onUnmounted(() => {
  clearInterval(nowTimer)
  document.removeEventListener('keydown', onKeydown)
  window.removeEventListener('mousemove', onDragMove)
  window.removeEventListener('mouseup', onDragEnd)
})
</script>

<template>
  <section class="calendar-view" aria-label="Calendar">
    <aside class="left-sidebar calendar-sidebar" aria-label="Calendar sidebar">
      <button type="button" class="compose-btn calendar-sidebar-create" @click="openNewEvent()">
        <span class="material-symbols-outlined" aria-hidden="true">add</span>
        <span>New event</span>
      </button>

      <div v-for="section in calendarSections" :key="section.id" class="calendar-sidebar-section">
        <div class="sb-section-label calendar-sidebar-label">
          <span>{{ section.label }}</span>
        </div>

        <nav class="sidebar-nav calendar-list" :aria-label="section.label">
          <div v-for="calendar in section.calendars" :key="calendar.id" class="calendar-list-row">
            <button
              type="button"
              class="nav-item calendar-list-item"
              :class="{ muted: !visibleCalendars.has(calendar.id) }"
              :aria-pressed="visibleCalendars.has(calendar.id)"
              @click="toggleCalendar(calendar.id)"
            >
              <span
                class="calendar-color"
                :style="{ '--calendar-list-color': calendar.color }"
                aria-hidden="true"
              >
                <svg v-if="visibleCalendars.has(calendar.id)" viewBox="0 0 16 16">
                  <path d="m3.5 8 2.7 2.7 6.3-6.2" />
                </svg>
              </span>
              <span class="nav-text">{{ calendar.name }}</span>
            </button>
          </div>
        </nav>
      </div>

      <router-link
        class="nav-item calendar-manage-link"
        :to="{ name: 'settings', params: { section: 'calendar' } }"
      >
        <span class="material-symbols-outlined" aria-hidden="true">settings</span>
        <span class="nav-text">Manage calendars</span>
      </router-link>
    </aside>

    <div class="calendar-content">
      <div class="calendar-page">
      <header class="calendar-page-header" :class="{ 'is-month': viewMode === 'month' }">
        <span class="calendar-eyebrow">Calendar</span>

        <div class="calendar-toolbar">
          <div class="calendar-date-controls">
            <h1>{{ headerTitle }}</h1>
            <div class="calendar-navigation" aria-label="Calendar navigation">
              <button type="button" aria-label="Previous period" @click="navigate(-1)">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m14.5 5-7 7 7 7" />
                </svg>
              </button>
              <button type="button" aria-label="Next period" @click="navigate(1)">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m9.5 5 7 7-7 7" />
                </svg>
              </button>
              <button type="button" class="today-button" @click="goToday">Today</button>
            </div>
          </div>

          <div class="calendar-header-actions">
            <div class="calendar-view-tabs" aria-label="Calendar view">
              <button
                v-for="mode in ['day', 'week', 'month']"
                :key="mode"
                type="button"
                :class="{ active: viewMode === mode }"
                :aria-pressed="viewMode === mode"
                @click="setView(mode)"
              >
                {{ mode.charAt(0).toUpperCase() + mode.slice(1) }}
              </button>
            </div>

            <button
              v-if="viewMode === 'month'"
              type="button"
              class="new-event-button month-new-event-button"
              @click="openNewEvent()"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
              New event
            </button>
          </div>
        </div>
      </header>

      <section v-if="viewMode !== 'week'" class="calendar-insights" aria-label="Calendar insights">
        <article v-if="conflictVisible && detectedConflict" class="calendar-insight-card">
          <span class="insight-icon conflict-icon material-symbols-outlined" aria-hidden="true">
            warning_amber
          </span>
          <div class="insight-copy">
            <h2>Scheduling conflict</h2>
            <p>
              "{{ detectedConflict.laterTitle }}" overlaps "{{ detectedConflict.earlierTitle }}" by
              {{ detectedConflict.overlapMinutes }} min on {{ detectedConflict.dayLabel }}.
            </p>
            <button type="button" class="primary-small-button" @click="conflictVisible = false">
              Resolve
            </button>
          </div>
        </article>

        <article v-if="autoScheduledCount > 0" class="calendar-insight-card auto-scheduled-card">
          <span class="insight-icon auto-icon material-symbols-outlined" aria-hidden="true">bolt</span>
          <div class="insight-copy">
            <h2>Auto-scheduled</h2>
            <p>
              Cookie booked {{ autoScheduledCount }}
              {{ autoScheduledCount === 1 ? 'event' : 'events' }} this week around your availability.
            </p>
          </div>
        </article>
      </section>

      <section v-if="viewMode === 'day'" class="day-calendar calendar-surface" aria-label="Day view">
        <h2>{{ formatLongDate(selectedDate) }}</h2>
        <div v-if="allDayEventsForDay.length" class="all-day-row" role="group" aria-label="All-day events">
          <button
            v-for="event in allDayEventsForDay"
            :key="event.id"
            type="button"
            class="calendar-event all-day-event"
            :class="`tone-${event.tone || 'default'}`"
            :style="eventColorVars(event)"
            @click="editEvent(event)"
          >
            {{ event.title }}
          </button>
        </div>
        <div class="day-timeline" :style="{ height: `${dayBodyHeight}px` }">
          <div
            v-for="(hour, index) in hours"
            :key="hour"
            class="day-hour-line"
            :style="{ top: `${index * DAY_HOUR_HEIGHT}px` }"
          >
            <span>{{ timeLabel(hour) }}</span>
          </div>
          <div
            class="day-event-lane"
            @mousedown.self="(event) => beginDrag(event, selectedDate, DAY_HOUR_HEIGHT, 'day')"
          >
            <button
              v-for="event in eventsForDay"
              :key="event.id"
              type="button"
              class="calendar-event day-event"
              :class="`tone-${event.tone || 'default'}`"
              :style="eventPosition(event, DAY_HOUR_HEIGHT)"
              @click="editEvent(event)"
            >
              <strong>{{ event.title }}</strong>
            </button>
            <div
              v-if="dayDragPreviewStyle"
              class="calendar-event day-event drag-preview"
              :style="dayDragPreviewStyle"
            ></div>
            <div
              v-if="isToday(selectedDate) && nowVisible"
              class="current-time-line day-current-time"
              :style="dayCurrentTimeStyle"
              :aria-label="`Current time ${nowLabel}`"
            >
              <span></span>
            </div>
          </div>
        </div>
      </section>

      <section v-else-if="viewMode === 'week'" class="week-calendar calendar-surface" aria-label="Week view">
        <div class="week-day-header">
          <div class="week-time-spacer"></div>
          <div v-for="date in weekDays" :key="dateKey(date)" class="week-day-heading">
            <span>{{ formatWeekdayShort(date) }}</span>
            <strong :class="{ today: isToday(date) }">{{ date.getDate() }}</strong>
          </div>
        </div>
        <div
          v-if="allDayEventsForWeek.some((dayEvents) => dayEvents.length)"
          class="all-day-row week-all-day-row"
          role="group"
          aria-label="All-day events"
        >
          <div class="week-time-spacer"></div>
          <div v-for="(dayEvents, index) in allDayEventsForWeek" :key="dateKey(weekDays[index])" class="week-all-day-cell">
            <button
              v-for="event in dayEvents"
              :key="event.id"
              type="button"
              class="calendar-event all-day-event"
              :class="`tone-${event.tone || 'default'}`"
              :style="eventColorVars(event)"
              @click="editEvent(event)"
            >
              {{ event.title }}
            </button>
          </div>
        </div>
        <div class="week-timeline" :style="{ height: `${weekBodyHeight}px` }">
          <div class="week-time-axis">
            <div
              v-for="(hour, index) in hours"
              :key="hour"
              class="week-hour-label"
              :style="{ top: `${index * WEEK_HOUR_HEIGHT}px` }"
            >
              {{ timeLabel(hour) }}
            </div>
          </div>
          <div class="week-grid">
            <div
              v-for="date in weekDays"
              :key="dateKey(date)"
              class="week-day-column"
              @mousedown="(event) => beginDrag(event, date, WEEK_HOUR_HEIGHT, 'week')"
            ></div>
            <div
              v-for="(_, index) in hours"
              :key="index"
              class="week-hour-line"
              :style="{ top: `${index * WEEK_HOUR_HEIGHT}px` }"
            ></div>
            <button
              v-for="event in weekTimedEvents"
              :key="event.id"
              type="button"
              class="calendar-event week-event"
              :class="`tone-${event.tone || 'default'}`"
              :style="weekEventStyle(event)"
              @click="editEvent(event)"
            >
              <strong>{{ event.title }}</strong>
              <span v-if="event.duration >= 60">{{ eventTime(event) }} · {{ event.duration }} min</span>
            </button>
            <div
              v-if="weekDragPreviewStyle"
              class="calendar-event week-event drag-preview"
              :style="weekDragPreviewStyle"
            ></div>
            <div
              v-if="todayWeekIndex !== -1 && nowVisible"
              class="current-time-line week-current-time"
              :style="weekCurrentTimeStyle"
              :aria-label="`Current time ${nowLabel}`"
            >
              <span></span>
            </div>
          </div>
        </div>
      </section>

      <section v-else class="month-calendar calendar-surface" aria-label="Month view">
        <div class="month-weekdays" aria-hidden="true">
          <span v-for="day in ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']" :key="day">
            {{ day }}
          </span>
        </div>
        <div class="month-grid">
          <article
            v-for="date in monthDays"
            :key="dateKey(date)"
            class="month-day"
            :class="{ muted: !isCurrentMonth(date) }"
          >
            <span class="month-date" :class="{ today: isToday(date) }">{{ date.getDate() }}</span>
            <div class="month-events">
              <button
                v-for="event in eventsForDate(date)"
                :key="event.id"
                type="button"
                class="month-event"
                :class="`tone-${event.tone || 'default'}`"
                :style="eventColorVars(event)"
                @click="editEvent(event)"
              >
                {{ event.title }}
              </button>
            </div>
          </article>
        </div>
      </section>
      </div>
    </div>

    <Transition name="calendar-modal">
      <div v-if="showNewEvent" class="new-event-overlay" @mousedown.self="closeNewEvent">
        <section
          class="new-event-dialog"
          role="dialog"
          aria-modal="true"
          :aria-label="editingEventId ? 'Edit event' : 'New event'"
        >
          <header class="new-event-dialog-header">
            <div class="new-event-dialog-fields">
              <input
                ref="eventTitleInput"
                v-model="eventForm.title"
                type="text"
                class="new-event-title-input"
                placeholder="New event"
                aria-label="Event title"
                :disabled="eventFormReadOnly"
                @keydown.enter.prevent="saveEvent"
              />
              <input
                v-model="eventForm.description"
                type="text"
                class="new-event-description-input"
                placeholder="Tell Cookie what you need — it fills in the rest"
                aria-label="Event description"
                :disabled="eventFormReadOnly"
              />
            </div>
            <button type="button" class="new-event-close" aria-label="Close" @click="closeNewEvent">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18" />
              </svg>
            </button>
          </header>

          <p v-if="eventFormReadOnly" class="new-event-readonly-note">
            Synced from an external calendar — read-only.
          </p>

          <div class="new-event-datetime">
            <label class="new-event-field new-event-datetime-field">
              <span>Date</span>
              <input v-model="eventForm.date" type="date" :disabled="eventFormReadOnly" />
            </label>
            <label class="new-event-field new-event-datetime-field">
              <span>Start</span>
              <input v-model="eventForm.start" type="time" :disabled="eventFormReadOnly" />
            </label>
            <label class="new-event-field new-event-datetime-field">
              <span>End</span>
              <input v-model="eventForm.end" type="time" :disabled="eventFormReadOnly" />
            </label>
          </div>

          <div class="new-event-location-wrap">
            <label class="new-event-field">
              <span>Location</span>
              <input
                v-model="eventForm.location"
                type="text"
                placeholder="Add location"
                :disabled="eventFormReadOnly"
              />
            </label>
            <label class="new-event-field">
              <span>Calendar</span>
              <select v-model="eventForm.calendar" aria-label="Event calendar" :disabled="eventFormReadOnly">
                <option
                  v-for="calendar in eventFormReadOnly ? calendars : writableCalendars"
                  :key="calendar.id"
                  :value="calendar.id"
                >
                  {{ calendar.name }}
                </option>
              </select>
            </label>
          </div>

          <div v-if="!eventFormReadOnly" class="new-event-location-wrap">
            <label class="new-event-field">
              <span>Repeats</span>
              <select v-model="eventForm.repeat" aria-label="Event repeats">
                <option value="none">Does not repeat</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </label>
            <label v-if="eventForm.repeat !== 'none'" class="new-event-field">
              <span>Ends</span>
              <input
                v-model="eventForm.repeatUntil"
                type="date"
                aria-label="Repeat ends"
                :min="eventForm.date"
              />
            </label>
          </div>

          <div v-if="eventForm.repeat === 'weekly'" class="new-event-repeat-days" role="group" aria-label="Repeat on days">
            <button
              v-for="day in WEEKDAY_OPTIONS"
              :key="day.code"
              type="button"
              class="new-event-repeat-day"
              :class="{ 'is-selected': eventForm.repeatDays.includes(day.code) }"
              :aria-pressed="eventForm.repeatDays.includes(day.code)"
              @click="toggleRepeatDay(day.code)"
            >
              {{ day.label }}
            </button>
          </div>

          <footer v-if="eventFormReadOnly" class="new-event-dialog-actions">
            <div class="new-event-dialog-actions-right">
              <button type="button" class="new-event-cancel" @click="closeNewEvent">Close</button>
            </div>
          </footer>
          <footer v-else class="new-event-dialog-actions">
            <button
              v-if="editingEventId"
              type="button"
              class="new-event-delete"
              @click="deleteEvent"
            >
              {{ eventForm.repeat !== 'none' ? 'Delete series' : 'Delete' }}
            </button>
            <div class="new-event-dialog-actions-right">
              <button type="button" class="new-event-cancel" @click="closeNewEvent">Cancel</button>
              <button
                type="button"
                class="new-event-create"
                :disabled="!eventForm.title.trim()"
                @click="saveEvent"
              >
                {{ editingEventId ? 'Save Event' : 'Create Event' }}
              </button>
            </div>
          </footer>
        </section>
      </div>
    </Transition>
  </section>
</template>

<style scoped>
.calendar-view {
  --calendar-canvas: var(--bg-card);
  --calendar-surface: var(--bg-dialog);
  --calendar-ink: var(--text-primary);
  --calendar-muted: var(--text-secondary);
  --calendar-label: var(--text-secondary);
  --calendar-muted-date: color-mix(in srgb, var(--text-secondary) 60%, transparent);
  --calendar-line: var(--border-color);
  --calendar-soft: var(--bg-hover);
  --calendar-mint: var(--bg-input);
  --calendar-mint-strong: var(--text-blue);
  --calendar-coral: #e5484d;
  --calendar-coral-soft: rgba(229, 72, 77, 0.1);
  --calendar-event-line: var(--border-color);
  --calendar-event-surface: var(--bg-input);
  --calendar-event-ink: var(--text-primary);
  --calendar-conflict-line: #e5484d;
  --calendar-conflict-surface: rgba(229, 72, 77, 0.1);
  --calendar-accepted-line: #4cb782;
  --calendar-accepted-surface: rgba(76, 183, 130, 0.12);
  --calendar-accepted-ink: #1d7f56;
  --calendar-suggested: var(--text-purple);
  --calendar-input: var(--bg-input);
  --calendar-overlay: rgba(0, 0, 0, 0.35);
  --calendar-emphasis: var(--text-blue);
  --calendar-on-emphasis: #ffffff;
  --calendar-time-line: #e5484d;
  --calendar-disabled: var(--border-color);
  --calendar-disabled-ink: var(--text-secondary);
  --calendar-card-shadow: var(--shadow-sm);
  --calendar-dialog-shadow: var(--shadow-lg);
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
  background: var(--calendar-canvas);
  color: var(--calendar-ink);
}

[data-theme='dark'] .calendar-view {
  --calendar-coral: #eb6e6e;
  --calendar-coral-soft: rgba(235, 110, 110, 0.16);
  --calendar-conflict-line: #eb6e6e;
  --calendar-conflict-surface: rgba(235, 110, 110, 0.16);
  --calendar-accepted-line: #62d29c;
  --calendar-accepted-surface: rgba(98, 210, 156, 0.16);
  --calendar-accepted-ink: #62d29c;
  --calendar-time-line: #eb6e6e;
  --calendar-overlay: rgba(0, 0, 0, 0.68);
  color-scheme: dark;
}

.calendar-sidebar.left-sidebar {
  width: 230px;
  padding: 12px;
  gap: 10px;
  overflow-y: auto;
  background: var(--calendar-canvas);
  border-color: var(--calendar-line);
  color: var(--calendar-ink);
}

.calendar-sidebar-section {
  min-width: 0;
}

.calendar-sidebar-label {
  display: flex;
  align-items: center;
  padding-top: 12px;
  color: var(--calendar-muted);
}

.calendar-list-item.nav-item {
  width: 100%;
  border: 0;
  background: transparent;
  color: var(--calendar-ink);
  cursor: pointer;
  font-family: var(--font-stack);
  text-align: left;
}

.calendar-list-item.nav-item:hover,
.calendar-list-item.nav-item:focus-visible {
  background: var(--calendar-soft);
  outline: none;
}

.calendar-list-item.muted {
  color: var(--calendar-muted);
}

.calendar-color {
  width: 15px;
  height: 15px;
  border: 2px solid var(--calendar-list-color);
  border-radius: 5px;
  background: var(--calendar-list-color);
  color: #fff;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
}

.calendar-list-item.muted .calendar-color {
  background: transparent;
}

.calendar-color svg {
  width: 11px;
  height: 11px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2;
}

.calendar-list-row {
  min-width: 0;
}

.calendar-manage-link {
  margin-top: auto;
  color: var(--calendar-muted);
  text-decoration: none;
}

.calendar-manage-link:hover,
.calendar-manage-link:focus-visible {
  background: var(--calendar-soft);
  color: var(--calendar-ink);
  outline: none;
}

.calendar-manage-link .material-symbols-outlined {
  font-size: 19px;
}

.calendar-content {
  flex: 1;
  min-width: 0;
  overflow: auto;
  background: var(--calendar-canvas);
}

.calendar-page {
  width: 100%;
  min-width: 0;
  padding: 24px 32px 48px;
}

.calendar-page-header {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 18px;
}

.calendar-eyebrow {
  color: var(--calendar-label);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.16em;
  line-height: 1;
  text-transform: uppercase;
}

.calendar-toolbar {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}

.calendar-date-controls,
.calendar-navigation,
.calendar-header-actions,
.calendar-view-tabs,
.new-event-button,
.new-event-dialog-header,
.new-event-dialog-actions {
  display: flex;
  align-items: center;
}

.calendar-date-controls {
  min-width: 0;
  gap: 16px;
}

.calendar-date-controls h1 {
  margin: 0;
  color: var(--calendar-ink);
  font-size: clamp(24px, 2.4vw, 32px);
  font-weight: 600;
  letter-spacing: -0.045em;
  line-height: 1.05;
  white-space: nowrap;
}

.calendar-navigation {
  gap: 8px;
  flex: 0 0 auto;
}

.calendar-navigation button {
  width: 38px;
  height: 38px;
  border: 1px solid var(--calendar-line);
  border-radius: 50%;
  background: transparent;
  color: var(--calendar-muted);
  cursor: pointer;
  display: grid;
  place-items: center;
  transition:
    background-color var(--transition-fast),
    color var(--transition-fast),
    transform var(--transition-fast);
}

.calendar-navigation button:hover,
.calendar-navigation button:focus-visible {
  background: var(--calendar-soft);
  color: var(--calendar-ink);
  outline: none;
}

.calendar-navigation button:active {
  transform: scale(0.96);
}

.calendar-navigation svg,
.new-event-button svg,
.new-event-close svg {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2;
}

.calendar-navigation .today-button {
  width: auto;
  min-width: 78px;
  padding: 0 16px;
  border-radius: 999px;
  font-family: var(--font-stack);
  font-size: 14px;
  font-weight: 400;
}

.calendar-header-actions {
  gap: 14px;
  flex: 0 0 auto;
}

.calendar-view-tabs {
  width: 252px;
  height: 42px;
  padding: 3px;
  border-radius: 999px;
  background: var(--calendar-soft);
}

.calendar-view-tabs button {
  flex: 1;
  align-self: stretch;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--calendar-muted);
  cursor: pointer;
  font-family: var(--font-stack);
  font-size: 14px;
  font-weight: 600;
  text-transform: capitalize;
  transition:
    background-color var(--transition-fast),
    box-shadow var(--transition-fast),
    color var(--transition-fast);
}

.calendar-view-tabs button:hover,
.calendar-view-tabs button:focus-visible {
  color: var(--calendar-ink);
  outline: none;
}

.calendar-view-tabs button.active {
  background: var(--calendar-surface);
  box-shadow: var(--calendar-card-shadow);
  color: var(--calendar-ink);
}

.new-event-button {
  justify-content: center;
  gap: 8px;
  min-width: 142px;
  height: 42px;
  padding: 0 18px;
  border: 1px solid var(--calendar-emphasis);
  border-radius: 12px;
  background: var(--calendar-emphasis);
  color: var(--calendar-on-emphasis);
  cursor: pointer;
  font-family: var(--font-stack);
  font-size: 14px;
  font-weight: 500;
  transition:
    filter var(--transition-fast),
    transform var(--transition-fast);
}

.new-event-button:hover,
.new-event-button:focus-visible {
  filter: brightness(1.15);
  outline: none;
}

.new-event-button:active {
  transform: scale(0.98);
}

.calendar-insights {
  margin-top: 28px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.calendar-page-header:not(.is-month) + .calendar-insights {
  margin-top: 32px;
}

.calendar-insight-card {
  min-height: 168px;
  padding: 24px;
  border: 1px solid var(--calendar-line);
  border-radius: 16px;
  background: var(--calendar-surface);
  box-shadow: var(--calendar-card-shadow);
  display: flex;
  align-items: flex-start;
  gap: 16px;
}

.insight-icon {
  width: 44px;
  height: 44px;
  border-radius: 13px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  font-size: 22px;
}

.conflict-icon {
  background: var(--calendar-coral-soft);
  color: var(--calendar-coral);
}

.auto-icon {
  background: var(--calendar-soft);
  color: var(--calendar-event-ink);
}

.insight-copy {
  min-width: 0;
}

.insight-copy h2 {
  margin: 2px 0 6px;
  color: var(--calendar-ink);
  font-size: 16px;
  font-weight: 600;
  line-height: 1.2;
}

.insight-copy p {
  margin: 0;
  color: var(--calendar-muted);
  font-size: 14px;
  line-height: 1.48;
}

.primary-small-button {
  min-height: 34px;
  margin-top: 16px;
  padding: 0 16px;
  border-radius: 999px;
  cursor: pointer;
  font-family: var(--font-stack);
  font-size: 13px;
  font-weight: 600;
  border: 1px solid var(--calendar-emphasis);
  background: var(--calendar-emphasis);
  color: var(--calendar-on-emphasis);
}

.primary-small-button:hover,
.primary-small-button:focus-visible {
  filter: brightness(1.12);
  outline: 2px solid color-mix(in srgb, var(--calendar-mint-strong) 32%, transparent);
  outline-offset: 2px;
}

.auto-scheduled-card {
  grid-column: 1 / -1;
  min-height: 104px;
  align-items: center;
}

.calendar-surface {
  margin-top: 28px;
  border: 1px solid var(--calendar-line);
  border-radius: 16px;
  background: var(--calendar-surface);
  box-shadow: var(--calendar-card-shadow);
  overflow: hidden;
}

.day-calendar > h2 {
  height: 76px;
  margin: 0;
  padding: 26px 36px;
  border-bottom: 1px solid var(--calendar-line);
  color: var(--calendar-ink);
  font-size: 18px;
  font-weight: 600;
}

.day-timeline {
  position: relative;
  min-width: 720px;
  margin: 0 36px 0 0;
}

.day-hour-line {
  position: absolute;
  left: 0;
  right: 0;
  height: 1px;
  border-top: 1px solid var(--calendar-line);
}

.day-hour-line span {
  position: absolute;
  top: -12px;
  left: 28px;
  width: 66px;
  color: var(--calendar-label);
  font-family: var(--font-mono);
  font-size: 12px;
  text-align: right;
}

.day-event-lane {
  position: absolute;
  inset: 0 0 0 112px;
  border-left: 1px solid var(--calendar-line);
  cursor: crosshair;
}

.calendar-event {
  /* --event-color is set per-event from its owning calendar's color (see
     eventColorVars in the script) so entries match the sidebar's calendar
     list; status tones below override it for conflict/accepted/suggested. */
  border: 1px solid var(--event-color, var(--calendar-event-line));
  border-radius: 10px;
  background: color-mix(in srgb, var(--event-color, var(--calendar-event-surface)) 16%, var(--calendar-surface));
  color: var(--event-color, var(--calendar-ink));
  overflow: hidden;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: filter var(--transition-fast);
}

.calendar-event:hover,
.calendar-event:focus-visible {
  filter: brightness(0.97);
  outline: none;
}

[data-theme='dark'] .calendar-event:hover,
[data-theme='dark'] .calendar-event:focus-visible {
  filter: brightness(1.15);
}

.calendar-event strong {
  display: block;
  min-width: 0;
  overflow: hidden;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.day-event {
  position: absolute;
  left: 0;
  right: 0;
  padding: 8px 12px;
  font-size: 14px;
}

.all-day-row {
  border-bottom: 1px solid var(--calendar-line);
}

.day-calendar .all-day-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 10px 36px 10px 112px;
}

.day-calendar .all-day-event {
  max-width: 100%;
}

.week-all-day-row {
  display: grid;
  grid-template-columns: 76px repeat(7, minmax(0, 1fr));
}

.week-all-day-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 6px;
  border-right: 1px solid var(--calendar-line);
}

.week-all-day-cell:last-child {
  border-right: 0;
}

.all-day-event {
  padding: 4px 10px;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tone-dark {
  border-color: var(--calendar-emphasis);
  background: var(--calendar-emphasis);
  color: var(--calendar-on-emphasis);
}

.tone-conflict {
  border-color: var(--calendar-conflict-line);
  background: var(--calendar-conflict-surface);
  color: var(--calendar-coral);
}

.tone-accepted {
  border-color: var(--calendar-accepted-line);
  background: var(--calendar-accepted-surface);
  color: var(--calendar-accepted-ink);
}

.tone-suggested {
  border: 2px dashed var(--calendar-suggested);
  background: var(--calendar-surface);
  color: var(--calendar-mint-strong);
}

.calendar-event.drag-preview {
  z-index: 5;
  border: 2px dashed var(--calendar-emphasis);
  background: color-mix(in srgb, var(--calendar-emphasis) 14%, transparent);
  pointer-events: none;
}

.current-time-line {
  position: absolute;
  z-index: 6;
  height: 2px;
  background: var(--calendar-time-line);
  pointer-events: none;
}

.current-time-line span {
  position: absolute;
  left: -7px;
  top: -6px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--calendar-time-line);
}

.day-current-time {
  left: 0;
  right: 0;
}

.week-calendar {
  margin-top: 48px;
  min-width: 930px;
}

.week-day-header {
  height: 92px;
  display: grid;
  grid-template-columns: 76px repeat(7, minmax(0, 1fr));
  border-bottom: 1px solid var(--calendar-line);
}

.week-time-spacer {
  border-right: 1px solid var(--calendar-line);
}

.week-day-heading {
  border-right: 1px solid var(--calendar-line);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.week-day-heading:last-child {
  border-right: 0;
}

.week-day-heading > span,
.month-weekdays span {
  color: var(--calendar-label);
  font-family: var(--font-mono);
  font-size: 12px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.week-day-heading strong {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  color: var(--calendar-ink);
  display: grid;
  place-items: center;
  font-size: 15px;
  font-weight: 500;
}

.week-day-heading strong.today,
.month-date.today {
  background: var(--calendar-emphasis);
  color: var(--calendar-on-emphasis);
}

.week-timeline {
  position: relative;
  display: grid;
  grid-template-columns: 76px 1fr;
}

.week-time-axis {
  position: relative;
  border-right: 1px solid var(--calendar-line);
}

.week-hour-label {
  position: absolute;
  right: 14px;
  transform: translateY(-10px);
  color: var(--calendar-label);
  font-family: var(--font-mono);
  font-size: 11px;
}

.week-grid {
  position: relative;
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
}

.week-day-column {
  border-right: 1px solid var(--calendar-line);
  cursor: crosshair;
}

.week-day-column:last-of-type {
  border-right: 0;
}

.week-hour-line {
  position: absolute;
  left: 0;
  right: 0;
  border-top: 1px solid var(--calendar-line);
  pointer-events: none;
}

.week-event {
  position: absolute;
  z-index: 4;
  padding: 6px 8px;
  font-size: 13px;
}

.week-event span {
  display: block;
  margin-top: 4px;
  font-family: var(--font-mono);
  font-size: 11px;
  opacity: 0.8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.month-calendar {
  margin-top: 28px;
  min-width: 900px;
}

.month-weekdays {
  height: 48px;
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  align-items: center;
  border-bottom: 1px solid var(--calendar-line);
  text-align: center;
}

.month-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
}

.month-day {
  min-height: 132px;
  padding: 14px 10px 10px;
  border-right: 1px solid var(--calendar-line);
  border-bottom: 1px solid var(--calendar-line);
}

.month-day:nth-child(7n) {
  border-right: 0;
}

.month-day:nth-last-child(-n + 7) {
  border-bottom: 0;
}

.month-day.muted .month-date {
  color: var(--calendar-muted-date);
}

.month-date {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  color: var(--calendar-ink);
  display: grid;
  place-items: center;
  font-size: 14px;
  font-weight: 500;
}

.month-events {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.month-event {
  width: 100%;
  min-height: 28px;
  padding: 5px 8px;
  border: 1px solid var(--event-color, var(--calendar-event-line));
  border-radius: 8px;
  background: color-mix(in srgb, var(--event-color, var(--calendar-event-surface)) 16%, var(--calendar-surface));
  color: var(--event-color, var(--calendar-event-ink));
  font-family: inherit;
  font-size: 12px;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
  transition: filter var(--transition-fast);
}

.month-event:hover,
.month-event:focus-visible {
  filter: brightness(0.97);
  outline: none;
}

[data-theme='dark'] .month-event:hover,
[data-theme='dark'] .month-event:focus-visible {
  filter: brightness(1.15);
}

.month-event.tone-dark {
  border-color: var(--calendar-emphasis);
  background: var(--calendar-emphasis);
  color: var(--calendar-on-emphasis);
}

.month-event.tone-conflict {
  border-color: var(--calendar-conflict-line);
  background: var(--calendar-conflict-surface);
  color: var(--calendar-coral);
}

.month-event.tone-accepted {
  border-color: var(--calendar-accepted-line);
  background: var(--calendar-accepted-surface);
  color: var(--calendar-accepted-ink);
}

.new-event-overlay {
  position: fixed;
  inset: 0;
  z-index: 900;
  padding: 4px;
  background: var(--calendar-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
}

.new-event-dialog {
  width: min(640px, calc(100vw - 32px));
  padding: 28px;
  border-radius: 12px;
  background: var(--calendar-surface);
  box-shadow: var(--calendar-dialog-shadow);
}

.new-event-dialog-header {
  gap: 16px;
}

.new-event-dialog-fields {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.new-event-title-input,
.new-event-description-input {
  width: 100%;
  border: none;
  border-bottom: 1px solid transparent;
  outline: none;
  background: transparent;
  padding: 0;
  font-family: var(--font-stack);
  color: var(--calendar-ink);
  transition: border-color var(--transition-fast);
}

.new-event-title-input {
  font-size: 22px;
  font-weight: 600;
  line-height: 1.15;
}

.new-event-description-input {
  font-size: 14px;
}

.new-event-title-input::placeholder,
.new-event-description-input::placeholder {
  color: var(--calendar-muted);
  opacity: 1;
}

.new-event-title-input:hover,
.new-event-title-input:focus,
.new-event-description-input:hover,
.new-event-description-input:focus {
  border-bottom-color: var(--calendar-line);
}

.new-event-close {
  width: 36px;
  height: 36px;
  margin-left: auto;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--calendar-muted);
  cursor: pointer;
  display: grid;
  place-items: center;
}

.new-event-close:hover,
.new-event-close:focus-visible {
  background: var(--calendar-soft);
  color: var(--calendar-ink);
  outline: none;
}

.new-event-readonly-note {
  margin: 16px 0 0;
  font-size: 13px;
  color: var(--calendar-muted);
}

.new-event-datetime {
  display: flex;
  gap: 12px;
  margin-top: 24px;
}

.new-event-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.new-event-field span {
  color: var(--calendar-muted);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.new-event-field input,
.new-event-field select {
  height: 40px;
  padding: 0 12px;
  border: 1px solid var(--calendar-line);
  border-radius: 10px;
  outline: none;
  background: var(--calendar-input);
  color: var(--calendar-ink);
  font-family: var(--font-stack);
  font-size: 14px;
  color-scheme: light;
}

[data-theme='dark'] .new-event-field input,
[data-theme='dark'] .new-event-field select {
  color-scheme: dark;
}

.new-event-field input::placeholder {
  color: var(--calendar-muted);
  opacity: 1;
}

.new-event-field input:focus,
.new-event-field select:focus {
  border-color: var(--calendar-emphasis);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--calendar-emphasis) 20%, transparent);
}

.new-event-datetime-field {
  flex: 1;
  min-width: 0;
}

.new-event-location-wrap {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 12px;
  margin-top: 16px;
}

.new-event-repeat-days {
  display: flex;
  gap: 6px;
  margin-top: 12px;
}

.new-event-repeat-day {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--calendar-line);
  border-radius: 999px;
  background: var(--calendar-input);
  color: var(--calendar-ink);
  font-family: var(--font-stack);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.new-event-repeat-day.is-selected {
  border-color: var(--calendar-emphasis);
  background: var(--calendar-emphasis);
  color: var(--calendar-emphasis-ink, #fff);
}

.new-event-dialog-actions {
  margin-top: 24px;
  justify-content: flex-start;
  gap: 12px;
}

.new-event-dialog-actions-right {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-left: auto;
}

.new-event-cancel,
.new-event-create,
.new-event-delete {
  height: 42px;
  padding: 0 20px;
  border-radius: 999px;
  cursor: pointer;
  font-family: var(--font-stack);
  font-size: 14px;
  font-weight: 500;
}

.new-event-cancel {
  border: 1px solid var(--calendar-line);
  background: var(--calendar-surface);
  color: var(--calendar-muted);
}

.new-event-create {
  min-width: 150px;
  border: 1px solid var(--calendar-emphasis);
  background: var(--calendar-emphasis);
  color: var(--calendar-on-emphasis);
}

.new-event-create:disabled {
  border-color: var(--calendar-disabled);
  background: var(--calendar-disabled);
  color: var(--calendar-disabled-ink);
  cursor: not-allowed;
}

.new-event-delete {
  border: 1px solid transparent;
  background: transparent;
  color: #e5484d;
}

.new-event-delete:hover,
.new-event-delete:focus-visible {
  background: rgba(229, 72, 77, 0.08);
  outline: none;
}

.calendar-modal-enter-active,
.calendar-modal-leave-active {
  transition: opacity 180ms ease;
}

.calendar-modal-enter-active .new-event-dialog,
.calendar-modal-leave-active .new-event-dialog {
  transition: transform 180ms ease;
}

.calendar-modal-enter-from,
.calendar-modal-leave-to {
  opacity: 0;
}

.calendar-modal-enter-from .new-event-dialog,
.calendar-modal-leave-to .new-event-dialog {
  transform: translateY(-8px) scale(0.985);
}

@media (max-width: 1120px) {
  .calendar-sidebar.left-sidebar {
    width: 220px;
  }

  .calendar-toolbar,
  .calendar-date-controls {
    align-items: flex-start;
    flex-direction: column;
  }

  .calendar-header-actions {
    width: 100%;
    justify-content: space-between;
  }

  .calendar-page-header.is-month .calendar-header-actions {
    flex-wrap: wrap;
  }

  .calendar-insight-card {
    padding: 32px;
  }
}

@media (max-width: 760px) {
  .calendar-view {
    flex-direction: column;
  }

  .calendar-sidebar.left-sidebar {
    width: 100%;
    min-height: 72px;
    padding: 10px 12px;
    border-right: 0;
    border-bottom: 1px solid var(--calendar-line);
    flex-direction: row;
    align-items: center;
    gap: 10px;
    overflow-x: auto;
    overflow-y: hidden;
  }

  .calendar-sidebar-create.compose-btn {
    min-width: 124px;
    flex: 0 0 auto;
  }

  .calendar-sidebar-section,
  .calendar-list {
    display: flex;
    align-items: center;
    flex-direction: row;
    gap: 4px;
  }

  .calendar-sidebar-label {
    display: none;
  }

  .calendar-list-item.nav-item {
    width: auto;
    min-width: max-content;
    padding-inline: 10px;
  }

  .calendar-list-edit-icon {
    position: static;
    flex: 0 0 24px;
    opacity: 1;
  }

  .calendar-page {
    padding: 24px 16px 48px;
  }

  .calendar-page-header {
    gap: 20px;
  }

  .calendar-date-controls h1 {
    font-size: 28px;
    white-space: normal;
  }

  .calendar-navigation button {
    width: 40px;
    height: 40px;
  }

  .calendar-navigation .today-button {
    min-width: 82px;
    padding-inline: 16px;
    font-size: 14px;
  }

  .calendar-header-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .calendar-view-tabs {
    width: 100%;
    height: 44px;
  }

  .calendar-view-tabs button {
    font-size: 14px;
  }

  .new-event-button,
  .month-new-event-button {
    width: 100%;
    min-width: 0;
    height: 44px;
    border-radius: 12px;
    font-size: 14px;
  }

  .calendar-insights {
    margin-top: 32px;
    grid-template-columns: 1fr;
    gap: 16px;
  }

  .calendar-page-header:not(.is-month) + .calendar-insights {
    margin-top: 32px;
  }

  .calendar-insight-card,
  .auto-scheduled-card {
    grid-column: auto;
    min-height: 0;
    padding: 24px;
    border-radius: 20px;
  }

  .insight-icon {
    width: 44px;
    height: 44px;
    border-radius: 13px;
    font-size: 22px;
  }

  .insight-copy h2 {
    font-size: 16px;
  }

  .insight-copy p {
    font-size: 14px;
  }

  .calendar-surface {
    margin-top: 32px;
    border-radius: 20px;
  }

  .calendar-content:has(.week-calendar),
  .calendar-content:has(.month-calendar),
  .calendar-content:has(.day-calendar) {
    overflow-x: auto;
  }

  .day-calendar {
    min-width: 760px;
  }

  .day-calendar > h2 {
    height: 96px;
    padding: 30px 36px;
    font-size: 26px;
  }

  .week-calendar {
    margin-top: 44px;
  }

  .new-event-overlay {
    padding: 16px;
  }

  .new-event-dialog {
    width: 100%;
    padding: 28px 22px 24px;
    border-radius: 28px;
  }

  .new-event-dialog-header {
    gap: 14px;
  }

  .new-event-title-input {
    font-size: 26px;
  }

  .new-event-description-input {
    font-size: 16px;
  }

  .new-event-datetime {
    flex-direction: column;
  }

  .new-event-dialog-actions {
    margin-top: 28px;
    align-items: stretch;
    flex-direction: column-reverse;
    gap: 10px;
  }

  .new-event-dialog-actions-right {
    flex-direction: column-reverse;
    align-items: stretch;
    width: 100%;
    margin-left: 0;
  }

  .new-event-cancel,
  .new-event-create,
  .new-event-delete {
    width: 100%;
    min-width: 0;
    height: 56px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .calendar-navigation button,
  .calendar-view-tabs button,
  .new-event-button,
  .calendar-modal-enter-active,
  .calendar-modal-leave-active,
  .calendar-modal-enter-active .new-event-dialog,
  .calendar-modal-leave-active .new-event-dialog {
    transition-duration: 0s;
  }
}
</style>
