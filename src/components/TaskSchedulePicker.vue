<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

import TaskRepeatInput from './TaskRepeatInput.vue'
import { localToday } from '../lib/localDate'
import { monthsFrom, parseDateInput, scheduleShortcuts, scheduleSummary } from '../lib/taskSchedule'

// The panel's whole schedule behind one chip: the date (typed, a quick
// choice, or a day on the calendar), the time with its zone, and the
// repeat rule. Shaped after Todoist's scheduler. Dates go out as
// YYYY-MM-DD or null for "no date", the way the wire carries them.
const props = defineProps({
  dueDate: { type: String, default: null },
  dueTime: { type: String, default: null },
  timeZone: { type: String, default: '' },
  recurrence: { type: String, default: null },
  savingRecurrence: { type: Boolean, default: false },
})
const emit = defineEmits(['update:dueDate', 'update:dueTime', 'saveRecurrence'])

const MONTHS_SHOWN = 12

const open = ref(false)
const today = ref(localToday())
const dateText = ref('')
const dateError = ref('')
const showTime = ref(false)
const showRepeat = ref(false)
const recurrenceDraft = ref('')
const monthIndex = ref(0)
const root = ref(null)
const button = ref(null)
const menu = ref(null)
const input = ref(null)
const calendar = ref(null)
const menuStyle = ref({})
// The text the date box opened with; submitted unchanged it keeps the
// task's own date rather than being read as the next such day.
let prefilledText = ''

const summary = computed(() => scheduleSummary(props, today.value))
const shortcuts = computed(() => scheduleShortcuts(today.value))

// The calendar starts at the earlier of this month and the due date's
// month, so a date already in the past is on screen, and runs to a year past
// this month or to the due date's month, whichever is later, so both today
// and the due date are always reachable.
function monthNumber(iso) {
  return Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1
}
const months = computed(() => {
  const due = props.dueDate || today.value
  const start = due < today.value ? due : today.value
  const end = Math.max(monthNumber(today.value) + MONTHS_SHOWN - 1, monthNumber(due))
  return monthsFrom(`${start.slice(0, 8)}01`, end - monthNumber(start) + 1)
})
const atFirstMonth = computed(() => monthIndex.value <= 0)
const atLastMonth = computed(() => monthIndex.value >= months.value.length - 1)

function isWeekend(iso) {
  const day = new Date(`${iso}T00:00:00`).getDay()
  return day === 0 || day === 6
}

watch(
  () => props.recurrence,
  (value) => {
    recurrenceDraft.value = value ?? ''
  },
  { immediate: true },
)

// The list drops out of the chip but the rail it sits in scrolls (and clips),
// so it is placed against the viewport from the chip's box when it opens.
function place() {
  const rect = button.value?.getBoundingClientRect()
  if (!rect) return
  const width = 320
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
  const top = rect.bottom + 6
  menuStyle.value = {
    top: `${top}px`,
    left: `${left}px`,
    width: `${width}px`,
    maxHeight: `${Math.max(240, window.innerHeight - top - 12)}px`,
  }
}

function monthIndexOf(iso) {
  const key = String(iso ?? '').slice(0, 7)
  return Math.max(
    0,
    months.value.findIndex(
      (month) => `${month.year}-${String(month.month).padStart(2, '0')}` === key,
    ),
  )
}

// A month's top within the calendar's own scrolled content; offsetTop is
// measured from the menu, so it would count the header above the calendar.
function offsetInCalendar(section) {
  const box = calendar.value
  return section.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop
}

function scrollToMonth(index) {
  const clamped = Math.max(0, Math.min(months.value.length - 1, index))
  monthIndex.value = clamped
  const section = calendar.value?.querySelectorAll('.task-schedule-month')[clamped]
  if (section && calendar.value) calendar.value.scrollTop = offsetInCalendar(section)
}

// Which month heads the visible part of the calendar after a scroll, so
// the arrows step from where the person is looking.
function onCalendarScroll() {
  const sections = [...(calendar.value?.querySelectorAll('.task-schedule-month') ?? [])]
  const top = calendar.value.scrollTop + 8
  let index = 0
  sections.forEach((section, at) => {
    if (offsetInCalendar(section) <= top) index = at
  })
  monthIndex.value = index
}

async function openPicker() {
  if (open.value) return
  today.value = localToday()
  dateText.value = props.dueDate ? formatInput(props.dueDate) : ''
  prefilledText = dateText.value
  dateError.value = ''
  showTime.value = false
  showRepeat.value = false
  open.value = true
  await nextTick()
  place()
  scrollToMonth(monthIndexOf(props.dueDate || today.value))
  input.value?.focus()
  input.value?.select?.()
  document.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('resize', place)
}

// "16 Oct" in the box, as the chip reads it without the weekday.
function formatInput(iso) {
  const date = new Date(`${iso}T00:00:00`)
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(date)
}

function close({ refocus = true } = {}) {
  if (!open.value) return
  open.value = false
  document.removeEventListener('pointerdown', onPointerDown, true)
  window.removeEventListener('resize', place)
  if (refocus) button.value?.focus()
}

function toggle() {
  if (open.value) close()
  else void openPicker()
}

// A press anywhere outside the chip and its list closes it; seen in the
// capture phase, before the panel stops the click from reaching the page.
function onPointerDown(event) {
  if (event.target instanceof Node && root.value?.contains(event.target)) return
  if (event.target instanceof Node && menu.value?.contains(event.target)) return
  close({ refocus: false })
}

function chooseDate(iso) {
  if (iso !== (props.dueDate ?? null)) emit('update:dueDate', iso)
  close()
}

function submitTyped() {
  if (props.dueDate && dateText.value.trim() === prefilledText) {
    chooseDate(props.dueDate)
    return
  }
  const parsed = parseDateInput(dateText.value, today.value)
  if (!parsed) {
    dateError.value = 'Could not read that date. Try "tomorrow", "24 Oct" or 2026-10-24.'
    return
  }
  chooseDate(parsed.iso)
}

function onInputKeydown(event) {
  if (event.key === 'Enter') {
    event.preventDefault()
    submitTyped()
  }
}

function onMenuKeydown(event) {
  if (event.key !== 'Escape') return
  // Escape with the list open is asking to leave the list, not the panel.
  event.stopPropagation()
  close()
}

function onTimeChange(event) {
  emit('update:dueTime', String(event.target.value ?? ''))
}

function saveRecurrence() {
  emit('saveRecurrence', recurrenceDraft.value)
}

async function toggleTime() {
  showTime.value = !showTime.value
  if (!showTime.value) return
  await nextTick()
  menu.value?.querySelector('.task-panel-time-input')?.focus()
}

async function toggleRepeat() {
  showRepeat.value = !showRepeat.value
  if (!showRepeat.value) return
  await nextTick()
  menu.value?.querySelector('.task-repeat input')?.focus()
}

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointerDown, true)
  window.removeEventListener('resize', place)
})

defineExpose({ open: openPicker })
</script>

<template>
  <div ref="root" class="task-schedule-picker">
    <button
      ref="button"
      type="button"
      class="task-panel-schedule"
      :class="{ set: dueDate }"
      :aria-label="`Schedule: ${summary}`"
      aria-haspopup="dialog"
      :aria-expanded="open ? 'true' : 'false'"
      @click="toggle"
    >
      <span class="material-symbols-outlined task-panel-schedule-icon" aria-hidden="true"
        >calendar_month</span
      >
      <span class="task-panel-schedule-text">{{ summary }}</span>
      <span
        v-if="recurrence"
        class="material-symbols-outlined task-panel-schedule-repeat"
        title="Repeats"
        aria-label="Repeats"
        >repeat</span
      >
      <slot />
    </button>
    <div
      v-if="open"
      ref="menu"
      class="task-schedule-menu"
      role="dialog"
      aria-label="Schedule"
      :style="menuStyle"
      @keydown="onMenuKeydown"
    >
      <div class="task-schedule-head">
        <input
          ref="input"
          v-model="dateText"
          type="text"
          class="task-panel-date-input"
          aria-label="Due date"
          placeholder="Type a date"
          autocomplete="off"
          @input="dateError = ''"
          @keydown="onInputKeydown"
        />
        <p v-if="dateError" class="task-schedule-error" role="alert">{{ dateError }}</p>
      </div>

      <div class="task-schedule-shortcuts">
        <button
          v-for="shortcut in shortcuts"
          :key="shortcut.id"
          type="button"
          class="task-schedule-shortcut"
          :data-shortcut="shortcut.id"
          @click="chooseDate(shortcut.iso)"
        >
          <span class="material-symbols-outlined" aria-hidden="true">{{ shortcut.icon }}</span>
          <span class="task-schedule-shortcut-label">{{ shortcut.label }}</span>
          <span class="task-schedule-shortcut-hint">{{ shortcut.hint }}</span>
        </button>
        <button
          type="button"
          class="task-schedule-shortcut task-schedule-nodate"
          @click="chooseDate(null)"
        >
          <span class="material-symbols-outlined" aria-hidden="true">block</span>
          <span class="task-schedule-shortcut-label">No date</span>
        </button>
      </div>

      <div class="task-schedule-calendar-head">
        <strong>{{ months[monthIndex]?.label }}</strong>
        <div class="task-schedule-nav">
          <button
            type="button"
            title="Previous month"
            aria-label="Previous month"
            :disabled="atFirstMonth"
            @click="scrollToMonth(monthIndex - 1)"
          >
            <span class="material-symbols-outlined" aria-hidden="true">keyboard_arrow_up</span>
          </button>
          <button
            type="button"
            title="This month"
            aria-label="This month"
            @click="scrollToMonth(monthIndexOf(today))"
          >
            <span class="material-symbols-outlined" aria-hidden="true">circle</span>
          </button>
          <button
            type="button"
            title="Next month"
            aria-label="Next month"
            :disabled="atLastMonth"
            @click="scrollToMonth(monthIndex + 1)"
          >
            <span class="material-symbols-outlined" aria-hidden="true">keyboard_arrow_down</span>
          </button>
        </div>
      </div>
      <div class="task-schedule-weekdays" aria-hidden="true">
        <span v-for="day in ['M', 'T', 'W', 'T', 'F', 'S', 'S']" :key="day">{{ day }}</span>
      </div>
      <div ref="calendar" class="task-schedule-calendar" @scroll.passive="onCalendarScroll">
        <section
          v-for="(month, index) in months"
          :key="month.label"
          class="task-schedule-month"
          :aria-label="month.label"
        >
          <h4 v-if="index > 0">{{ month.label }}</h4>
          <div v-for="(week, at) in month.weeks" :key="at" class="task-schedule-week">
            <template v-for="(iso, slot) in week" :key="slot">
              <button
                v-if="iso"
                type="button"
                class="task-schedule-day"
                :class="{
                  today: iso === today,
                  selected: iso === dueDate,
                  past: iso < today,
                  weekend: isWeekend(iso),
                }"
                :data-date="iso"
                :aria-label="iso"
                :aria-pressed="iso === dueDate ? 'true' : 'false'"
                @click="chooseDate(iso)"
              >
                {{ Number(iso.slice(8)) }}
              </button>
              <span v-else class="task-schedule-day task-schedule-blank" aria-hidden="true"></span>
            </template>
          </div>
        </section>
      </div>

      <div class="task-schedule-foot">
        <button
          type="button"
          class="task-schedule-toggle task-schedule-time-toggle"
          :class="{ set: dueTime }"
          :aria-expanded="showTime ? 'true' : 'false'"
          @click="toggleTime"
        >
          <span class="material-symbols-outlined" aria-hidden="true">schedule</span>
          {{ dueTime ? `Time · ${dueTime}` : 'Time' }}
        </button>
        <div v-if="showTime" class="task-schedule-field task-panel-time" :class="{ set: dueTime }">
          <input
            class="task-panel-time-input"
            type="time"
            aria-label="Due time"
            :value="dueTime ?? ''"
            :disabled="!dueDate"
            @change="onTimeChange"
          />
          <span v-if="dueTime" class="task-panel-time-zone">{{ timeZone }}</span>
          <span v-else-if="!dueDate" class="task-schedule-hint">Choose a date first.</span>
        </div>
        <button
          type="button"
          class="task-schedule-toggle task-schedule-repeat-toggle"
          :class="{ set: recurrence }"
          :aria-expanded="showRepeat ? 'true' : 'false'"
          @click="toggleRepeat"
        >
          <span class="material-symbols-outlined" aria-hidden="true">repeat</span>
          {{ recurrence ? `Repeat · ${recurrence}` : 'Repeat' }}
        </button>
        <form
          v-if="showRepeat"
          class="task-schedule-field task-panel-repeat"
          @submit.prevent="saveRecurrence"
        >
          <TaskRepeatInput v-model="recurrenceDraft" :disabled="savingRecurrence" />
          <button class="task-panel-repeat-save" type="submit" :disabled="savingRecurrence">
            Save repeat
          </button>
        </form>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* The chip: the date as a wide button, tinted once a date is set. */
.task-panel-schedule {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 12px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: var(--bg-hover);
  font: inherit;
  font-size: 15px;
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
}

.task-panel-schedule:hover,
.task-panel-schedule[aria-expanded='true'] {
  border-color: var(--border-color);
}

.task-panel-schedule:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.task-panel-schedule.set {
  background: rgba(209, 69, 59, 0.08);
}

.task-panel-schedule .material-symbols-outlined {
  font-size: 20px;
  color: var(--text-secondary);
}

.task-panel-schedule.set .task-panel-schedule-icon {
  color: var(--text-green);
}

.task-panel-schedule-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* The list is placed against the viewport (see place()), so it escapes the
   rail's scroll box. The panel is above the page, so z-index 1 clears it. */
.task-schedule-menu {
  position: fixed;
  z-index: 1;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  background: var(--bg-dialog);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.task-schedule-head {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color);
}

.task-panel-date-input {
  width: 100%;
  box-sizing: border-box;
  padding: 2px 0;
  border: none;
  background: transparent;
  font: inherit;
  font-size: 17px;
  color: var(--text-primary);
}

.task-panel-date-input:focus {
  outline: none;
}

.task-panel-date-input::placeholder {
  color: var(--text-secondary);
}

.task-schedule-error {
  margin: 6px 0 0;
  font-size: 12px;
  color: #d1453b;
}

.task-schedule-shortcuts {
  display: flex;
  flex-direction: column;
  padding: 6px 0;
  border-bottom: 1px solid var(--border-color);
}

.task-schedule-shortcut {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  border: none;
  background: none;
  font: inherit;
  font-size: 15px;
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
}

.task-schedule-shortcut:hover,
.task-schedule-shortcut:focus-visible {
  background: var(--bg-hover);
}

.task-schedule-shortcut .material-symbols-outlined {
  font-size: 22px;
  color: var(--accent);
}

.task-schedule-shortcut[data-shortcut='tomorrow'] .material-symbols-outlined {
  color: #e8a33d;
}

.task-schedule-shortcut[data-shortcut='next-weekend'] .material-symbols-outlined {
  color: #246fe0;
}

.task-schedule-nodate .material-symbols-outlined {
  color: var(--text-secondary);
}

.task-schedule-shortcut-label {
  flex: 1;
}

.task-schedule-shortcut-hint {
  color: var(--text-secondary);
}

.task-schedule-calendar-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px 4px;
  font-size: 15px;
}

.task-schedule-nav {
  display: flex;
  gap: 2px;
}

.task-schedule-nav button {
  display: flex;
  padding: 2px;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--text-secondary);
  cursor: pointer;
}

.task-schedule-nav button:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.task-schedule-nav button:disabled {
  opacity: 0.4;
  cursor: default;
}

.task-schedule-nav .material-symbols-outlined {
  font-size: 18px;
}

.task-schedule-weekdays,
.task-schedule-week {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  padding: 0 12px;
}

.task-schedule-weekdays {
  padding-bottom: 4px;
  font-size: 12px;
  color: var(--text-secondary);
  text-align: center;
}

.task-schedule-calendar {
  flex: 1;
  min-height: 0;
  max-height: 232px;
  overflow-y: auto;
  padding-bottom: 8px;
}

.task-schedule-month h4 {
  margin: 10px 16px 6px;
  padding-top: 8px;
  border-top: 1px solid var(--border-color);
  font-size: 15px;
}

.task-schedule-day {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 34px;
  margin: 1px auto;
  width: 34px;
  border: none;
  border-radius: 50%;
  background: none;
  font: inherit;
  font-size: 15px;
  color: var(--text-primary);
  cursor: pointer;
  position: relative;
}

.task-schedule-day:hover,
.task-schedule-day:focus-visible {
  background: var(--bg-hover);
}

.task-schedule-day.past,
.task-schedule-day.weekend {
  color: var(--text-secondary);
}

.task-schedule-day.today::after {
  content: '';
  position: absolute;
  bottom: 3px;
  left: 50%;
  width: 4px;
  height: 4px;
  margin-left: -2px;
  border-radius: 50%;
  background: #d1453b;
}

.task-schedule-day.selected,
.task-schedule-day.selected:hover {
  background: #d1453b;
  color: white;
  font-weight: 700;
}

.task-schedule-day.selected.today::after {
  background: white;
}

.task-schedule-blank {
  cursor: default;
}

.task-schedule-foot {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 16px 16px;
  border-top: 1px solid var(--border-color);
}

.task-schedule-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
  font: inherit;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-secondary);
  cursor: pointer;
}

.task-schedule-toggle:hover,
.task-schedule-toggle[aria-expanded='true'] {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.task-schedule-toggle.set {
  color: var(--text-primary);
}

.task-schedule-toggle .material-symbols-outlined {
  font-size: 20px;
}

.task-schedule-field {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 0 4px 4px;
}

.task-panel-time-input {
  min-width: 0;
  padding: 4px 6px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: transparent;
  font: inherit;
  font-size: 15px;
  color: var(--text-primary);
}

.task-panel-time-input:disabled {
  opacity: 0.55;
}

.task-panel-time-zone,
.task-schedule-hint {
  color: var(--text-secondary);
  font-size: 12px;
}

.task-panel-repeat {
  flex-direction: column;
  align-items: stretch;
}

.task-panel-repeat-save {
  align-self: flex-start;
  padding: 6px 10px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-primary);
  font: inherit;
  font-size: 13px;
  color: var(--text-primary);
  cursor: pointer;
}

.task-panel-repeat-save:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
