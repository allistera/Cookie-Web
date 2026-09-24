<script setup>
import { computed, nextTick, onUnmounted, ref, useId, watch } from 'vue'
import { useInboxStore } from '../stores/inbox'
import { useCalendars } from '../composables/useCalendars'
import { CALENDAR_API_URL } from '../lib/apiWorkers'
import {
  availabilityDate,
  availabilityProposal,
  formatAvailabilitySlot,
  suggestAvailability,
  validAvailabilityZone,
} from '../lib/availability'

const emit = defineEmits(['insert', 'previewState'])
const store = useInboxStore()
const { calendars, loadCalendars } = useCalendars(
  (init) => store.authHeaders(init),
  (message, kind) => store.notify(message, kind),
)
const dialog = ref(null)
const formId = useId()
const trigger = ref(null)
const open = ref(false)
const loading = ref(false)
const calendarLoading = ref(false)
const calendarsReady = ref(false)
const error = ref('')
const selected = ref([])
const selectedSlots = ref([])
const result = ref(null)
const reviewText = ref('')
const reviewing = ref(false)
const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
const timeZone = ref(browserZone)
const interpretationTimeZone = ref(browserZone)
const confirmed = ref(false)
const from = ref(availabilityDate(Date.now() + 86_400_000, browserZone))
const to = ref(availabilityDate(Date.now() + 7 * 86_400_000, browserZone))
const duration = ref(30)
const workStart = ref('09:00')
const workEnd = ref('17:00')
let generation = 0
let abortController = null
const zones = [...new Set([browserZone, 'UTC', ...(Intl.supportedValuesOf?.('timeZone') || [])])]
const options = computed(() => ({
  timeZone: timeZone.value,
  duration: Number(duration.value),
  workStart: workStart.value,
  workEnd: workEnd.value,
}))
const slots = computed(() => suggestAvailability(result.value, options.value))
const canCheck = computed(
  () =>
    calendarsReady.value &&
    selected.value.length > 0 &&
    selected.value.length <= 10 &&
    confirmed.value &&
    from.value &&
    to.value &&
    from.value <= to.value &&
    new Date(to.value) - new Date(from.value) < 31 * 86_400_000 &&
    validAvailabilityZone(timeZone.value) &&
    validAvailabilityZone(interpretationTimeZone.value) &&
    workStart.value < workEnd.value,
)
const canInsert = computed(
  () => reviewing.value && result.value?.complete && reviewText.value.trim() && !loading.value,
)

function invalidate() {
  generation += 1
  abortController?.abort()
  loading.value = false
  result.value = null
  selectedSlots.value = []
  reviewing.value = false
  reviewText.value = ''
  error.value = ''
}

watch(
  [from, to, timeZone, interpretationTimeZone, duration, workStart, workEnd, selected, confirmed],
  invalidate,
  { deep: true, flush: 'sync' },
)
watch(interpretationTimeZone, () => {
  confirmed.value = false
})
watch(
  () => store.composeOwnerSub,
  () => close(),
  { flush: 'sync' },
)

async function show() {
  invalidate()
  open.value = true
  emit('previewState', true)
  await nextTick()
  dialog.value?.showModal()
  calendarLoading.value = true
  calendarsReady.value = false
  const owner = store.composeOwnerSub
  const ready = await loadCalendars({ force: true })
  if (!open.value || owner !== store.composeOwnerSub) return
  calendarLoading.value = false
  calendarsReady.value = ready
  selected.value = ready ? calendars.value.slice(0, 10).map((calendar) => calendar.id) : []
  if (!ready) error.value = 'Calendars could not be loaded. Close and try again.'
}

function close() {
  if (!open.value) return
  invalidate()
  dialog.value?.close()
  open.value = false
  emit('previewState', false)
  trigger.value?.focus()
}

async function check() {
  if (!canCheck.value || loading.value) return
  invalidate()
  const current = generation
  const owner = store.composeOwnerSub
  loading.value = true
  abortController = new AbortController()
  try {
    const headers = await store.authHeaders({ 'Content-Type': 'application/json' })
    if (current !== generation || owner !== store.composeOwnerSub) return
    const response = await fetch(`${CALENDAR_API_URL}/calendar-availability`, {
      method: 'POST',
      headers,
      signal: abortController.signal,
      body: JSON.stringify({
        calendarIds: selected.value,
        from: from.value,
        to: to.value,
        timeZone: timeZone.value,
        interpretationTimeZone: interpretationTimeZone.value,
        confirmFloatingTimes: confirmed.value,
      }),
    })
    const body = await response.json()
    if (current !== generation || owner !== store.composeOwnerSub || !open.value) return
    if (!response.ok) throw new Error(body.error || 'Availability could not be checked.')
    result.value = body
    if (!body.complete)
      error.value = body.error || 'Availability is incomplete. No times can be suggested.'
  } catch (failure) {
    if (current === generation)
      error.value = failure.message || 'Availability could not be checked.'
  } finally {
    if (current === generation) loading.value = false
  }
}

function review() {
  const chosen = slots.value.filter((slot) => selectedSlots.value.includes(slot.start))
  if (!chosen.length || chosen.length > 10) return
  reviewText.value = availabilityProposal(chosen, timeZone.value, duration.value)
  reviewing.value = true
  nextTick(() => dialog.value?.querySelector('textarea')?.focus())
}

function insert() {
  if (!canInsert.value) return
  const text = reviewText.value
  close()
  emit('insert', text)
}

function subscriptionStatus(calendar) {
  const checked = result.value?.sources?.find((source) => source.id === calendar.id)
  const timestamp = calendar.subscriptionSyncedAt
  const parsed = timestamp ? new Date(timestamp).getTime() : NaN
  const stale = !Number.isFinite(parsed) || Date.now() - parsed > 24 * 3_600_000
  const cached = Number.isFinite(parsed)
    ? `Last sync: ${new Date(parsed).toLocaleString()}`
    : 'Never synced'
  return `${cached}${stale ? ' (stale)' : ''}${calendar.subscriptionError ? ' · Last sync failed' : ''}${checked?.complete ? ' · Selected range freshly checked' : checked ? ' · Fresh check failed' : ' · Fresh check required'}`
}

onUnmounted(() => {
  abortController?.abort()
  generation += 1
  if (open.value) emit('previewState', false)
})
</script>

<template>
  <button ref="trigger" type="button" class="btn btn-secondary availability-trigger" @click="show">
    Share availability
  </button>
  <Teleport to="body">
    <dialog
      v-if="open"
      ref="dialog"
      class="availability-dialog"
      aria-label="Share availability"
      @cancel.prevent="close"
      @keydown.stop
    >
      <header class="availability-header">
        <h2>Share availability</h2>
        <button type="button" class="btn btn-secondary" @click="close">Cancel</button>
      </header>
      <p>Choose calendars and propose times. Nothing is reserved or booked.</p>
      <form v-if="!reviewing" @submit.prevent="check">
        <div class="availability-fields">
          <label>From date<input v-model="from" type="date" required /></label>
          <label>Through date<input v-model="to" type="date" required /></label>
          <div class="availability-field">
            <label :for="`${formId}-duration`">Meeting duration</label>
            <select :id="`${formId}-duration`" v-model="duration">
              <option v-for="minutes in [15, 30, 45, 60, 90, 120]" :key="minutes" :value="minutes">
                {{ minutes }} minutes
              </option>
            </select>
          </div>
          <div class="availability-field">
            <label :for="`${formId}-proposal-zone`">Proposal and working-hours timezone</label>
            <select :id="`${formId}-proposal-zone`" v-model="timeZone">
              <option v-for="zone in zones" :key="zone" :value="zone">{{ zone }}</option>
            </select>
          </div>
          <label
            >Working hours start<input v-model="workStart" type="time" step="900" required
          /></label>
          <label
            >Working hours end<input v-model="workEnd" type="time" step="900" required
          /></label>
        </div>
        <fieldset>
          <legend>Calendars to consider (choose 1–10)</legend>
          <p v-if="calendarLoading" role="status">Loading calendars…</p>
          <p v-else-if="calendarsReady && !calendars.length">
            No calendars available. Add one in Calendar settings.
          </p>
          <label v-for="calendar in calendars" :key="calendar.id" class="availability-calendar"
            ><input
              v-model="selected"
              type="checkbox"
              :value="calendar.id"
              :disabled="!calendarsReady"
            /><span
              >{{ calendar.name
              }}<small v-if="calendar.subscriptionUrl">{{
                subscriptionStatus(calendar)
              }}</small></span
            ></label
          >
        </fieldset>
        <div class="availability-zone">
          <label :for="`${formId}-interpretation-zone`">Calendar interpretation timezone</label>
          <select :id="`${formId}-interpretation-zone`" v-model="interpretationTimeZone">
            <option v-for="zone in zones" :key="zone" :value="zone">{{ zone }}</option>
          </select>
        </div>
        <p>
          Cookie events and all-day or floating feed times have no saved timezone. Interpret them in
          this zone. Subscribed events with a known timezone keep their source instant.
        </p>
        <label class="availability-calendar"
          ><input v-model="confirmed" type="checkbox" /><span
            >I confirm this timezone for Cookie events and floating or all-day times.</span
          ></label
        >
        <p class="availability-hint">
          Up to 31 days. All days in the range are considered. Missing or ambiguous daylight-saving
          times are excluded; incomplete calendars block suggestions.
        </p>
        <button
          type="submit"
          class="btn btn-primary"
          :disabled="!canCheck || loading"
          :aria-busy="loading"
        >
          {{ loading ? 'Checking calendars…' : 'Find available times' }}
        </button>
      </form>
      <p v-if="error" role="alert">{{ error }}</p>
      <section v-if="result?.complete && !reviewing" aria-label="Suggested times">
        <h3>Suggested times</h3>
        <p role="status">
          {{
            slots.length
              ? `Showing ${slots.length} suggestions. Choose up to 10.`
              : 'No available times match these working hours. Try another range.'
          }}
        </p>
        <div class="availability-slots">
          <label v-for="slot in slots" :key="slot.start" class="availability-calendar"
            ><input
              v-model="selectedSlots"
              type="checkbox"
              :value="slot.start"
              :disabled="selectedSlots.length >= 10 && !selectedSlots.includes(slot.start)"
            /><span>{{ formatAvailabilitySlot(slot, timeZone) }}</span></label
          >
        </div>
        <button
          type="button"
          class="btn btn-primary"
          :disabled="!selectedSlots.length"
          @click="review"
        >
          Review selected times
        </button>
      </section>
      <section v-if="reviewing">
        <h3>Review proposal</h3>
        <p>
          Availability was checked at {{ new Date(result.checkedAt).toLocaleTimeString() }}. It can
          change. Edit the text before inserting it into your draft.
        </p>
        <label>Proposal text<textarea v-model="reviewText" rows="12" maxlength="12000" /></label>
        <div class="availability-actions">
          <button type="button" class="btn btn-secondary" @click="reviewing = false">
            Back to times</button
          ><button type="button" class="btn btn-primary" :disabled="!canInsert" @click="insert">
            Insert proposed times
          </button>
        </div>
      </section>
    </dialog>
  </Teleport>
</template>

<style scoped>
.availability-trigger {
  font-size: 12px;
  margin: 8px 0;
}
.availability-dialog {
  width: min(680px, calc(100vw - 32px));
  max-height: calc(100dvh - 48px);
  box-sizing: border-box;
  overflow: auto;
  border: 1px solid var(--border-color, #ccc);
  border-radius: 12px;
  padding: 24px;
  background: var(--bg-primary, white);
  color: var(--text-primary, #222);
}
.availability-dialog::backdrop {
  background: rgb(0 0 0 / 40%);
}
.availability-header,
.availability-actions {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
}
.availability-header h2 {
  margin: 0;
  font-size: 20px;
}
.availability-dialog p {
  font-size: 13px;
  line-height: 1.5;
}
.availability-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.availability-fields > label,
.availability-field,
.availability-zone {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
}
.availability-dialog input:not([type='checkbox']),
.availability-dialog select,
.availability-dialog textarea {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  padding: 8px;
  border: 1px solid var(--border-color, #aaa);
  border-radius: 6px;
  color: inherit;
  background: inherit;
  font: inherit;
}
.availability-dialog fieldset {
  margin: 16px 0;
  border: 1px solid var(--border-color, #ccc);
  border-radius: 6px;
}
.availability-calendar {
  display: flex;
  align-items: start;
  gap: 8px;
  margin: 10px 0;
  font-size: 13px;
}
.availability-calendar input {
  flex-shrink: 0;
  margin-top: 2px;
}
.availability-calendar small {
  display: block;
  margin-top: 4px;
}
.availability-slots {
  max-height: 240px;
  overflow: auto;
  margin-bottom: 12px;
}
.availability-dialog textarea {
  display: block;
  margin: 8px 0 16px;
  resize: vertical;
  line-height: 1.5;
}
@media (max-width: 520px) {
  .availability-fields {
    grid-template-columns: 1fr;
  }
  .availability-dialog {
    padding: 16px;
  }
}
</style>
