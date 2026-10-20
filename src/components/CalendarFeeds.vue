<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useInboxStore } from '../stores/inbox'
import { CALENDAR_API_URL } from '../lib/apiWorkers'
import { calendarSession, isCalendarSessionCurrent } from '../composables/useCalendars'

const props = defineProps({ calendars: { type: Array, required: true } })
const store = useInboxStore()
const endpoint = `${CALENDAR_API_URL}/calendar-feeds`
const enabled = ref(new Set())
// Bearer URLs live only in this component, never in the shared store or storage.
const links = ref({})
const loading = ref(true)
const loaded = ref(false)
const busy = ref(null)
const confirmation = ref(null)
const error = ref('')
const notice = ref('')
let mounted = true
const current = (session) => mounted && isCalendarSessionCurrent(session)
onBeforeUnmount(() => {
  mounted = false
  links.value = {}
})
watch(
  () => props.calendars.map((calendar) => calendar.id),
  (ids) => {
    links.value = Object.fromEntries(Object.entries(links.value).filter(([id]) => ids.includes(id)))
    enabled.value = new Set([...enabled.value].filter((id) => ids.includes(id)))
    confirmation.value = null
  },
  { flush: 'sync' },
)

async function loadFeeds() {
  const session = calendarSession()
  loading.value = true
  loaded.value = false
  error.value = ''
  try {
    const headers = await store.authHeaders()
    if (!current(session)) return
    const response = await fetch(endpoint, { headers, cache: 'no-store' })
    if (!response.ok) throw new Error('Feed status unavailable')
    const body = await response.json()
    if (!current(session)) return
    enabled.value = new Set(body.feeds.map((feed) => feed.calendarId))
    loaded.value = true
  } catch {
    if (current(session)) error.value = 'Could not load private feed status. Please try again.'
  } finally {
    if (current(session)) loading.value = false
  }
}

function ask(calendarId, action) {
  confirmation.value = { calendarId, action }
  error.value = ''
  notice.value = ''
}

async function changeFeed(calendarId, action) {
  if (busy.value || !loaded.value) return
  const session = calendarSession()
  busy.value = calendarId
  error.value = ''
  notice.value = ''
  try {
    const headers = await store.authHeaders({ 'Content-Type': 'application/json' })
    if (!current(session)) return
    const response = await fetch(endpoint, {
      method: action === 'revoke' ? 'DELETE' : 'POST',
      headers,
      body: JSON.stringify({ calendarId }),
      cache: 'no-store',
    })
    if (!response.ok) throw new Error('Feed change failed')
    const body = await response.json()
    if (!current(session) || !props.calendars.some((calendar) => calendar.id === calendarId)) return
    if (action === 'revoke') {
      enabled.value.delete(calendarId)
      delete links.value[calendarId]
      notice.value = 'Link revoked. Previously downloaded events may remain in other apps.'
    } else {
      enabled.value.add(calendarId)
      links.value[calendarId] =
        `${CALENDAR_API_URL}/calendar-feed.ics?token=${encodeURIComponent(body.token)}`
      notice.value = 'Private link generated. Copy it before leaving this page.'
    }
    confirmation.value = null
  } catch {
    if (current(session)) {
      // Do not log errors or responses that may contain a generated bearer URL.
      error.value = 'Could not update the private feed. Please try again.'
    }
  } finally {
    if (current(session)) busy.value = null
  }
}

async function copyLink(id) {
  const session = calendarSession()
  try {
    await navigator.clipboard.writeText(links.value[id])
    if (current(session)) {
      error.value = ''
      notice.value = 'Private link copied.'
    }
  } catch {
    if (current(session)) error.value = 'Could not copy. Select the link and copy it manually.'
  }
}

onMounted(loadFeeds)
</script>

<template>
  <section class="calendar-settings-group" aria-labelledby="private-calendar-feeds-heading">
    <div class="calendar-settings-group-header">
      <div>
        <h3 id="private-calendar-feeds-heading" class="settings-section-title">
          Private calendar feeds
        </h3>
        <p>Subscribe to your Cookie calendars in another calendar app using a read-only link.</p>
      </div>
    </div>
    <p class="settings-section-hint">
      Anyone with a link can read that calendar’s full event details. Keep it private. Other apps
      choose when to refresh. Event times stay local, as they do in Cookie.
    </p>
    <p v-if="loading" class="calendar-settings-empty">Loading private feeds…</p>
    <p v-else-if="!calendars.length" class="calendar-settings-empty">
      Create your own calendar above to generate a private feed.
    </p>
    <div v-else class="calendar-settings-list">
      <div v-for="calendar in calendars" :key="calendar.id" class="calendar-settings-row feed-row">
        <span class="calendar-settings-color" :style="{ backgroundColor: calendar.color }" />
        <div class="calendar-settings-copy">
          <strong>{{ calendar.name }}</strong>
          <small>{{
            !loaded
              ? 'Status unavailable'
              : enabled.has(calendar.id)
                ? 'Private feed enabled'
                : 'Not shared'
          }}</small>
        </div>
        <div class="feed-actions">
          <button
            type="button"
            class="btn btn-secondary"
            :aria-label="`${enabled.has(calendar.id) ? 'Replace' : 'Generate'} private link for ${calendar.name}`"
            :disabled="!loaded || Boolean(busy)"
            @click="
              enabled.has(calendar.id)
                ? ask(calendar.id, 'replace')
                : changeFeed(calendar.id, 'generate')
            "
          >
            {{ enabled.has(calendar.id) ? 'Replace link' : 'Generate link' }}
          </button>
          <button
            v-if="enabled.has(calendar.id)"
            type="button"
            class="btn btn-secondary"
            :aria-label="`Revoke private link for ${calendar.name}`"
            :disabled="Boolean(busy)"
            @click="ask(calendar.id, 'revoke')"
          >
            Revoke
          </button>
        </div>
        <div v-if="links[calendar.id]" class="feed-link">
          <input
            class="label-input"
            readonly
            :value="links[calendar.id]"
            :aria-label="`Private subscription link for ${calendar.name}`"
            autocomplete="off"
            spellcheck="false"
            @focus="$event.target.select()"
          />
          <button
            type="button"
            class="btn btn-secondary"
            :aria-label="`Copy private link for ${calendar.name}`"
            @click="copyLink(calendar.id)"
          >
            Copy link
          </button>
          <small>Shown only now. Add this URL as a calendar subscription in your other app.</small>
        </div>
        <div v-if="confirmation?.calendarId === calendar.id" class="feed-confirmation">
          <p>
            {{
              confirmation.action === 'revoke'
                ? 'Revoke this link? Apps using it will stop receiving updates.'
                : 'Replace this link? The old link will stop working. You will need to update your subscriptions.'
            }}
          </p>
          <div class="feed-actions">
            <button
              type="button"
              class="btn btn-secondary"
              :disabled="Boolean(busy)"
              @click="confirmation = null"
            >
              Cancel
            </button>
            <button
              type="button"
              class="btn btn-primary"
              :disabled="Boolean(busy)"
              @click="changeFeed(calendar.id, confirmation.action)"
            >
              {{
                busy
                  ? 'Saving…'
                  : confirmation.action === 'revoke'
                    ? 'Confirm revoke'
                    : 'Confirm replace'
              }}
            </button>
          </div>
        </div>
      </div>
    </div>
    <p v-if="notice" class="settings-section-hint" role="status">{{ notice }}</p>
    <p v-if="error" class="calendar-settings-error" role="alert">{{ error }}</p>
    <button v-if="!loading && !loaded" type="button" class="btn btn-secondary" @click="loadFeeds">
      Retry private feeds
    </button>
  </section>
</template>

<style scoped>
.feed-row {
  flex-wrap: wrap;
}
.feed-actions,
.feed-link {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.feed-link,
.feed-confirmation {
  flex-basis: 100%;
  min-width: 0;
}
.feed-link input {
  flex: 1 1 200px;
  min-width: 0;
}
.feed-link small {
  flex-basis: 100%;
  color: var(--text-secondary);
}
.feed-confirmation p {
  margin: 0 0 8px;
}
</style>
