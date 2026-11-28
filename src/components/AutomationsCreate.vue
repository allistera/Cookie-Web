<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import {
  AUTOMATION_JOBS,
  SCHEDULE_DAYS,
  automationJob,
  localTimeZone,
  scheduleLabel,
  scheduleTrigger,
} from '../lib/automationJobs'
import { automationRoute, automationSection } from '../lib/automations'
import { useAutomationsStore } from '../stores/automations'

// Create Automation: pick one of the automations Cookie can run, say when,
// and switch it on. A Templates card arrives with its job in ?job=.
const route = useRoute()
const router = useRouter()
const store = useAutomationsStore()

const handler = ref((automationJob(route.query.job) ?? AUTOMATION_JOBS[0]).handler)
const job = computed(() => automationJob(handler.value))

const time = ref(job.value.defaultTime)
const days = ref(SCHEDULE_DAYS.map((day) => day.id))
// Picking another automation starts from that one's usual time.
watch(handler, () => {
  time.value = job.value.defaultTime
})

const timeZone = localTimeZone()
const trigger = computed(() => scheduleTrigger({ time: time.value, days: days.value, timeZone }))
const isComplete = computed(() => Boolean(time.value) && days.value.length > 0)

const isSaving = ref(false)
async function create() {
  if (!isComplete.value || isSaving.value) return
  isSaving.value = true
  const automation = await store.create({ handler: handler.value, trigger: trigger.value })
  isSaving.value = false
  if (automation) router.push(automationRoute(automationSection('dashboard')))
}
</script>

<template>
  <form class="create-page" data-testid="automations-create" @submit.prevent="create">
    <header class="create-header">
      <h1>Create Automation</h1>
      <p>Choose what Cookie should do for you and when.</p>
    </header>

    <fieldset class="create-group">
      <legend>What to automate</legend>
      <label
        v-for="option in AUTOMATION_JOBS"
        :key="option.handler"
        class="create-job"
        :class="{ 'is-selected': option.handler === handler }"
      >
        <input v-model="handler" type="radio" name="automation-job" :value="option.handler" />
        <span class="create-job-icon">
          <span class="material-symbols-outlined" aria-hidden="true">{{ option.icon }}</span>
        </span>
        <span class="create-job-text">
          <span class="create-job-title">{{ option.title }}</span>
          <span class="create-job-description">{{ option.description }}</span>
        </span>
      </label>
      <p class="create-note">
        This is the one automation that can be set up so far. The other ideas in Templates are not
        available yet.
      </p>
    </fieldset>

    <fieldset class="create-group">
      <legend>When to run it</legend>
      <label class="create-time">
        <span>Time</span>
        <input v-model="time" type="time" required />
      </label>
      <div class="create-days" role="group" aria-label="Days">
        <label
          v-for="day in SCHEDULE_DAYS"
          :key="day.id"
          class="create-day"
          :class="{ 'is-selected': days.includes(day.id) }"
        >
          <input v-model="days" type="checkbox" :value="day.id" />
          {{ day.label }}
        </label>
      </div>
      <p class="create-summary" role="status">
        <template v-if="isComplete">{{ scheduleLabel(trigger) }}, {{ timeZone }} time.</template>
        <template v-else>Choose a time and at least one day.</template>
      </p>
    </fieldset>

    <div class="create-actions">
      <button type="submit" class="btn btn-primary" :disabled="!isComplete || isSaving">
        {{ isSaving ? 'Creating...' : 'Create automation' }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.create-page {
  width: 100%;
  max-width: 760px;
  margin: 0 auto;
  padding: 32px 24px 48px;
}

.create-header h1 {
  margin: 0 0 8px;
  font-size: 22px;
  font-weight: 700;
}

.create-header p {
  margin: 0 0 28px;
  color: var(--text-secondary);
  font-size: 15px;
}

.create-group {
  margin: 0 0 28px;
  padding: 0;
  border: 0;
}

.create-group legend {
  margin-bottom: 12px;
  padding: 0;
  font-size: 15px;
  font-weight: 600;
}

.create-job {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 16px;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background-color: var(--bg-card);
  cursor: pointer;
}

.create-job.is-selected {
  border-color: var(--accent);
}

.create-job input {
  margin-top: 12px;
}

.create-job-icon {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background-color: var(--bg-input);
}

.create-job-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.create-job-title {
  font-size: 15px;
  font-weight: 600;
}

.create-job-description,
.create-note,
.create-summary {
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.5;
}

.create-note {
  margin: 10px 0 0;
}

.create-time {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  font-size: 14px;
}

.create-time input {
  padding: 8px 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background-color: var(--bg-input);
  color: var(--text-primary);
  font: inherit;
}

.create-days {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}

.create-day {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  font-size: 13px;
  cursor: pointer;
}

.create-day.is-selected {
  border-color: var(--accent);
  background-color: var(--accent-soft);
}

.create-summary {
  margin: 14px 0 0;
}

.create-actions {
  display: flex;
  justify-content: flex-end;
}

@media (max-width: 760px) {
  .create-page {
    padding: 20px 16px 32px;
  }
}
</style>
