<script setup>
import { computed, ref, watch } from 'vue'
import { useInboxStore } from '../stores/inbox'
import { useDocumentsStore } from '../stores/documents'
import { useCalendars } from '../composables/useCalendars'

// Read-only day view docked next to a daily note (Daily/<year>/<month>/DD-MM-YY):
// a NotePlan-style mini month calendar plus that day's Cookie events, so the
// note and the day it belongs to are visible together. Never creates,
// edits, or navigates to events directly - open the full Calendar view for
// that. Typed "10:00 - 11:00 - Title" lines in the note itself do create/
// update/delete a linked event server-side (api/_lib/dailyEventSync.js);
// this view just needs to refetch after a save picks one up (see the
// documentsStore.saveState watcher below).
const props = defineProps({
  date: { type: Date, required: true },
})

const store = useInboxStore()
const documentsStore = useDocumentsStore()
const { calendars, loadCalendars } = useCalendars(
  (init) => store.authHeaders(init),
  (message, kind) => store.notify(message, kind),
)
loadCalendars()

const calendarColorById = computed(() => new Map(calendars.value.map((c) => [c.id, c.color])))

const START_HOUR = 8
const END_HOUR = 19
const HOUR_HEIGHT = 56
const hours = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i)

const dateKey = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

const today = new Date()
const todayKey = dateKey(today)
const selectedKey = computed(() => dateKey(props.date))

// Independent from props.date: the mini calendar can be browsed to other
// months without changing which day's agenda is shown below it.
const displayedMonth = ref(new Date(props.date.getFullYear(), props.date.getMonth(), 1))
watch(
  () => props.date,
  (date) => {
    displayedMonth.value = new Date(date.getFullYear(), date.getMonth(), 1)
  },
)

const monthLabel = computed(() =>
  displayedMonth.value.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
)

function previousMonth() {
  const d = displayedMonth.value
  displayedMonth.value = new Date(d.getFullYear(), d.getMonth() - 1, 1)
}
function nextMonth() {
  const d = displayedMonth.value
  displayedMonth.value = new Date(d.getFullYear(), d.getMonth() + 1, 1)
}

// 6 fixed weeks (Monday-first) so the grid height never jumps between months.
const monthWeeks = computed(() => {
  const first = displayedMonth.value
  const mondayOffset = (first.getDay() + 6) % 7
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - mondayOffset)
  const weeks = []
  for (let week = 0; week < 6; week += 1) {
    const days = []
    for (let day = 0; day < 7; day += 1) {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + week * 7 + day)
      days.push({
        date,
        key: dateKey(date),
        label: date.getDate(),
        inMonth: date.getMonth() === first.getMonth(),
      })
    }
    weeks.push(days)
  }
  return weeks
})

const events = ref([])

async function loadEvents() {
  const key = selectedKey.value
  try {
    const headers = await store.authHeaders()
    const response = await fetch(`/api/calendar-events?from=${key}&to=${key}`, { headers })
    if (!response.ok) throw new Error(`GET calendar-events responded ${response.status}`)
    const body = await response.json()
    if (selectedKey.value !== key) return
    events.value = (body.events ?? []).map((event) => ({
      ...event,
      // Older calendar rows can predate the all_day flag. Midnight events
      // spanning a complete day are still all-day events and must never be
      // positioned against the hourly agenda — mirrors CalendarView.vue.
      allDay:
        event.allDay === true ||
        (String(event.start).startsWith('00:00') && Number(event.duration) >= 24 * 60),
    }))
  } catch (error) {
    console.error('Failed to load the daily note calendar sidebar:', error)
  }
}
watch(selectedKey, loadEvents, { immediate: true })

// A successful autosave may have synced a typed time-line into a linked
// event server-side (api/_lib/dailyEventSync.js) - refetch to pick it up.
// saveState also turns 'saved' for edits with no time-line at all, which
// just means one harmless extra fetch.
watch(
  () => documentsStore.saveState,
  (state) => {
    if (state === 'saved') loadEvents()
  },
)

const allDayEvents = computed(() => events.value.filter((event) => event.allDay))
const timedEvents = computed(() => events.value.filter((event) => !event.allDay))

function timeStringToMinutes(value) {
  const [h, m] = value.split(':').map(Number)
  return h * 60 + m
}

function eventStyle(event) {
  const start = timeStringToMinutes(event.start)
  const clampedStart = Math.max(start, START_HOUR * 60)
  const end = Math.min(start + event.duration, END_HOUR * 60 + 60)
  const height = Math.max(end - clampedStart, 20)
  const style = {
    top: `${(clampedStart - START_HOUR * 60) * (HOUR_HEIGHT / 60)}px`,
    height: `${height * (HOUR_HEIGHT / 60)}px`,
  }
  const color = calendarColorById.value.get(event.calendar)
  if (color) style['--event-color'] = color
  return style
}

const HOUR_FMT = new Intl.DateTimeFormat('en-US', { hour: 'numeric' })
function hourLabel(hour) {
  return HOUR_FMT.format(new Date(2000, 0, 1, hour))
}
</script>

<template>
  <aside class="document-calendar-sidebar" aria-label="Calendar">
    <div class="mini-month">
      <div class="mini-month-header">
        <span class="mini-month-label">{{ monthLabel }}</span>
        <div class="mini-month-nav">
          <button type="button" aria-label="Previous month" @click="previousMonth">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m14.5 5-7 7 7 7" />
            </svg>
          </button>
          <button type="button" aria-label="Next month" @click="nextMonth">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m9.5 5 7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
      <div class="mini-month-weekdays">
        <span v-for="label in ['M', 'T', 'W', 'T', 'F', 'S', 'S']" :key="label">{{ label }}</span>
      </div>
      <div class="mini-month-grid">
        <span
          v-for="day in monthWeeks.flat()"
          :key="day.key"
          class="mini-month-day"
          :class="{
            'out-of-month': !day.inMonth,
            today: day.key === todayKey,
            selected: day.key === selectedKey,
          }"
        >
          {{ day.label }}
        </span>
      </div>
    </div>

    <div v-if="allDayEvents.length" class="sidebar-all-day" aria-label="All-day events">
      <span v-for="event in allDayEvents" :key="event.id" class="sidebar-all-day-chip">
        {{ event.title }}
      </span>
    </div>

    <div class="sidebar-agenda">
      <div class="sidebar-agenda-body" :style="{ height: `${(END_HOUR - START_HOUR) * HOUR_HEIGHT}px` }">
        <div
          v-for="hour in hours"
          :key="hour"
          class="sidebar-hour-line"
          :style="{ top: `${(hour - START_HOUR) * HOUR_HEIGHT}px` }"
        >
          <span class="sidebar-hour-label">{{ hourLabel(hour) }}</span>
        </div>
        <div
          v-for="event in timedEvents"
          :key="event.id"
          class="sidebar-event"
          :style="eventStyle(event)"
        >
          <strong>{{ event.title }}</strong>
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.document-calendar-sidebar {
  width: 300px;
  flex-shrink: 0;
  border-left: 1px solid var(--border-color);
  padding: 20px 16px;
  position: sticky;
  top: 0;
  align-self: flex-start;
  max-height: 100vh;
  overflow-y: auto;
}

.mini-month-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.mini-month-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.mini-month-nav {
  display: flex;
  gap: 2px;
}

.mini-month-nav button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.mini-month-nav button:hover {
  background: var(--bg-hover);
}

.mini-month-nav svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.mini-month-weekdays,
.mini-month-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
}

.mini-month-weekdays span {
  text-align: center;
  font-size: 11px;
  color: var(--text-secondary);
  padding-bottom: 6px;
}

.mini-month-day {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 28px;
  font-size: 12px;
  color: var(--text-primary);
  border-radius: 50%;
}

.mini-month-day.out-of-month {
  color: var(--text-secondary);
  opacity: 0.4;
}

.mini-month-day.today {
  font-weight: 700;
  color: var(--text-blue);
}

.mini-month-day.selected {
  background: var(--text-blue);
  color: var(--bg-card);
  font-weight: 700;
}

.sidebar-all-day {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 12px 0;
  border-top: 1px solid var(--border-color);
  margin-top: 16px;
}

.sidebar-all-day-chip {
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--bg-hover);
  color: var(--text-primary);
}

.sidebar-agenda {
  margin-top: 12px;
  border-top: 1px solid var(--border-color);
  padding-top: 12px;
}

.sidebar-agenda-body {
  position: relative;
}

.sidebar-hour-line {
  position: absolute;
  left: 0;
  right: 0;
  border-top: 1px solid var(--border-color);
}

.sidebar-hour-label {
  position: relative;
  top: -8px;
  font-size: 10px;
  color: var(--text-secondary);
  background: var(--bg-card);
  padding-right: 4px;
}

.sidebar-event {
  position: absolute;
  left: 32px;
  right: 4px;
  overflow: hidden;
  border-radius: 6px;
  padding: 2px 6px;
  font-size: 11px;
  line-height: 1.3;
  color: var(--text-primary);
  background: color-mix(in srgb, var(--event-color, var(--text-blue)) 18%, var(--bg-card));
  border-left: 3px solid var(--event-color, var(--text-blue));
}
</style>
