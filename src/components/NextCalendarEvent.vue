<script setup>
import { RouterLink } from 'vue-router'
import { computed } from 'vue'
import { useTodayCalendarEvents } from '../composables/useTodayCalendarEvents'

// Today's events (and the clock the countdown reads) are shared with AI
// Today's "Today's Events" card through one polled fetch.
const { now, todayEvents } = useTodayCalendarEvents()

const nextEvent = computed(
  () =>
    todayEvents.value
      .filter((event) => !event.allDay)
      .map((event) => ({ ...event, startsAt: new Date(`${event.date}T${event.start}`) }))
      .filter((event) => event.startsAt > now.value)
      .sort((a, b) => a.startsAt - b.startsAt)[0],
)
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
