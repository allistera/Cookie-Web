<script setup>
import { computed, onMounted, ref } from 'vue'

import { useTodoistStore } from '../stores/todoist'

// Settings > Tasks > Todoist. One connection: paste the personal API token,
// choose whether the hourly sync runs, sync on demand, or disconnect. The
// token itself never comes back from the Worker; only its last characters do.
const store = useTodoistStore()

const tokenDraft = ref('')
const tokenInput = ref(null)
const replacingToken = ref(false)
const confirmingDisconnect = ref(false)
const loadFailed = ref(false)

const settings = computed(() => store.settings)
const busy = computed(() => store.isSaving || store.isSyncing)
const showTokenForm = computed(() => !settings.value.connected || replacingToken.value)
const tokenValid = computed(() => {
  const token = tokenDraft.value.trim()
  return token.length > 0 && token.length <= 200 && !/\s/.test(token)
})

const SYNCED_AT = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' })

const lastSyncedText = computed(() => {
  const at = settings.value.lastSyncedAt
  if (!at) return ''
  const date = new Date(at)
  return Number.isNaN(date.getTime()) ? '' : SYNCED_AT.format(date)
})

const summaryText = computed(() => {
  const summary = settings.value.lastSyncSummary
  if (!summary) return ''
  const count = (value, singular, plural = `${singular}s`) => {
    const n = Number(value ?? 0)
    return `${n} ${n === 1 ? singular : plural}`
  }
  const parts = [
    count(summary.projects, 'project'),
    count(summary.sections, 'section'),
    count(summary.tasks, 'open task'),
  ]
  const changes = []
  if (Number(summary.completed ?? 0) > 0) changes.push(`${summary.completed} completed`)
  if (Number(summary.removed ?? 0) > 0) changes.push(`${summary.removed} removed`)
  if (Number(summary.skipped ?? 0) > 0) changes.push(`${summary.skipped} skipped`)
  return `${parts.join(', ')}${changes.length ? ` (${changes.join(', ')})` : ''}.`
})

async function load() {
  loadFailed.value = !(await store.loadSettings())
}

async function submitToken() {
  if (!tokenValid.value || busy.value) return
  const saved = await store.connect(tokenDraft.value.trim())
  if (!saved) return
  tokenDraft.value = ''
  replacingToken.value = false
  // A fresh token is worth a first look straight away.
  await store.syncNow()
}

function startReplacingToken() {
  replacingToken.value = true
  confirmingDisconnect.value = false
  requestAnimationFrame(() => tokenInput.value?.focus())
}

function cancelReplacingToken() {
  replacingToken.value = false
  tokenDraft.value = ''
}

async function toggleEnabled(event) {
  const enabled = Boolean(event.target.checked)
  const saved = await store.setEnabled(enabled)
  // A refused save leaves the box showing what is actually stored.
  if (!saved) event.target.checked = settings.value.enabled
}

async function syncNow() {
  if (busy.value) return
  await store.syncNow()
}

async function disconnect() {
  if (!confirmingDisconnect.value) {
    confirmingDisconnect.value = true
    return
  }
  confirmingDisconnect.value = false
  await store.disconnect()
}

onMounted(load)
</script>

<template>
  <section class="settings-section todoist-settings" data-testid="todoist-settings-section">
    <h3 class="settings-section-title">Todoist</h3>
    <p class="settings-section-hint">
      Mirror your Todoist projects, their sections and open tasks into Tasks. Todoist stays the
      source of truth: changes made there arrive every hour between 07:00 and 20:00 in your Todoist
      time zone, or whenever you sync now. Tasks you add in Cookie are left alone.
    </p>

    <p v-if="store.isLoading && !store.isLoaded" class="todoist-muted">Checking Todoist…</p>
    <template v-else-if="loadFailed">
      <p class="settings-error" role="alert">Could not load Todoist settings.</p>
      <button
        type="button"
        class="btn btn-secondary"
        data-testid="retry-todoist-settings"
        :disabled="store.isLoading"
        @click="load"
      >
        Retry
      </button>
    </template>
    <p v-else-if="!settings.configured" class="todoist-muted">
      Todoist sync is not set up on this Cookie deployment.
    </p>
    <template v-else>
      <div v-if="settings.connected" class="todoist-account">
        <span class="material-symbols-outlined" aria-hidden="true">sync</span>
        <div class="todoist-copy">
          <strong>{{ settings.email || 'Todoist account' }}</strong>
          <small>
            Token ending in {{ settings.tokenHint || '…' }}
            <template v-if="settings.timeZone"> · {{ settings.timeZone }}</template>
          </small>
        </div>
        <div class="todoist-account-actions">
          <button
            v-if="!replacingToken"
            type="button"
            class="btn btn-secondary"
            :disabled="busy"
            @click="startReplacingToken"
          >
            Replace token
          </button>
          <button
            v-if="confirmingDisconnect"
            type="button"
            class="btn btn-secondary"
            :disabled="busy"
            @click="confirmingDisconnect = false"
          >
            Keep
          </button>
          <button
            type="button"
            class="btn btn-secondary"
            :class="{ 'todoist-disconnect-confirm': confirmingDisconnect }"
            :disabled="busy"
            @click="disconnect"
          >
            {{ confirmingDisconnect ? 'Confirm disconnect' : 'Disconnect' }}
          </button>
        </div>
      </div>

      <form v-if="showTokenForm" class="todoist-token-form" @submit.prevent="submitToken">
        <label class="todoist-field">
          <span>Todoist API token</span>
          <input
            ref="tokenInput"
            v-model="tokenDraft"
            type="password"
            autocomplete="off"
            spellcheck="false"
            maxlength="200"
            aria-label="Todoist API token"
            placeholder="Paste your API token"
            :disabled="busy"
          />
          <small>
            In Todoist, open Settings → Integrations → Developer and copy the API token. Cookie
            stores it encrypted and only reads from your account.
          </small>
        </label>
        <div class="todoist-form-actions">
          <button type="submit" class="btn btn-primary" :disabled="busy || !tokenValid">
            {{
              store.isSaving
                ? 'Checking token…'
                : settings.connected
                  ? 'Save new token'
                  : 'Connect Todoist'
            }}
          </button>
          <button
            v-if="settings.connected"
            type="button"
            class="btn btn-secondary"
            :disabled="busy"
            @click="cancelReplacingToken"
          >
            Cancel
          </button>
        </div>
      </form>

      <template v-if="settings.connected">
        <label class="todoist-enabled">
          <span>
            <strong>Sync every hour</strong>
            <small>Runs on the hour from 07:00 to 20:00 where your Todoist clock is set.</small>
          </span>
          <input
            type="checkbox"
            aria-label="Sync every hour"
            :checked="settings.enabled"
            :disabled="busy"
            @change="toggleEnabled"
          />
        </label>

        <div class="todoist-sync-row">
          <button
            type="button"
            class="btn btn-secondary"
            data-testid="todoist-sync-now"
            :disabled="busy"
            @click="syncNow"
          >
            {{ store.isSyncing ? 'Syncing…' : 'Sync now' }}
          </button>
          <p
            v-if="settings.lastSyncStatus === 'failed'"
            class="settings-error todoist-status"
            role="alert"
          >
            Last sync failed{{ lastSyncedText ? ` (last success ${lastSyncedText})` : '' }}:
            {{ settings.lastSyncError || 'unknown error' }}
          </p>
          <p v-else-if="settings.lastSyncedAt" class="todoist-muted todoist-status">
            Last synced {{ lastSyncedText }}. {{ summaryText }}
          </p>
          <p v-else class="todoist-muted todoist-status">Not synced yet.</p>
        </div>
      </template>
    </template>
  </section>
</template>

<style scoped>
.todoist-muted {
  color: var(--text-secondary);
}
.todoist-account {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 20px 0 16px;
  padding: 12px 14px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
}
.todoist-account .material-symbols-outlined {
  color: var(--accent);
}
.todoist-copy {
  display: grid;
  gap: 2px;
  min-width: 0;
  flex: 1;
}
.todoist-copy small,
.todoist-field small,
.todoist-enabled small {
  color: var(--text-secondary);
}
.todoist-account-actions,
.todoist-form-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.todoist-disconnect-confirm {
  color: var(--danger-color, #e5484d);
  border-color: var(--danger-color, #e5484d);
}
.todoist-token-form {
  display: grid;
  gap: 14px;
  margin: 20px 0;
}
.todoist-field {
  display: grid;
  gap: 7px;
}
.todoist-field input {
  max-width: 420px;
  min-height: 40px;
  padding: 8px 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  color: var(--text-primary);
  background: var(--bg-input);
  font-family: var(--font-mono, monospace);
}
.todoist-enabled {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin: 20px 0;
}
.todoist-enabled > span {
  display: grid;
  gap: 4px;
}
.todoist-sync-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}
.todoist-status {
  margin: 0;
}
</style>
