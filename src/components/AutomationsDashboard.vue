<script setup>
import { computed } from 'vue'

import { useAuth } from '../composables/useAuth'
import { chatGptUrl } from '../lib/askChatGpt'
import { greetingNameOf } from '../lib/greetingName'

// The Automations home: a greeting, one way to start, and what the
// automations did. Nothing runs yet, so the activity list is always the
// "no runs" state.
const { user } = useAuth()

const now = new Date()
const today = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
}).format(now)

function partOfDay(hour) {
  if (hour < 12) return 'morning'
  return hour < 18 ? 'afternoon' : 'evening'
}

const greeting = computed(() => {
  const name = greetingNameOf(user.value)
  return `Good ${partOfDay(now.getHours())}${name ? `, ${name}` : ''}.`
})

// What the card suggests asking, and what ChatGPT's box opens holding.
const EXAMPLE = 'Every Friday, add a task to review what I completed this week'
const chatGptLink = chatGptUrl(EXAMPLE)
</script>

<template>
  <div class="dashboard-page" data-testid="automations-dashboard">
    <header class="dashboard-header">
      <p class="dashboard-date">{{ today }}</p>
      <h1>{{ greeting }}</h1>
      <p class="dashboard-lead">
        Once your automations start running, you will see what they did here.
      </p>
    </header>

    <a class="dashboard-start" :href="chatGptLink" target="_blank" rel="noopener noreferrer">
      <span class="dashboard-start-icon">
        <span class="material-symbols-outlined" aria-hidden="true">smart_toy</span>
      </span>
      <span class="dashboard-start-text">
        <span class="dashboard-start-title">Ask ChatGPT for your first automation</span>
        <span class="dashboard-start-example">“{{ EXAMPLE }}”</span>
      </span>
      <span class="dashboard-start-open">
        Open ChatGPT
        <span class="material-symbols-outlined" aria-hidden="true">open_in_new</span>
      </span>
    </a>

    <section class="dashboard-activity" aria-labelledby="dashboard-activity-title">
      <h2 id="dashboard-activity-title"><span>Recent activity</span></h2>
      <div class="dashboard-empty">
        <!-- The shape of the list to come, behind the message. -->
        <div class="dashboard-ghost" aria-hidden="true">
          <div v-for="row in 2" :key="row" class="dashboard-ghost-row">
            <span class="dashboard-ghost-dot"></span>
            <span class="dashboard-ghost-lines">
              <span></span>
              <span></span>
              <span></span>
            </span>
            <span class="dashboard-ghost-time"></span>
          </div>
        </div>
        <p role="status">No automation runs yet.</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.dashboard-page {
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
  padding: 32px 32px 48px;
}

.dashboard-date {
  margin: 0 0 12px;
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 500;
}

.dashboard-header h1 {
  margin: 0 0 10px;
  font-size: 34px;
  font-weight: 700;
  line-height: 1.2;
}

.dashboard-lead {
  margin: 0 0 32px;
  color: var(--text-secondary);
  font-size: 17px;
}

.dashboard-start {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 24px 16px 20px;
  border: 1px solid var(--border-color);
  border-radius: 14px;
  background-color: var(--bg-card);
  color: var(--text-primary);
  text-decoration: none;
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast);
}

.dashboard-start:hover,
.dashboard-start:focus-visible {
  border-color: var(--accent);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.dashboard-start-icon {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border: 1px solid var(--border-color);
  border-radius: 50%;
}

.dashboard-start-icon .material-symbols-outlined {
  font-size: 26px;
}

.dashboard-start-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.dashboard-start-title {
  font-size: 15px;
  font-weight: 600;
}

.dashboard-start-example {
  color: var(--text-secondary);
  font-size: 13px;
}

.dashboard-start-open {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
}

.dashboard-start-open .material-symbols-outlined {
  font-size: 18px;
  color: var(--text-secondary);
}

.dashboard-activity {
  margin-top: 36px;
}

/* The heading with a rule running from it to the right edge. */
.dashboard-activity h2 {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 0 0 28px;
  color: var(--accent);
  font-size: 15px;
  font-weight: 600;
}

.dashboard-activity h2::after {
  content: '';
  flex: 1;
  height: 1px;
  background-color: var(--accent-soft);
}

.dashboard-empty {
  position: relative;
}

.dashboard-empty p {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  color: var(--text-secondary);
  font-size: 15px;
  font-weight: 500;
}

.dashboard-ghost {
  display: flex;
  flex-direction: column;
  gap: 36px;
  opacity: 0.6;
}

.dashboard-ghost-row {
  display: flex;
  align-items: flex-start;
  gap: 32px;
}

.dashboard-ghost-dot {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background-color: var(--bg-input);
}

.dashboard-ghost-lines {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.dashboard-ghost-lines span,
.dashboard-ghost-time {
  height: 10px;
  border-radius: 5px;
  background-color: var(--bg-input);
}

.dashboard-ghost-lines span:nth-child(1) {
  width: 62%;
}

.dashboard-ghost-lines span:nth-child(2) {
  width: 52%;
}

.dashboard-ghost-lines span:nth-child(3) {
  width: 12%;
}

.dashboard-ghost-time {
  flex-shrink: 0;
  width: 70px;
  margin-top: 4px;
}

@media (max-width: 760px) {
  .dashboard-page {
    padding: 20px 16px 32px;
  }

  .dashboard-header h1 {
    font-size: 26px;
  }

  .dashboard-start {
    flex-wrap: wrap;
  }
}
</style>
