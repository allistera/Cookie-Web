<script setup>
import { RouterLink } from 'vue-router'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useInboxStore } from '../stores/inbox'
import {
  calendarEventsUrl,
  calendarSession,
  isCalendarSessionCurrent,
} from '../composables/useCalendars'

const store = useInboxStore()
const now = ref(new Date())
const events = ref([])
const dateKey = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
let request = 0
let disposed = false
let timer
let lastRefresh = 0

const nextEvent = computed(() => {
  const today = dateKey(now.value)
  return events.value
    .filter(
      (event) =>
        event.date === today &&
        !event.allDay &&
        !(String(event.start).startsWith('00:00') && Number(event.duration) >= 1440),
    )
    .map((event) => ({ ...event, startsAt: new Date(`${event.date}T${event.start}`) }))
    .filter((event) => event.startsAt > now.value)
    .sort((a, b) => a.startsAt - b.startsAt)[0]
})
const countdown = computed(() => {
  if (!nextEvent.value) return ''
  const minutes = Math.ceil((nextEvent.value.startsAt - now.value) / 60_000)
  return minutes < 60
    ? `in ${minutes} min`
    : `in ${Math.floor(minutes / 60)} hr${minutes % 60 ? ` ${minutes % 60} min` : ''}`
})
const eventLabel = computed(() =>
  nextEvent.value
    ? `Next event: ${nextEvent.value.title}, ${nextEvent.value.start.slice(0, 5)}, ${countdown.value}`
    : '',
)

async function refresh() {
  now.value = new Date()
  const today = dateKey(now.value)
  const seq = ++request
  const session = calendarSession()
  lastRefresh = now.value.getTime()
  try {
    const headers = await store.authHeaders()
    if (disposed || seq !== request || !isCalendarSessionCurrent(session)) return
    const response = await fetch(calendarEventsUrl(today, today), { headers })
    if (!response.ok) throw new Error('Calendar unavailable')
    const body = await response.json()
    if (disposed || seq !== request || !isCalendarSessionCurrent(session)) return
    events.value = Array.isArray(body.events) ? body.events : []
  } catch {
    // An optional inbox hint should disappear when unavailable, not interrupt mail.
    if (!disposed && seq === request && isCalendarSessionCurrent(session)) events.value = []
  }
}
function tick() {
  const previousDay = dateKey(now.value)
  now.value = new Date()
  if (document.visibilityState === 'hidden') return
  if (previousDay !== dateKey(now.value) || now.value.getTime() - lastRefresh >= 300_000)
    void refresh()
}
function onVisibilityChange() {
  if (document.visibilityState === 'visible') void refresh()
}
onMounted(() => {
  void refresh()
  timer = setInterval(tick, 15_000)
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
  <RouterLink
    v-if="nextEvent"
    :to="{ name: 'calendar', query: { date: nextEvent.date, event: nextEvent.id } }"
    class="next-calendar-event"
    :aria-label="eventLabel"
    :title="eventLabel"
  >
    <span class="material-symbols-outlined next-calendar-icon" aria-hidden="true"
      >calendar_month</span
    >
    <time class="next-calendar-time" :datetime="`${nextEvent.date}T${nextEvent.start}`">{{
      nextEvent.start.slice(0, 5)
    }}</time>
    <span class="next-calendar-title">{{ nextEvent.title }}</span>
    <span class="next-calendar-countdown">· {{ countdown }}</span>
  </RouterLink>
</template>

<style scoped>
.next-calendar-event {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 1 auto;
  min-width: 0;
  max-width: min(360px, 100%);
  overflow: hidden;
  margin-left: auto;
  padding: 9px 13px;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  color: var(--text-primary);
  font-size: 14px;
  line-height: 18px;
  white-space: nowrap;
  text-decoration: none;
}
.next-calendar-event:hover {
  background: var(--accent-soft);
}
.next-calendar-event:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}
.next-calendar-icon {
  color: var(--text-blue);
  font-size: 17px;
}
.next-calendar-icon,
.next-calendar-time,
.next-calendar-countdown {
  flex-shrink: 0;
}
.next-calendar-time {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.next-calendar-title {
  overflow: hidden;
  text-overflow: ellipsis;
}
.next-calendar-countdown {
  color: var(--text-secondary);
}
</style>
