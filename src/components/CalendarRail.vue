<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { dateKey, meetingLink, monthGrid, normalizeCalendarEvent } from '../utils/calendarDates'
import { assignLanes } from '../utils/calendarLanes'
import { useInboxStore } from '../stores/inbox'
import {
  calendarEventsUrl,
  calendarSession,
  isCalendarSessionCurrent,
  useCalendars,
} from '../composables/useCalendars'

// Read-only day calendar docked on the right of Mail, Documents and Tasks,
// toggled from the header (useCalendarRail). Shows one day: a mini month to
// pick it, the next event with a Join link, all-day chips and a timeline.
// Clicking an event shows its details; editing happens in the Calendar view.
const props = defineProps({
  // A day the rail follows, such as an open daily note's. Null means today.
  date: { type: Date, default: null },
})
const emit = defineEmits(['close'])

const store = useInboxStore()
const { calendars, loadCalendars } = useCalendars(
  (init) => store.authHeaders(init),
  (message, kind) => store.notify(message, kind),
)
loadCalendars()
const calendarById = computed(() => new Map(calendars.value.map((c) => [c.id, c])))

const HOUR_HEIGHT = 48
const hours = Array.from({ length: 24 }, (_, hour) => hour)

const now = ref(new Date())
const todayKey = computed(() => dateKey(now.value))
const selected = ref(props.date ?? new Date())
const selectedKey = computed(() => dateKey(selected.value))
const isToday = computed(() => selectedKey.value === todayKey.value)

const displayedMonth = ref(new Date(selected.value.getFullYear(), selected.value.getMonth(), 1))
function selectDay(date) {
  selected.value = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  displayedMonth.value = new Date(date.getFullYear(), date.getMonth(), 1)
}
watch(
  () => props.date && dateKey(props.date),
  () => selectDay(props.date ?? new Date()),
)
const shiftDay = (days) =>
  selectDay(
    new Date(
      selected.value.getFullYear(),
      selected.value.getMonth(),
      selected.value.getDate() + days,
    ),
  )
const shiftMonth = (months) => {
  const d = displayedMonth.value
  displayedMonth.value = new Date(d.getFullYear(), d.getMonth() + months, 1)
}
const goToday = () => selectDay(new Date())

const monthLabel = computed(() =>
  displayedMonth.value.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
)
const monthDays = computed(() => monthGrid(displayedMonth.value))
const dayLabel = computed(() =>
  selected.value.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }),
)

// --- Events ---------------------------------------------------------------
const events = ref([])
const truncated = ref(false)
const loadFailed = ref(false)
let request = 0
let disposed = false

async function loadEvents() {
  const key = selectedKey.value
  const seq = ++request
  const session = calendarSession()
  try {
    const headers = await store.authHeaders()
    if (disposed || seq !== request || !isCalendarSessionCurrent(session)) return
    const response = await fetch(calendarEventsUrl(key, key), { headers })
    if (!response.ok) throw new Error(`GET calendar-events responded ${response.status}`)
    const body = await response.json()
    if (disposed || seq !== request || !isCalendarSessionCurrent(session)) return
    events.value = (Array.isArray(body.events) ? body.events : [])
      .filter((event) => event.date === key)
      .map(normalizeCalendarEvent)
    truncated.value = Boolean(body.truncated)
    loadFailed.value = false
  } catch (error) {
    if (disposed || seq !== request) return
    console.error('Failed to load the calendar sidebar:', error)
    events.value = []
    loadFailed.value = true
  }
}

const minutesOf = (value) => {
  const [h, m] = String(value).split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}
const nowMinutes = computed(() => now.value.getHours() * 60 + now.value.getMinutes())

const allDayEvents = computed(() => events.value.filter((event) => event.allDay))

// Timed events laid out in side-by-side lanes where they overlap.
const timedEvents = computed(() =>
  assignLanes(
    events.value
      .filter((event) => !event.allDay)
      .map((event) => {
        const start = minutesOf(event.start)
        const end = Math.min(start + Math.max(Number(event.duration) || 0, 15), 24 * 60)
        return { event, start, end }
      }),
  ),
)

function eventColor(event) {
  return calendarById.value.get(event.calendar)?.color || null
}
function eventStyle(item) {
  const style = {
    top: `${(item.start * HOUR_HEIGHT) / 60}px`,
    height: `${Math.max(((item.end - item.start) * HOUR_HEIGHT) / 60 - 2, 18)}px`,
    left: `calc(44px + (100% - 44px) * ${item.lane / item.lanes})`,
    width: `calc((100% - 44px) / ${item.lanes} - 2px)`,
  }
  const color = eventColor(item.event)
  if (color) style['--event-color'] = color
  return style
}
const isPast = (item) => isToday.value && item.end <= nowMinutes.value
const showsTime = (item) => item.end - item.start >= 40

const TIME_FMT = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const HOUR_FMT = new Intl.DateTimeFormat(undefined, { hour: 'numeric' })
const timeLabel = (minutes) => TIME_FMT.format(new Date(2000, 0, 1, 0, minutes))
const hourLabel = (hour) => HOUR_FMT.format(new Date(2000, 0, 1, hour))

const upNext = computed(() => {
  if (!isToday.value) return null
  const next = timedEvents.value.find((item) => item.start > nowMinutes.value)
  if (!next) return null
  const minutes = next.start - nowMinutes.value
  const countdown =
    minutes < 60
      ? `in ${minutes} min`
      : `in ${Math.floor(minutes / 60)} hr${minutes % 60 ? ` ${minutes % 60} min` : ''}`
  return { ...next, countdown, link: meetingLink(next.event) }
})

// --- Details --------------------------------------------------------------
const openEvent = ref(null)
const openEventDetails = computed(() => {
  const event = openEvent.value
  if (!event) return null
  const start = minutesOf(event.start)
  return {
    event,
    when: event.allDay
      ? 'All day'
      : `${timeLabel(start)} – ${timeLabel(start + (Number(event.duration) || 0))}`,
    calendarName: calendarById.value.get(event.calendar)?.name ?? null,
    link: meetingLink(event),
  }
})
watch(selectedKey, () => {
  openEvent.value = null
})

// --- Scrolling and refresh ------------------------------------------------
const timeline = ref(null)
function scrollToFocus() {
  const el = timeline.value
  if (!el) return
  const first = timedEvents.value[0]?.start
  const focus = isToday.value ? nowMinutes.value : (first ?? 8 * 60)
  const offset = isToday.value ? el.clientHeight / 3 : 16
  el.scrollTop = Math.max(0, (focus * HOUR_HEIGHT) / 60 - offset)
}
watch(
  selectedKey,
  async () => {
    await loadEvents()
    await nextTick()
    scrollToFocus()
  },
  { immediate: true },
)

let timer
let lastRefresh = Date.now()
function tick() {
  const previousDay = todayKey.value
  now.value = new Date()
  if (document.visibilityState === 'hidden') return
  // Following "today" across midnight, unless a daily note pins the day.
  if (previousDay !== todayKey.value && !props.date && selectedKey.value === previousDay) goToday()
  else if (Date.now() - lastRefresh >= 300_000) refresh()
}
function refresh() {
  lastRefresh = Date.now()
  now.value = new Date()
  loadEvents()
}
function onVisibilityChange() {
  if (document.visibilityState === 'visible') refresh()
}
function onKeydown(event) {
  if (event.key === 'Escape' && openEvent.value) {
    openEvent.value = null
    event.stopPropagation()
  }
}
onMounted(() => {
  timer = setInterval(tick, 30_000)
  window.addEventListener('focus', refresh)
  document.addEventListener('visibilitychange', onVisibilityChange)
})
onUnmounted(() => {
  disposed = true
  clearInterval(timer)
  window.removeEventListener('focus', refresh)
  document.removeEventListener('visibilitychange', onVisibilityChange)
})
</script>

<template>
  <aside class="calendar-rail" aria-label="Calendar" @keydown="onKeydown">
    <header class="cr-head">
      <h2 class="cr-title">
        <template v-if="isToday"
          >Today <span class="cr-title-date">· {{ dayLabel }}</span></template
        >
        <template v-else>{{ dayLabel }}</template>
      </h2>
      <button v-if="!isToday" type="button" class="cr-today" @click="goToday">Today</button>
      <button type="button" class="cr-icon-btn" aria-label="Previous day" @click="shiftDay(-1)">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 5-7 7 7 7" /></svg>
      </button>
      <button type="button" class="cr-icon-btn" aria-label="Next day" @click="shiftDay(1)">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 5 7 7-7 7" /></svg>
      </button>
      <button
        type="button"
        class="cr-icon-btn"
        aria-label="Hide calendar sidebar"
        @click="emit('close')"
      >
        <span class="material-symbols-outlined" aria-hidden="true">close</span>
      </button>
    </header>

    <div class="cr-month">
      <div class="cr-month-head">
        <span class="cr-month-label">{{ monthLabel }}</span>
        <span>
          <button
            type="button"
            class="cr-icon-btn"
            aria-label="Previous month"
            @click="shiftMonth(-1)"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 5-7 7 7 7" /></svg>
          </button>
          <button type="button" class="cr-icon-btn" aria-label="Next month" @click="shiftMonth(1)">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 5 7 7-7 7" /></svg>
          </button>
        </span>
      </div>
      <div class="cr-weekdays" aria-hidden="true">
        <span v-for="(label, index) in ['M', 'T', 'W', 'T', 'F', 'S', 'S']" :key="index">{{
          label
        }}</span>
      </div>
      <div class="cr-grid">
        <button
          v-for="day in monthDays"
          :key="day.key"
          type="button"
          class="cr-day"
          :class="{
            'out-of-month': !day.inMonth,
            today: day.key === todayKey,
            selected: day.key === selectedKey,
          }"
          :aria-label="day.date.toLocaleDateString(undefined, { dateStyle: 'full' })"
          :aria-pressed="day.key === selectedKey"
          @click="selectDay(day.date)"
        >
          {{ day.label }}
        </button>
      </div>
    </div>

    <div
      v-if="upNext"
      class="cr-up-next"
      :style="eventColor(upNext.event) ? { '--event-color': eventColor(upNext.event) } : undefined"
    >
      <span class="cr-up-next-bar" aria-hidden="true"></span>
      <button type="button" class="cr-up-next-body" @click="openEvent = upNext.event">
        <span class="cr-up-next-label">Up next · {{ upNext.countdown }}</span>
        <span class="cr-up-next-title">{{ upNext.event.title }}</span>
        <span class="cr-up-next-time"
          >{{ timeLabel(upNext.start) }} – {{ timeLabel(upNext.end) }}</span
        >
      </button>
      <a
        v-if="upNext.link"
        class="cr-join"
        :href="upNext.link"
        target="_blank"
        rel="noopener noreferrer"
        >Join</a
      >
    </div>

    <p v-if="loadFailed" class="cr-note" role="status">Couldn't load this day's events.</p>
    <p v-else-if="truncated" class="cr-note" role="status">
      Some events could not be shown. Open Calendar to see them all.
    </p>

    <div v-if="allDayEvents.length" class="cr-all-day" aria-label="All-day events">
      <button
        v-for="event in allDayEvents"
        :key="event.id"
        type="button"
        class="cr-all-day-chip"
        :style="eventColor(event) ? { '--event-color': eventColor(event) } : undefined"
        @click="openEvent = event"
      >
        {{ event.title }}
      </button>
    </div>

    <div ref="timeline" class="cr-timeline">
      <div class="cr-timeline-body" :style="{ height: `${24 * HOUR_HEIGHT}px` }">
        <div
          v-for="hour in hours"
          :key="hour"
          class="cr-hour"
          :style="{ top: `${hour * HOUR_HEIGHT}px` }"
        >
          <span v-if="hour" class="cr-hour-label">{{ hourLabel(hour) }}</span>
        </div>
        <button
          v-for="item in timedEvents"
          :key="item.event.id"
          type="button"
          class="cr-event"
          :class="{ past: isPast(item) }"
          :style="eventStyle(item)"
          @click="openEvent = item.event"
        >
          <strong>{{ item.event.title }}</strong>
          <small v-if="showsTime(item)"
            >{{ timeLabel(item.start)
            }}<template v-if="item.event.location"> · {{ item.event.location }}</template></small
          >
        </button>
        <div
          v-if="isToday"
          class="cr-now"
          :style="{ top: `${(nowMinutes * HOUR_HEIGHT) / 60}px` }"
          aria-hidden="true"
        ></div>
      </div>
    </div>

    <footer class="cr-foot">
      <RouterLink :to="{ name: 'calendar', query: { date: selectedKey } }"
        >Open Calendar</RouterLink
      >
    </footer>

    <section
      v-if="openEventDetails"
      class="cr-details"
      role="dialog"
      aria-label="Event details"
      :style="
        eventColor(openEventDetails.event)
          ? { '--event-color': eventColor(openEventDetails.event) }
          : undefined
      "
    >
      <button
        type="button"
        class="cr-icon-btn cr-details-close"
        aria-label="Close event details"
        @click="openEvent = null"
      >
        <span class="material-symbols-outlined" aria-hidden="true">close</span>
      </button>
      <h3><span class="cr-swatch" aria-hidden="true"></span>{{ openEventDetails.event.title }}</h3>
      <dl>
        <dt>When</dt>
        <dd>{{ dayLabel }}, {{ openEventDetails.when }}</dd>
        <template v-if="openEventDetails.calendarName">
          <dt>Calendar</dt>
          <dd>{{ openEventDetails.calendarName }}</dd>
        </template>
        <template v-if="openEventDetails.event.location">
          <dt>Where</dt>
          <dd>{{ openEventDetails.event.location }}</dd>
        </template>
      </dl>
      <div class="cr-details-actions">
        <a
          v-if="openEventDetails.link"
          class="cr-join"
          :href="openEventDetails.link"
          target="_blank"
          rel="noopener noreferrer"
          >Join</a
        >
        <RouterLink
          class="cr-secondary"
          :to="{
            name: 'calendar',
            query: { date: openEventDetails.event.date, event: openEventDetails.event.id },
          }"
          >Open in Calendar</RouterLink
        >
      </div>
    </section>
  </aside>
</template>

<style scoped>
.calendar-rail {
  position: relative;
  width: 300px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  margin-left: 8px;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
  color: var(--text-primary);
}

.cr-head {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 10px 8px 6px 14px;
}

.cr-title {
  flex: 1;
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cr-title-date {
  font-weight: 400;
  color: var(--text-secondary);
}

.cr-today {
  border: 1px solid var(--border-color);
  background: var(--bg-card);
  color: var(--text-primary);
  border-radius: 6px;
  padding: 2px 8px;
  font-size: 12px;
  cursor: pointer;
}

.cr-icon-btn {
  display: inline-grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.cr-icon-btn .material-symbols-outlined {
  font-size: 18px;
}

/* Chevrons are inline SVG: the icon font is a subset without them. */
.cr-icon-btn svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.cr-icon-btn:hover,
.cr-today:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.cr-month {
  padding: 0 12px 8px;
}

.cr-month-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 0 4px 4px;
}

.cr-month-label {
  font-size: 12.5px;
  font-weight: 600;
}

.cr-weekdays,
.cr-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  text-align: center;
}

.cr-weekdays span {
  font-size: 10.5px;
  color: var(--text-secondary);
  padding-bottom: 2px;
}

.cr-day {
  justify-self: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--text-primary);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}

.cr-day:hover {
  background: var(--bg-hover);
}

.cr-day.out-of-month {
  color: var(--text-secondary);
  opacity: 0.5;
}

.cr-day.today {
  color: var(--text-blue);
  font-weight: 700;
}

.cr-day.selected {
  background: var(--accent);
  color: #fff;
  font-weight: 700;
  opacity: 1;
}

.cr-up-next {
  display: grid;
  grid-template-columns: 3px 1fr auto;
  gap: 10px;
  align-items: center;
  margin: 2px 12px 10px;
  padding: 8px 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
}

.cr-up-next-bar {
  align-self: stretch;
  border-radius: 2px;
  background: var(--event-color, var(--accent));
}

.cr-up-next-body {
  display: grid;
  min-width: 0;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.cr-up-next-label {
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.cr-up-next-title {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cr-up-next-time {
  font-size: 12px;
  color: var(--text-secondary);
}

.cr-join {
  border-radius: 6px;
  background: var(--accent);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  padding: 5px 10px;
  text-decoration: none;
}

.cr-join:hover {
  background: var(--accent-hover);
}

.cr-note {
  margin: 0 12px 8px;
  font-size: 12px;
  color: var(--text-secondary);
}

.cr-all-day {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 6px 12px 8px 50px;
  border-top: 1px solid var(--border-color);
}

.cr-all-day-chip {
  border: 0;
  border-left: 3px solid var(--event-color, var(--text-blue));
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 11.5px;
  color: var(--text-primary);
  background: color-mix(in srgb, var(--event-color, var(--text-blue)) 16%, var(--bg-card));
  cursor: pointer;
}

.cr-timeline {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  border-top: 1px solid var(--border-color);
  padding: 8px 8px 8px 0;
}

.cr-timeline-body {
  position: relative;
}

.cr-hour {
  position: absolute;
  left: 44px;
  right: 0;
  border-top: 1px solid var(--border-color);
}

.cr-hour-label {
  position: absolute;
  right: calc(100% + 6px);
  top: -8px;
  font-size: 10.5px;
  color: var(--text-secondary);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.cr-event {
  position: absolute;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 2px 6px;
  border: 0;
  border-left: 3px solid var(--event-color, var(--text-blue));
  border-radius: 5px;
  background: color-mix(in srgb, var(--event-color, var(--text-blue)) 16%, var(--bg-card));
  color: var(--text-primary);
  text-align: left;
  font-size: 12px;
  line-height: 1.3;
  cursor: pointer;
}

.cr-event:hover {
  background: color-mix(in srgb, var(--event-color, var(--text-blue)) 26%, var(--bg-card));
}

.cr-event strong {
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cr-event small {
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cr-event.past {
  opacity: 0.55;
}

.cr-now {
  position: absolute;
  left: 40px;
  right: 0;
  border-top: 2px solid #e5484d;
  pointer-events: none;
}

.cr-now::before {
  content: '';
  position: absolute;
  left: -4px;
  top: -5px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #e5484d;
}

.cr-foot {
  border-top: 1px solid var(--border-color);
  padding: 8px 14px;
  font-size: 12.5px;
}

.cr-foot a {
  color: var(--text-blue);
  text-decoration: none;
}

.cr-foot a:hover {
  text-decoration: underline;
}

.cr-details {
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: 44px;
  z-index: var(--z-popover);
  display: grid;
  gap: 8px;
  padding: 14px 14px 12px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--bg-dialog);
  box-shadow: var(--shadow-lg);
}

.cr-details h3 {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  margin: 0;
  padding-right: 24px;
  font-size: 14px;
  overflow-wrap: anywhere;
}

.cr-swatch {
  flex: none;
  width: 10px;
  height: 10px;
  margin-top: 4px;
  border-radius: 3px;
  background: var(--event-color, var(--text-blue));
}

.cr-details dl {
  display: grid;
  grid-template-columns: 64px 1fr;
  gap: 4px 8px;
  margin: 0;
  font-size: 12.5px;
}

.cr-details dt {
  color: var(--text-secondary);
}

.cr-details dd {
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}

.cr-details-close {
  position: absolute;
  top: 8px;
  right: 8px;
}

.cr-details-actions {
  display: flex;
  gap: 6px;
  align-items: center;
}

.cr-secondary {
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  color: var(--text-primary);
  text-decoration: none;
}

.cr-secondary:hover {
  background: var(--bg-hover);
}

.calendar-rail button:focus-visible,
.calendar-rail a:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

/* Narrow windows: float over the content instead of squeezing it. */
@media (max-width: 1100px) {
  .calendar-rail {
    position: absolute;
    top: 0;
    right: 8px;
    bottom: 8px;
    z-index: var(--z-drawer);
    box-shadow: var(--shadow-lg);
  }
}

/* Phones keep the inbox's "next event" chip instead. */
@media (max-width: 760px) {
  .calendar-rail {
    display: none;
  }
}
</style>
