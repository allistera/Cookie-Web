<script setup>
import { computed, nextTick, onMounted, ref } from 'vue'
import { useInboxStore } from '../stores/inbox'
import { CALENDARS_ENDPOINT, useCalendars } from '../composables/useCalendars'

const store = useInboxStore()
const {
  calendars,
  writableCalendars,
  subscribedCalendars,
  loadCalendars: fetchCalendars,
} = useCalendars(
  (init) => store.authHeaders(init),
  (message, kind) => store.notify(message, kind),
)

const NEW_CALENDAR_PALETTE = [
  '#3b82f6',
  '#e5484d',
  '#f2a900',
  '#8b5cf6',
  '#06b6d4',
  '#f97316',
  '#84cc16',
  '#ec4899',
]

const isLoading = ref(true)
const createMode = ref(null)
const newCalendarName = ref('')
const newCalendarSubscriptionUrl = ref('')
const newCalendarInput = ref(null)
const editingCalendarId = ref(null)
const editingCalendarName = ref('')
const editingCalendarInput = ref(null)
const confirmingDeleteId = ref(null)
const operationError = ref('')
const errorCalendarId = ref(null)
const syncingCalendarId = ref(null)

const calendarGroups = computed(() => [
  {
    id: 'your-calendars-heading',
    mode: 'calendar',
    title: 'Your calendars',
    description: 'Calendars you can add and move events to.',
    action: 'Add calendar',
    empty: 'No calendars yet.',
    calendars: writableCalendars.value,
  },
  {
    id: 'subscriptions-heading',
    mode: 'subscription',
    title: 'Subscriptions',
    description: 'Read-only calendars that stay in sync from a shared link.',
    action: 'Add subscription',
    empty: 'No calendar subscriptions yet.',
    calendars: subscribedCalendars.value,
  },
])

async function loadCalendars() {
  isLoading.value = true
  await fetchCalendars()
  isLoading.value = false
}

function clearError() {
  operationError.value = ''
  errorCalendarId.value = null
}

function openCreate(mode) {
  editingCalendarId.value = null
  confirmingDeleteId.value = null
  createMode.value = mode
  newCalendarName.value = ''
  newCalendarSubscriptionUrl.value = ''
  clearError()
  nextTick(() => {
    const input = Array.isArray(newCalendarInput.value)
      ? newCalendarInput.value[0]
      : newCalendarInput.value
    input?.focus()
  })
}

function closeCreate() {
  createMode.value = null
  clearError()
}

async function createCalendar() {
  const name = newCalendarName.value.trim()
  const subscriptionUrl = newCalendarSubscriptionUrl.value.trim()
  if (!name || (createMode.value === 'subscription' && !subscriptionUrl)) return

  try {
    const headers = await store.authHeaders({ 'Content-Type': 'application/json' })
    const response = await fetch(CALENDARS_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name,
        color: NEW_CALENDAR_PALETTE[calendars.value.length % NEW_CALENDAR_PALETTE.length],
        subscriptionUrl: createMode.value === 'subscription' ? subscriptionUrl : undefined,
      }),
    })
    if (response.status === 409) {
      operationError.value = 'A calendar with that name already exists.'
      return
    }
    if (!response.ok) throw new Error(`POST calendars responded ${response.status}`)
    const { calendar } = await response.json()
    calendars.value.push(calendar)
    closeCreate()
    if (calendar.subscriptionError) {
      store.notify(`Sync failed: ${calendar.subscriptionError}`, 'error')
    }
  } catch (error) {
    console.error('Failed to create calendar:', error)
    store.notify('Failed to create calendar.', 'error')
  }
}

function startRenameCalendar(calendar) {
  createMode.value = null
  editingCalendarId.value = calendar.id
  editingCalendarName.value = calendar.name
  confirmingDeleteId.value = null
  clearError()
  nextTick(() => {
    const input = Array.isArray(editingCalendarInput.value)
      ? editingCalendarInput.value[0]
      : editingCalendarInput.value
    input?.focus()
  })
}

function cancelRenameCalendar() {
  editingCalendarId.value = null
  confirmingDeleteId.value = null
  clearError()
}

async function renameCalendar() {
  const id = editingCalendarId.value
  const name = editingCalendarName.value.trim()
  if (!id || !name) return

  try {
    const headers = await store.authHeaders({ 'Content-Type': 'application/json' })
    const response = await fetch(CALENDARS_ENDPOINT, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ id, name }),
    })
    if (response.status === 409) {
      operationError.value = 'A calendar with that name already exists.'
      errorCalendarId.value = id
      return
    }
    if (!response.ok) throw new Error(`PATCH calendars responded ${response.status}`)
    const { calendar } = await response.json()
    const index = calendars.value.findIndex((item) => item.id === id)
    if (index !== -1) calendars.value[index] = calendar
    cancelRenameCalendar()
  } catch (error) {
    console.error('Failed to rename calendar:', error)
    store.notify('Failed to rename calendar.', 'error')
  }
}

async function syncCalendarNow(calendar) {
  syncingCalendarId.value = calendar.id
  clearError()
  try {
    const headers = await store.authHeaders({ 'Content-Type': 'application/json' })
    const response = await fetch(CALENDARS_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'sync', id: calendar.id }),
    })
    const body = await response.json().catch(() => ({}))
    const errorMessage = body.subscriptionError || body.error || null
    const index = calendars.value.findIndex((item) => item.id === calendar.id)
    if (index !== -1) {
      calendars.value[index] = {
        ...calendars.value[index],
        subscriptionSyncedAt:
          body.subscriptionSyncedAt ?? calendars.value[index].subscriptionSyncedAt,
        subscriptionError: errorMessage,
      }
    }
    if (!response.ok) {
      operationError.value = `Sync failed: ${errorMessage || 'unknown error'}`
      errorCalendarId.value = calendar.id
      store.notify(operationError.value, 'error')
    }
  } catch (error) {
    console.error('Failed to sync calendar:', error)
    store.notify('Failed to sync calendar.', 'error')
  } finally {
    syncingCalendarId.value = null
  }
}

function requestDeleteCalendar(id) {
  confirmingDeleteId.value = id
}

async function confirmDeleteCalendar() {
  const id = confirmingDeleteId.value
  if (!id) return

  try {
    const headers = await store.authHeaders({ 'Content-Type': 'application/json' })
    const response = await fetch(CALENDARS_ENDPOINT, {
      method: 'DELETE',
      headers,
      body: JSON.stringify({ id }),
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      operationError.value = body.error || 'Failed to delete calendar.'
      errorCalendarId.value = id
      confirmingDeleteId.value = null
      store.notify(operationError.value, 'error')
      return
    }
    calendars.value = calendars.value.filter((calendar) => calendar.id !== id)
    cancelRenameCalendar()
  } catch (error) {
    console.error('Failed to delete calendar:', error)
    store.notify('Failed to delete calendar.', 'error')
  }
}

onMounted(loadCalendars)
</script>

<template>
  <div class="calendar-settings-manager">
    <p class="settings-section-hint">
      Create calendars for your events, or subscribe to an external calendar using its URL.
    </p>

    <section
      v-for="group in calendarGroups"
      :key="group.mode"
      class="calendar-settings-group"
      :aria-labelledby="group.id"
    >
      <div class="calendar-settings-group-header">
        <div>
          <h3 :id="group.id" class="settings-section-title">{{ group.title }}</h3>
          <p>{{ group.description }}</p>
        </div>
        <button type="button" class="btn btn-secondary" @click="openCreate(group.mode)">
          <span class="material-symbols-outlined" aria-hidden="true">add</span>
          {{ group.action }}
        </button>
      </div>

      <p v-if="isLoading && group.mode === 'calendar'" class="calendar-settings-empty">
        Loading calendars…
      </p>
      <div v-else-if="!isLoading" class="calendar-settings-list">
        <p v-if="group.calendars.length === 0" class="calendar-settings-empty">
          {{ group.empty }}
        </p>
        <div
          v-for="calendar in group.calendars"
          :key="calendar.id"
          class="calendar-settings-row"
        >
          <form
            v-if="editingCalendarId === calendar.id"
            class="calendar-settings-edit"
            @submit.prevent="renameCalendar"
          >
            <span class="calendar-settings-color" :style="{ backgroundColor: calendar.color }" />
            <input
              ref="editingCalendarInput"
              v-model="editingCalendarName"
              class="label-input"
              maxlength="50"
              :aria-label="`Rename ${calendar.name}`"
              @keydown.escape="cancelRenameCalendar"
            />
            <button
              type="submit"
              class="ni-action-btn"
              title="Save"
              :disabled="!editingCalendarName.trim()"
            >
              <span class="material-symbols-outlined" aria-hidden="true">check</span>
            </button>
            <button
              type="button"
              class="ni-action-btn"
              title="Cancel"
              @click="cancelRenameCalendar"
            >
              <span class="material-symbols-outlined" aria-hidden="true">close</span>
            </button>
            <button
              type="button"
              class="ni-action-btn calendar-settings-delete"
              :class="{ confirming: confirmingDeleteId === calendar.id }"
              :aria-label="
                confirmingDeleteId === calendar.id
                  ? `Confirm delete ${calendar.name}`
                  : `Delete ${calendar.name}`
              "
              @click="
                confirmingDeleteId === calendar.id
                  ? confirmDeleteCalendar()
                  : requestDeleteCalendar(calendar.id)
              "
            >
              <span class="material-symbols-outlined" aria-hidden="true">delete</span>
            </button>
          </form>
          <template v-else>
            <span class="calendar-settings-color" :style="{ backgroundColor: calendar.color }" />
            <div class="calendar-settings-copy">
              <strong>{{ calendar.name }}</strong>
              <small :title="calendar.subscriptionUrl || undefined">
                {{ calendar.subscriptionUrl || 'Calendar' }}
              </small>
              <small v-if="calendar.subscriptionError" class="calendar-settings-error">
                Sync failed: {{ calendar.subscriptionError }}
              </small>
            </div>
            <button
              v-if="calendar.subscriptionUrl"
              type="button"
              class="ni-action-btn"
              :class="{ syncing: syncingCalendarId === calendar.id }"
              :aria-label="`Sync ${calendar.name}`"
              title="Sync now"
              :disabled="syncingCalendarId === calendar.id"
              @click="syncCalendarNow(calendar)"
            >
              <span class="material-symbols-outlined" aria-hidden="true">sync</span>
            </button>
            <button
              type="button"
              class="ni-action-btn"
              :aria-label="`Edit ${calendar.name}`"
              @click="startRenameCalendar(calendar)"
            >
              <span class="material-symbols-outlined" aria-hidden="true">edit</span>
            </button>
          </template>
          <p
            v-if="operationError && errorCalendarId === calendar.id"
            class="calendar-settings-error"
            role="alert"
          >
            {{ operationError }}
          </p>
        </div>
      </div>

      <form
        v-if="createMode === group.mode"
        class="calendar-settings-create"
        @submit.prevent="createCalendar"
      >
        <label>
          <span>Name</span>
          <input
            ref="newCalendarInput"
            v-model="newCalendarName"
            class="label-input"
            maxlength="50"
            aria-label="New calendar name"
            :placeholder="group.mode === 'subscription' ? 'e.g. Team events' : 'e.g. Travel'"
            @keydown.escape="closeCreate"
          />
        </label>
        <label v-if="group.mode === 'subscription'">
          <span>Calendar URL</span>
          <input
            v-model="newCalendarSubscriptionUrl"
            type="url"
            class="label-input"
            aria-label="Calendar subscription URL"
            placeholder="https:// or webcal:// calendar link"
            @keydown.escape="closeCreate"
          />
        </label>
        <p v-if="operationError" class="calendar-settings-error" role="alert">
          {{ operationError }}
        </p>
        <div class="calendar-settings-create-actions">
          <button type="button" class="btn btn-secondary" @click="closeCreate">Cancel</button>
          <button
            type="submit"
            class="btn btn-primary"
            :disabled="
              !newCalendarName.trim() ||
              (group.mode === 'subscription' && !newCalendarSubscriptionUrl.trim())
            "
          >
            {{ group.action }}
          </button>
        </div>
      </form>
    </section>
  </div>
</template>
