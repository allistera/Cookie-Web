<script setup>
import { CALENDAR_EVENTS } from '@/data/sample.js'

const hours = ['9 AM', '10 AM', '11 AM', '12 PM', '1 PM', '2 PM', '3 PM', '4 PM']
const today = 'Thursday, June 12'
</script>

<template>
  <div class="cal">
    <div class="feed__head">
      <div class="feed__eyebrow cookie-eyebrow">Calendar · {{ today }}</div>
      <h1 class="feed__title">Your day, already arranged</h1>
      <p class="feed__sub">Cookie books around your availability. The green block is one it scheduled for you.</p>
    </div>

    <div class="cal__grid">
      <div v-for="(h, i) in hours" :key="h" class="cal__hour" :style="{ top: `${i * 64 + 8}px` }">
        <span>{{ h }}</span>
      </div>
      <div
        v-for="event in CALENDAR_EVENTS"
        :key="event.id"
        :class="`evt evt--${event.tone}`"
        :style="{ top: `${event.top}px`, height: `${event.height}px` }"
      >
        <div class="et">{{ event.title }}</div>
        <div class="em">{{ event.time }} · {{ event.dur }} min{{ event.tone === 'auto' ? ' · by Cookie' : '' }}</div>
      </div>
    </div>
  </div>
</template>
