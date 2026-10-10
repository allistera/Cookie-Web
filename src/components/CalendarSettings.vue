<script setup>
import { computed, inject, nextTick, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useInboxStore } from '../stores/inbox'
import {
  CALENDARS_ENDPOINT,
  GOOGLE_CALENDAR_ENDPOINT,
  calendarSession,
  isCalendarSessionCurrent,
  useCalendars,
} from '../composables/useCalendars'
import { NAVIGATE_TO, navigateTo as leaveTo } from '../lib/externalNavigation'

const store = useInboxStore()
// Optional in standalone component tests; used to read and clear the
// ?google= outcome Google's redirect brings back.
const router = useRouter()
const navigateTo = inject(NAVIGATE_TO, leaveTo)
const {
  calendars,
  localCalendars,
  subscribedCalendars,
  loadCalendars: fetchCalendars,
  syncCalendar,
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
    calendars: localCalendars.value,
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
  // Force: this is the calendar management surface, so it should always show
  // the current server state (e.g. a subscription synced elsewhere) rather
  // than whatever another view happened to load earlier in the session.
  await fetchCalendars({ force: true })
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
  const session = calendarSession()
  const name = newCalendarName.value.trim()
  const subscriptionUrl = newCalendarSubscriptionUrl.value.trim()
  if (!name || (createMode.value === 'subscription' && !subscriptionUrl)) return

  try {
    const headers = await store.authHeaders({ 'Content-Type': 'application/json' })
    if (!isCalendarSessionCurrent(session)) return
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
    if (!isCalendarSessionCurrent(session)) return
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
  const session = calendarSession()
  const id = editingCalendarId.value
  const name = editingCalendarName.value.trim()
  if (!id || !name) return

  try {
    const headers = await store.authHeaders({ 'Content-Type': 'application/json' })
    if (!isCalendarSessionCurrent(session)) return
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
    if (!isCalendarSessionCurrent(session)) return
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
    const { ok, errorMessage } = await syncCalendar(calendar.id)
    if (!ok) {
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
  const session = calendarSession()
  const id = confirmingDeleteId.value
  if (!id) return

  try {
    const headers = await store.authHeaders({ 'Content-Type': 'application/json' })
    if (!isCalendarSessionCurrent(session)) return
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
    if (!isCalendarSessionCurrent(session)) return
    calendars.value = calendars.value.filter((calendar) => calendar.id !== id)
    cancelRenameCalendar()
  } catch (error) {
    console.error('Failed to delete calendar:', error)
    store.notify('Failed to delete calendar.', 'error')
  }
}

// --- Google Calendar -------------------------------------------------------
//
// The Worker owns the OAuth flow and the tokens; this component only shows
// the connection, starts a sign-in (a full-page trip to Google's consent
// screen, returning to this route with ?google=connected or ?google=error),
// and saves which of the account's calendars Cookie shows.

const google = ref(null)
const googleLoading = ref(true)
const googleBusy = ref(false)
const googleError = ref('')
const confirmingDisconnect = ref(false)
// Bumped after a failed selection save so every checkbox re-renders from
// state instead of keeping the tick the click just gave it.
const googleListKey = ref(0)

function normalizeGoogle(body) {
  return {
    configured: body?.configured === true,
    connected: body?.connected === true,
    email: body?.email ? String(body.email) : null,
    needsReauth: body?.needsReauth === true,
    calendars: Array.isArray(body?.calendars) ? body.calendars : [],
    calendarsError: body?.calendarsError ? String(body.calendarsError) : '',
  }
}

async function loadGoogle() {
  const session = calendarSession()
  googleLoading.value = true
  try {
    const headers = await store.authHeaders()
    if (!isCalendarSessionCurrent(session)) return
    const response = await fetch(GOOGLE_CALENDAR_ENDPOINT, { headers })
    if (!response.ok) throw new Error(`GET google-calendar responded ${response.status}`)
    const body = await response.json()
    if (!isCalendarSessionCurrent(session)) return
    google.value = normalizeGoogle(body)
  } catch (error) {
    console.error('Failed to load the Google Calendar connection:', error)
    if (isCalendarSessionCurrent(session)) {
      googleError.value = 'Google Calendar status could not be loaded.'
    }
  } finally {
    if (isCalendarSessionCurrent(session)) googleLoading.value = false
  }
}

async function connectGoogle() {
  googleBusy.value = true
  googleError.value = ''
  try {
    const headers = await store.authHeaders({ 'Content-Type': 'application/json' })
    const response = await fetch(GOOGLE_CALENDAR_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'authorize',
        returnTo: `${window.location.origin}/settings/calendar`,
      }),
    })
    if (!response.ok) throw new Error(`POST google-calendar responded ${response.status}`)
    const { url } = await response.json()
    if (!url) throw new Error('No authorization URL')
    // Stays busy: the page is on its way to Google.
    navigateTo(String(url))
  } catch (error) {
    console.error('Failed to start Google sign-in:', error)
    googleError.value = 'Google sign-in could not be started.'
    googleBusy.value = false
  }
}

async function toggleGoogleCalendar(calendar, selected) {
  const current = google.value
  if (!current) return
  const calendarIds = current.calendars
    .filter((item) => (item.id === calendar.id ? selected : item.selected))
    .map((item) => item.id)
  googleBusy.value = true
  googleError.value = ''
  try {
    const headers = await store.authHeaders({ 'Content-Type': 'application/json' })
    const response = await fetch(GOOGLE_CALENDAR_ENDPOINT, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ calendarIds }),
    })
    if (!response.ok) throw new Error(`PATCH google-calendar responded ${response.status}`)
    const body = await response.json()
    google.value = { ...current, calendars: normalizeGoogle(body).calendars }
    // The sidebar's shared list now includes (or drops) the calendar.
    await fetchCalendars({ force: true })
  } catch (error) {
    console.error('Failed to save the Google calendar selection:', error)
    googleError.value = 'The calendar selection could not be saved.'
    googleListKey.value += 1
  } finally {
    googleBusy.value = false
  }
}

async function disconnectGoogle() {
  if (!confirmingDisconnect.value) {
    confirmingDisconnect.value = true
    return
  }
  googleBusy.value = true
  googleError.value = ''
  try {
    const headers = await store.authHeaders({ 'Content-Type': 'application/json' })
    const response = await fetch(GOOGLE_CALENDAR_ENDPOINT, { method: 'DELETE', headers })
    if (!response.ok) throw new Error(`DELETE google-calendar responded ${response.status}`)
    google.value = normalizeGoogle({ configured: true, connected: false })
    confirmingDisconnect.value = false
    await fetchCalendars({ force: true })
  } catch (error) {
    console.error('Failed to disconnect Google Calendar:', error)
    googleError.value = 'Google Calendar could not be disconnected.'
  } finally {
    googleBusy.value = false
  }
}

function cancelDisconnect() {
  confirmingDisconnect.value = false
}

function googleCalendarHint(calendar) {
  return [calendar.primary ? 'Primary' : null, calendar.readOnly ? 'Read-only' : 'Editable']
    .filter(Boolean)
    .join(' · ')
}

// Google's redirect lands on /settings/calendar?google=connected|error (via
// the Worker's callback). Report it once and drop it from the URL.
function consumeGoogleReturn() {
  const query = router?.currentRoute.value.query
  const outcome = query?.google
  if (!outcome) return
  if (outcome === 'connected') {
    store.notify('Google Calendar connected. Choose which calendars to show.', 'info')
  } else {
    store.notify(
      query.reason === 'denied'
        ? 'Google sign-in was cancelled.'
        : 'Google Calendar could not be connected. Try again.',
      'error',
    )
  }
  const rest = { ...query }
  delete rest.google
  delete rest.reason
  router.replace({ query: rest })
}

onMounted(() => {
  consumeGoogleReturn()
  loadCalendars()
  loadGoogle()
})
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
        <div v-for="calendar in group.calendars" :key="calendar.id" class="calendar-settings-row">
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
              :aria-label="`Save ${calendar.name}`"
              :disabled="!editingCalendarName.trim()"
            >
              <span class="material-symbols-outlined" aria-hidden="true">check</span>
            </button>
            <button
              type="button"
              class="ni-action-btn"
              title="Cancel"
              :aria-label="`Cancel renaming ${calendar.name}`"
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

    <section class="calendar-settings-group" aria-labelledby="google-calendar-heading">
      <div class="calendar-settings-group-header">
        <div>
          <h3 id="google-calendar-heading" class="settings-section-title">Google Calendar</h3>
          <p>Sign in with Google to see, edit and create events from your Google calendars.</p>
        </div>
        <button
          v-if="google?.configured && !google.connected"
          type="button"
          class="btn btn-primary"
          :disabled="googleBusy"
          @click="connectGoogle"
        >
          {{ googleBusy ? 'Opening Google…' : 'Connect Google Calendar' }}
        </button>
        <div v-else-if="google?.connected" class="calendar-settings-google-actions">
          <button
            v-if="confirmingDisconnect"
            type="button"
            class="btn btn-secondary"
            :disabled="googleBusy"
            @click="cancelDisconnect"
          >
            Keep
          </button>
          <button
            type="button"
            class="btn btn-secondary"
            :class="{ 'calendar-settings-disconnect-confirm': confirmingDisconnect }"
            :disabled="googleBusy"
            @click="disconnectGoogle"
          >
            {{ confirmingDisconnect ? 'Confirm disconnect' : 'Disconnect' }}
          </button>
        </div>
      </div>

      <p v-if="googleLoading" class="calendar-settings-empty">Checking Google Calendar…</p>
      <template v-else-if="google">
        <p v-if="!google.configured" class="calendar-settings-empty">
          Google Calendar is not set up on this Cookie deployment.
        </p>
        <p v-else-if="!google.connected" class="calendar-settings-empty">
          No Google account connected.
        </p>
        <div v-else :key="googleListKey" class="calendar-settings-list">
          <div class="calendar-settings-row calendar-settings-google-account">
            <span class="material-symbols-outlined" aria-hidden="true">account_circle</span>
            <div class="calendar-settings-copy">
              <strong>{{ google.email || 'Google account' }}</strong>
              <small>
                {{
                  google.needsReauth
                    ? 'Access has expired. Reconnect to keep showing these calendars.'
                    : 'Tick the calendars to show in Cookie. Their events can be edited and created here.'
                }}
              </small>
            </div>
            <button
              v-if="google.needsReauth"
              type="button"
              class="btn btn-secondary"
              :disabled="googleBusy"
              @click="connectGoogle"
            >
              Reconnect
            </button>
          </div>
          <p v-if="google.calendarsError" class="calendar-settings-error" role="alert">
            {{ google.calendarsError }}
          </p>
          <label
            v-for="calendar in google.calendars"
            :key="calendar.id"
            class="calendar-settings-row calendar-settings-google-row"
          >
            <span class="calendar-settings-color" :style="{ backgroundColor: calendar.color }" />
            <span class="calendar-settings-copy">
              <strong>{{ calendar.name }}</strong>
              <small>{{ googleCalendarHint(calendar) }}</small>
            </span>
            <input
              type="checkbox"
              :checked="calendar.selected"
              :disabled="googleBusy || google.needsReauth"
              :aria-label="`Show ${calendar.name} in Cookie`"
              @change="toggleGoogleCalendar(calendar, $event.target.checked)"
            />
          </label>
          <p v-if="google.calendars.length === 0" class="calendar-settings-empty">
            No calendars on this Google account.
          </p>
        </div>
      </template>
      <p v-if="googleError" class="calendar-settings-error" role="alert">{{ googleError }}</p>
    </section>
  </div>
</template>
