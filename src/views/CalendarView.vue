<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'

const REFERENCE_DATE = new Date(2026, 6, 24)
const DAY_HOUR_HEIGHT = 96
const WEEK_HOUR_HEIGHT = 72
const START_HOUR = 8
const END_HOUR = 19

const viewMode = ref('day')
const selectedDate = ref(new Date(REFERENCE_DATE))
const showNewEvent = ref(false)
const eventRequest = ref('')
const conflictVisible = ref(true)
const suggestionVisible = ref(true)
const generatedEvents = ref([])
const calendars = [
  { id: 'work', name: 'Work', color: '#4f7c6b' },
  { id: 'personal', name: 'Personal', color: '#2db985' },
  { id: 'focus', name: 'Focus time', color: '#795da8' },
  { id: 'birthdays', name: 'Birthdays', color: '#d8953b' },
  { id: 'holidays', name: 'Holidays', color: '#d15c4e' },
]
const visibleCalendars = ref(new Set(calendars.map((calendar) => calendar.id)))

const seedEvents = [
  {
    id: 'team-sync',
    title: 'Team sync',
    date: '2026-07-20',
    start: '09:00',
    duration: 30,
    calendar: 'work',
  },
  {
    id: 'priya',
    title: '1:1 with Priya',
    date: '2026-07-21',
    start: '10:00',
    duration: 30,
    calendar: 'work',
  },
  {
    id: 'focus',
    title: 'Focus — Q3 planning',
    date: '2026-07-22',
    start: '13:00',
    duration: 120,
    tone: 'dark',
    calendar: 'focus',
  },
  {
    id: 'design',
    title: 'Design review',
    date: '2026-07-23',
    start: '11:00',
    duration: 60,
    calendar: 'work',
  },
  {
    id: 'client-call',
    title: 'Client call — Meridian',
    date: '2026-07-23',
    start: '11:30',
    duration: 60,
    tone: 'conflict',
    calendar: 'work',
  },
  {
    id: 'standup',
    title: 'Standup',
    date: '2026-07-24',
    start: '09:00',
    duration: 30,
    calendar: 'work',
  },
  {
    id: 'coffee',
    title: 'Coffee with Sam',
    date: '2026-07-24',
    start: '14:30',
    duration: 30,
    tone: 'accepted',
    calendar: 'personal',
  },
]

const suggestedEvent = {
  id: 'suggested',
  title: 'Suggested',
  date: '2026-07-21',
  start: '14:00',
  duration: 45,
  tone: 'suggested',
  calendar: 'work',
}

const allEvents = computed(() => [...seedEvents, ...generatedEvents.value])
const visibleEvents = computed(() =>
  allEvents.value.filter((event) => visibleCalendars.value.has(event.calendar)),
)

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

const formatLongDate = (date) =>
  new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(date)

const formatMonth = (date) =>
  new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(date)

const formatShortMonthDay = (date) =>
  new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date)

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
  visibleEvents.value.filter((event) => event.date === dateKey(selectedDate.value)),
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
  return {
    top: `${(hour - START_HOUR + minute / 60) * hourHeight}px`,
    height: `${Math.max((event.duration / 60) * hourHeight, 38)}px`,
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

const eventTime = (event) => {
  const { hour, minute } = parseStart(event.start)
  const suffix = hour >= 12 ? 'PM' : 'AM'
  const displayHour = hour % 12 || 12
  return `${displayHour}:${String(minute).padStart(2, '0')} ${suffix}`
}

const isToday = (date) => dateKey(date) === dateKey(REFERENCE_DATE)
const isCurrentMonth = (date) => date.getMonth() === selectedDate.value.getMonth()
const eventsForDate = (date) => visibleEvents.value.filter((event) => event.date === dateKey(date))

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

function openNewEvent() {
  showNewEvent.value = true
}

function closeNewEvent() {
  showNewEvent.value = false
  eventRequest.value = ''
}

function createEvent() {
  const title = eventRequest.value.trim()
  if (!title) return
  generatedEvents.value.push({
    id: `generated-${Date.now()}`,
    title,
    date: dateKey(selectedDate.value),
    start: '14:00',
    duration: 30,
    tone: 'accepted',
    calendar: 'personal',
  })
  closeNewEvent()
}

function onKeydown(event) {
  if (event.key === 'Escape' && showNewEvent.value) closeNewEvent()
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <section class="calendar-view" aria-label="Calendar">
    <aside class="left-sidebar calendar-sidebar" aria-label="Calendar sidebar">
      <button type="button" class="compose-btn calendar-sidebar-create" @click="openNewEvent">
        <span class="material-symbols-outlined" aria-hidden="true">add</span>
        <span>New event</span>
      </button>

      <div class="calendar-sidebar-section">
        <div class="sb-section-label calendar-sidebar-label">
          <span>Calendars</span>
        </div>

        <nav class="sidebar-nav calendar-list" aria-label="Calendars">
          <button
            v-for="calendar in calendars"
            :key="calendar.id"
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
        </nav>
      </div>
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
              @click="openNewEvent"
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
        <article v-if="conflictVisible" class="calendar-insight-card">
          <span class="insight-icon conflict-icon material-symbols-outlined" aria-hidden="true">
            warning_amber
          </span>
          <div class="insight-copy">
            <h2>Scheduling conflict</h2>
            <p>"Client call — Meridian" overlaps "Design review" by 30 min on Thu.</p>
            <button type="button" class="primary-small-button" @click="conflictVisible = false">
              Resolve
            </button>
          </div>
        </article>

        <article v-if="suggestionVisible" class="calendar-insight-card">
          <span class="insight-icon suggestion-icon material-symbols-outlined" aria-hidden="true">
            auto_awesome
          </span>
          <div class="insight-copy">
            <h2>Suggested slot</h2>
            <p>A 45-min opening for "Roadmap sync — Priya" — Tue, 2:00–2:45 PM.</p>
            <div class="insight-actions">
              <button type="button" class="primary-small-button" @click="suggestionVisible = false">
                Accept
              </button>
              <button type="button" class="secondary-small-button" @click="suggestionVisible = false">
                Skip
              </button>
            </div>
          </div>
        </article>

        <article class="calendar-insight-card auto-scheduled-card">
          <span class="insight-icon auto-icon material-symbols-outlined" aria-hidden="true">bolt</span>
          <div class="insight-copy">
            <h2>Auto-scheduled</h2>
            <p>Cookie booked 2 events this week around your availability.</p>
          </div>
        </article>
      </section>

      <section v-if="viewMode === 'day'" class="day-calendar calendar-surface" aria-label="Day view">
        <h2>{{ formatLongDate(selectedDate) }}</h2>
        <div class="day-timeline" :style="{ height: `${dayBodyHeight}px` }">
          <div
            v-for="(hour, index) in hours"
            :key="hour"
            class="day-hour-line"
            :style="{ top: `${index * DAY_HOUR_HEIGHT}px` }"
          >
            <span>{{ timeLabel(hour) }}</span>
          </div>
          <div class="day-event-lane">
            <article
              v-for="event in eventsForDay"
              :key="event.id"
              class="calendar-event day-event"
              :class="`tone-${event.tone || 'default'}`"
              :style="eventPosition(event, DAY_HOUR_HEIGHT)"
            >
              <strong>{{ event.title }}</strong>
            </article>
            <div class="current-time-line day-current-time" aria-label="Current time 11:30 AM">
              <span></span>
            </div>
          </div>
        </div>
      </section>

      <section v-else-if="viewMode === 'week'" class="week-calendar calendar-surface" aria-label="Week view">
        <div class="week-day-header">
          <div class="week-time-spacer"></div>
          <div v-for="date in weekDays" :key="dateKey(date)" class="week-day-heading">
            <span>{{ new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(date) }}</span>
            <strong :class="{ today: isToday(date) }">{{ date.getDate() }}</strong>
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
            <div v-for="date in weekDays" :key="dateKey(date)" class="week-day-column"></div>
            <div
              v-for="(_, index) in hours"
              :key="index"
              class="week-hour-line"
              :style="{ top: `${index * WEEK_HOUR_HEIGHT}px` }"
            ></div>
            <article
              v-for="event in visibleEvents.filter((item) =>
                weekDays.some((date) => dateKey(date) === item.date),
              )"
              :key="event.id"
              class="calendar-event week-event"
              :class="`tone-${event.tone || 'default'}`"
              :style="weekEventStyle(event)"
            >
              <strong>{{ event.title }}</strong>
              <span v-if="event.duration >= 60">{{ eventTime(event) }} · {{ event.duration }} min</span>
            </article>
            <article
              v-if="suggestionVisible"
              class="calendar-event week-event tone-suggested"
              :style="weekEventStyle(suggestedEvent)"
            >
              <strong>Suggested</strong>
            </article>
            <div class="current-time-line week-current-time" aria-label="Current time 11:30 AM">
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
              <div
                v-for="event in eventsForDate(date)"
                :key="event.id"
                class="month-event"
                :class="`tone-${event.tone || 'default'}`"
              >
                {{ event.title }}
              </div>
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
          aria-labelledby="new-event-title"
        >
          <header class="new-event-dialog-header">
            <span class="new-event-dialog-icon material-symbols-outlined" aria-hidden="true">
              auto_awesome
            </span>
            <div>
              <h2 id="new-event-title">New event</h2>
              <p>Tell Cookie what you need — it fills in the rest</p>
            </div>
            <button type="button" class="new-event-close" aria-label="Close" @click="closeNewEvent">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18" />
              </svg>
            </button>
          </header>

          <div class="new-event-request-wrap">
            <div class="composer-ai-inline">
              <span class="material-symbols-outlined" aria-hidden="true">auto_fix_high</span>
              <input
                v-model="eventRequest"
                type="text"
                class="composer-ai-inline-input new-event-request"
                maxlength="1000"
                placeholder="e.g. Coffee with Sam next week, 30 min"
                aria-label="Describe the event"
                @keydown.enter.prevent="createEvent"
              />
            </div>
          </div>

          <footer class="new-event-dialog-actions">
            <button type="button" class="new-event-cancel" @click="closeNewEvent">Cancel</button>
            <button
              type="button"
              class="new-event-create"
              :disabled="!eventRequest.trim()"
              @click="createEvent"
            >
              Create with Cookie
            </button>
          </footer>
        </section>
      </div>
    </Transition>
  </section>
</template>

<style scoped>
.calendar-view {
  --calendar-canvas: var(--bg-app);
  --calendar-surface: var(--bg-card);
  --calendar-ink: var(--text-primary);
  --calendar-muted: var(--text-secondary);
  --calendar-label: var(--text-secondary);
  --calendar-muted-date: color-mix(in srgb, var(--text-secondary) 60%, transparent);
  --calendar-line: var(--border-color);
  --calendar-soft: var(--bg-hover);
  --calendar-mint: var(--bg-input);
  --calendar-mint-strong: var(--text-blue);
  --calendar-coral: #d93025;
  --calendar-coral-soft: rgba(217, 48, 37, 0.1);
  --calendar-event-line: var(--border-color);
  --calendar-event-surface: var(--bg-input);
  --calendar-event-ink: var(--text-primary);
  --calendar-conflict-line: #d93025;
  --calendar-conflict-surface: rgba(217, 48, 37, 0.1);
  --calendar-accepted-line: #0f9d58;
  --calendar-accepted-surface: rgba(15, 157, 88, 0.12);
  --calendar-accepted-ink: #0f9d58;
  --calendar-suggested: var(--text-purple);
  --calendar-input: var(--bg-input);
  --calendar-overlay: rgba(0, 0, 0, 0.35);
  --calendar-emphasis: var(--text-blue);
  --calendar-on-emphasis: #ffffff;
  --calendar-time-line: #d93025;
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
  --calendar-coral: #f28b82;
  --calendar-coral-soft: rgba(242, 139, 130, 0.16);
  --calendar-conflict-line: #f28b82;
  --calendar-conflict-surface: rgba(242, 139, 130, 0.16);
  --calendar-accepted-line: #81c995;
  --calendar-accepted-surface: rgba(129, 201, 149, 0.16);
  --calendar-accepted-ink: #81c995;
  --calendar-time-line: #f28b82;
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
.insight-actions,
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

.suggestion-icon {
  background: var(--calendar-mint);
  color: var(--calendar-mint-strong);
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

.primary-small-button,
.secondary-small-button {
  min-height: 34px;
  margin-top: 16px;
  padding: 0 16px;
  border-radius: 999px;
  cursor: pointer;
  font-family: var(--font-stack);
  font-size: 13px;
  font-weight: 600;
}

.primary-small-button {
  border: 1px solid var(--calendar-emphasis);
  background: var(--calendar-emphasis);
  color: var(--calendar-on-emphasis);
}

.secondary-small-button {
  border: 1px solid var(--calendar-line);
  background: transparent;
  color: var(--calendar-muted);
}

.insight-actions {
  gap: 14px;
}

.primary-small-button:hover,
.primary-small-button:focus-visible,
.secondary-small-button:hover,
.secondary-small-button:focus-visible {
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
}

.calendar-event {
  border: 1px solid var(--calendar-event-line);
  border-radius: 10px;
  background: var(--calendar-event-surface);
  color: var(--calendar-ink);
  overflow: hidden;
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
  top: calc(3.5 * 96px);
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

.week-current-time {
  top: calc(3.5 * 72px);
  left: calc(4 * (100% / 7));
  width: calc(100% / 7);
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
  min-height: 28px;
  padding: 5px 8px;
  border: 1px solid var(--calendar-event-line);
  border-radius: 8px;
  background: var(--calendar-event-surface);
  color: var(--calendar-event-ink);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  border-radius: 20px;
  background: var(--calendar-surface);
  box-shadow: var(--calendar-dialog-shadow);
}

.new-event-dialog-header {
  gap: 16px;
}

.new-event-dialog-icon {
  width: 44px;
  height: 44px;
  border-radius: 13px;
  background: var(--calendar-mint);
  color: var(--calendar-mint-strong);
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  font-size: 22px;
}

.new-event-dialog-header h2 {
  margin: 0;
  color: var(--calendar-ink);
  font-size: 22px;
  font-weight: 600;
  line-height: 1.15;
}

.new-event-dialog-header p {
  margin: 8px 0 0;
  color: var(--calendar-muted);
  font-size: 14px;
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

.new-event-request-wrap {
  margin-top: 28px;
}

.new-event-dialog-actions {
  margin-top: 24px;
  justify-content: flex-end;
  gap: 12px;
}

.new-event-cancel,
.new-event-create {
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
  min-width: 190px;
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

  .new-event-dialog-icon {
    width: 54px;
    height: 54px;
    border-radius: 16px;
    font-size: 26px;
  }

  .new-event-dialog-header {
    gap: 14px;
  }

  .new-event-dialog-header h2 {
    font-size: 26px;
  }

  .new-event-dialog-header p {
    font-size: 16px;
  }

  .new-event-dialog-actions {
    margin-top: 28px;
    align-items: stretch;
    flex-direction: column-reverse;
    gap: 10px;
  }

  .new-event-cancel,
  .new-event-create {
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
