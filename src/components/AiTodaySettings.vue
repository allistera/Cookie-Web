<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useInboxStore } from '../stores/inbox'
import {
  cloneEnrichmentSettings,
  enrichmentDayOptions,
  enrichmentIntervalOptions,
  enrichmentModelOptions,
} from '../lib/enrichmentSettings'

const store = useInboxStore()
const draft = reactive(cloneEnrichmentSettings(store.enrichmentSettings))
const loading = ref(false)
const saving = ref(false)
const error = ref('')

watch(
  () => store.enrichmentSettings,
  (saved) => Object.assign(draft, cloneEnrichmentSettings(saved)),
)

const dirty = computed(() => JSON.stringify(draft) !== JSON.stringify(store.enrichmentSettings))
const valid = computed(
  () =>
    draft.schedule.days.length > 0 &&
    Number(draft.schedule.startHour) <= Number(draft.schedule.endHour),
)
const selectedModel = computed(() =>
  enrichmentModelOptions.find(({ value }) => value === draft.model),
)
const hours = Array.from({ length: 24 }, (_, hour) => hour)
const hourLabel = (hour) => `${String(hour).padStart(2, '0')}:00`

async function load() {
  loading.value = true
  error.value = ''
  try {
    await store.loadEnrichmentSettings()
  } catch {
    error.value = 'Could not load AI Today settings. Please retry.'
  } finally {
    loading.value = false
  }
}

async function save() {
  if (!valid.value) {
    error.value = draft.schedule.days.length
      ? 'The end time must be the same as or later than the start time.'
      : 'Choose at least one day.'
    return
  }
  saving.value = true
  error.value = ''
  try {
    await store.saveEnrichmentSettings(cloneEnrichmentSettings(draft))
    store.notify('AI Today settings saved.')
  } catch {
    error.value = 'Could not save. Your changes have not been applied. Please try again.'
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <section class="settings-section" data-testid="ai-today-settings-section">
    <h3 class="settings-section-title">AI Today</h3>
    <p class="settings-section-hint">
      Choose the model and when Cookie rebuilds your email analysis, inbox triage and news. Schedule
      times use Europe/London and automatically follow BST and GMT.
    </p>

    <form class="ai-today-settings" @submit.prevent="save">
      <fieldset :disabled="loading || saving || !store.enrichmentSettingsLoaded">
        <label class="ai-today-field">
          <span>Model</span>
          <select v-model="draft.model" aria-label="AI Today model">
            <option
              v-for="option in enrichmentModelOptions"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
          <small>{{ selectedModel?.hint }}</small>
        </label>

        <label class="ai-today-enabled">
          <span>
            <strong>Run automatically</strong>
            <small>Cloudflare checks hourly and only runs AI in a selected slot.</small>
          </span>
          <input v-model="draft.schedule.enabled" type="checkbox" aria-label="Run automatically" />
        </label>

        <div class="ai-today-schedule" :class="{ disabled: !draft.schedule.enabled }">
          <fieldset :disabled="!draft.schedule.enabled" class="ai-today-days">
            <legend>Days</legend>
            <label v-for="day in enrichmentDayOptions" :key="day.value">
              <input v-model="draft.schedule.days" type="checkbox" :value="day.value" />
              <span>{{ day.label }}</span>
            </label>
          </fieldset>

          <div class="ai-today-time-grid">
            <label>
              <span>Start</span>
              <select
                v-model.number="draft.schedule.startHour"
                aria-label="Schedule start time"
                :disabled="!draft.schedule.enabled"
              >
                <option v-for="hour in hours" :key="hour" :value="hour">
                  {{ hourLabel(hour) }}
                </option>
              </select>
            </label>
            <label>
              <span>End</span>
              <select
                v-model.number="draft.schedule.endHour"
                aria-label="Schedule end time"
                :disabled="!draft.schedule.enabled"
              >
                <option v-for="hour in hours" :key="hour" :value="hour">
                  {{ hourLabel(hour) }}
                </option>
              </select>
            </label>
            <label>
              <span>Repeat</span>
              <select
                v-model.number="draft.schedule.intervalHours"
                aria-label="Schedule interval"
                :disabled="!draft.schedule.enabled"
              >
                <option
                  v-for="interval in enrichmentIntervalOptions"
                  :key="interval"
                  :value="interval"
                >
                  Every {{ interval }} {{ interval === 1 ? 'hour' : 'hours' }}
                </option>
              </select>
            </label>
          </div>
        </div>
      </fieldset>

      <button
        class="btn btn-primary"
        type="submit"
        :disabled="loading || saving || !store.enrichmentSettingsLoaded || !dirty"
      >
        {{ saving ? 'Saving…' : 'Save' }}
      </button>
    </form>
    <p v-if="error" class="settings-error" role="alert">{{ error }}</p>
    <button
      v-if="error && !store.enrichmentSettingsLoaded"
      class="btn btn-secondary"
      data-testid="retry-ai-today-settings"
      :disabled="loading"
      @click="load"
    >
      Retry
    </button>
  </section>
</template>

<style scoped>
.ai-today-settings > fieldset,
.ai-today-days {
  border: 0;
  padding: 0;
  margin: 0;
}
.ai-today-settings > fieldset {
  display: grid;
  gap: 24px;
  margin: 22px 0;
}
.ai-today-field,
.ai-today-time-grid label {
  display: grid;
  gap: 7px;
}
.ai-today-field select,
.ai-today-time-grid select {
  max-width: 340px;
  min-height: 40px;
  padding: 8px 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  color: var(--text-primary);
  background: var(--bg-input);
}
.ai-today-field small,
.ai-today-enabled small {
  color: var(--text-secondary);
}
.ai-today-enabled {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.ai-today-enabled span {
  display: grid;
  gap: 4px;
}
.ai-today-schedule {
  display: grid;
  gap: 22px;
}
.ai-today-schedule.disabled {
  opacity: 0.55;
}
.ai-today-days {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.ai-today-days legend {
  width: 100%;
  margin-bottom: 8px;
}
.ai-today-days label {
  display: grid;
  cursor: pointer;
}
.ai-today-days input {
  position: absolute;
  opacity: 0;
}
.ai-today-days span {
  min-width: 44px;
  padding: 8px 10px;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  text-align: center;
}
.ai-today-days input:checked + span {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-soft);
}
.ai-today-days input:focus-visible + span {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.ai-today-time-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}
@media (max-width: 640px) {
  .ai-today-time-grid {
    grid-template-columns: 1fr;
  }
}
</style>
