<script setup>
import { computed, onMounted, ref, watch } from 'vue'

import { useInboxStore } from '../stores/inbox'

// Settings > Notifications > ntfy. The person enters the ntfy server and
// topic they subscribe to in the ntfy app (ntfy.sh or their own server) and,
// when the topic needs one, an access token. Saving stores them in the
// notifications Worker and turns delivery on; the switch pauses it with the
// settings kept. The token never comes back from the Worker, only its last
// characters do.
const store = useInboxStore()

const FALLBACK_SERVER_URL = 'https://ntfy.sh'
// ntfy's own topic rule, mirrored so the form can say so before a round trip.
const TOPIC_RE = /^[A-Za-z0-9_-]{1,64}$/

const serverUrl = ref('')
const topic = ref('')
const tokenDraft = ref('')
const removeToken = ref(false)
const error = ref('')
const isLoading = ref(false)
const isSaving = ref(false)
const isTesting = ref(false)

const subscription = computed(() => store.ntfySubscription)
const hasSubscription = computed(() => Boolean(subscription.value?.topic))
const enabled = computed(() => store.isNtfyEnabled)
const tokensSupported = computed(() => subscription.value?.tokensSupported === true)
const tokenHint = computed(() => String(subscription.value?.tokenHint ?? ''))
const busy = computed(() => isLoading.value || isSaving.value || isTesting.value || !store.userId)

const serverValid = computed(() => {
  try {
    return new URL(serverUrl.value.trim()).protocol === 'https:'
  } catch {
    return false
  }
})
const topicValid = computed(() => TOPIC_RE.test(topic.value.trim()))
const tokenValid = computed(() => {
  const token = tokenDraft.value.trim()
  return token.length <= 200 && !/\s/.test(token)
})
const canSave = computed(() => serverValid.value && topicValid.value && tokenValid.value)

const status = computed(() => {
  if (isLoading.value) return 'Loading…'
  if (enabled.value) return 'Cookie will send new mail alerts to your ntfy topic.'
  if (hasSubscription.value) return 'Paused. Your settings are kept, so turn this back on any time.'
  return 'Enter the server and topic you subscribe to in ntfy, then save to turn this on.'
})

function fillForm() {
  const current = subscription.value
  serverUrl.value = String(current?.serverUrl || current?.defaultServerUrl || FALLBACK_SERVER_URL)
  topic.value = String(current?.topic || '')
  tokenDraft.value = ''
  removeToken.value = false
}

async function load() {
  if (!store.userId) return
  error.value = ''
  isLoading.value = true
  try {
    await store.loadNtfySubscription()
  } catch (loadError) {
    console.error('Failed to load ntfy subscription:', loadError)
    error.value = 'Could not load ntfy settings.'
  } finally {
    isLoading.value = false
    fillForm()
  }
}

onMounted(load)
watch(() => store.userId, load)

function generateTopic() {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  topic.value = `cookie-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

function saveErrorMessage(saveError) {
  const code = String(saveError?.code ?? '')
  if (code === 'topic_taken') {
    return 'Another Cookie account already uses that topic on this server.'
  }
  if (code === 'tokens_not_configured') {
    return 'Access tokens are not set up on this Cookie deployment.'
  }
  if (code.startsWith('invalid_') && saveError?.detail) return String(saveError.detail)
  return 'Could not save ntfy settings. Please try again.'
}

async function save() {
  if (!canSave.value || busy.value) return
  error.value = ''
  isSaving.value = true
  try {
    const payload = { serverUrl: serverUrl.value.trim(), topic: topic.value.trim() }
    const token = tokenDraft.value.trim()
    // Left out, the Worker keeps the stored token; null removes it.
    if (token) payload.accessToken = token
    else if (removeToken.value) payload.accessToken = null
    await store.saveNtfySubscription(payload)
    fillForm()
    store.notify('ntfy notifications saved.')
  } catch (saveError) {
    console.error('Failed to save ntfy settings:', saveError)
    error.value = saveErrorMessage(saveError)
  } finally {
    isSaving.value = false
  }
}

// The switch is controlled by the store, so a failed request snaps it back.
async function toggle(event) {
  const turnOn = event.target.checked
  error.value = ''
  if (turnOn) {
    if (!canSave.value) {
      error.value = 'Enter an https:// ntfy server and a topic first.'
    } else {
      await save()
    }
    event.target.checked = store.isNtfyEnabled
    return
  }
  isSaving.value = true
  try {
    await store.disableNtfySubscription()
  } catch (disableError) {
    console.error('Failed to disable ntfy notifications:', disableError)
    error.value = 'Could not pause ntfy notifications. Please try again.'
  } finally {
    isSaving.value = false
    event.target.checked = store.isNtfyEnabled
  }
}

async function copyUrl() {
  if (!subscription.value?.subscribeUrl || !navigator.clipboard) return
  await navigator.clipboard.writeText(subscription.value.subscribeUrl)
  store.notify('Topic URL copied.')
}

async function sendTest() {
  error.value = ''
  isTesting.value = true
  try {
    await store.sendNtfyTest()
    store.notify('Test notification sent.')
  } catch (testError) {
    console.error('Failed to send ntfy test notification:', testError)
    const code = String(testError?.code ?? '')
    error.value =
      code === 'ntfy_rate_limited'
        ? 'ntfy is temporarily rate-limiting notifications. Try again shortly.'
        : code === 'ntfy_unavailable'
          ? 'Your ntfy server is temporarily unavailable. Try again shortly.'
          : code === 'ntfy_rejected'
            ? 'Your ntfy server rejected the notification. Check the topic and access token.'
            : 'Could not send the test notification. Please try again.'
  } finally {
    isTesting.value = false
  }
}
</script>

<template>
  <h3 class="settings-section-title settings-section-title-spaced">ntfy notifications</h3>
  <p class="settings-section-hint">
    Get a push notification for each new email through
    <a href="https://ntfy.sh" target="_blank" rel="noopener noreferrer">ntfy</a>. Enter the server
    and topic you subscribe to in the ntfy app, save, and leave the switch on.
  </p>
  <label class="settings-row">
    <div class="settings-row-text">
      <span>ntfy notifications</span>
      <small>{{ status }}</small>
    </div>
    <input
      type="checkbox"
      class="settings-switch ntfy-switch"
      :checked="enabled"
      :disabled="busy"
      @change="toggle"
    />
  </label>

  <form class="ntfy-form" @submit.prevent="save">
    <label class="ntfy-field">
      <span>Server</span>
      <input
        v-model="serverUrl"
        type="url"
        inputmode="url"
        autocomplete="off"
        spellcheck="false"
        maxlength="200"
        aria-label="ntfy server URL"
        placeholder="https://ntfy.sh"
        :disabled="busy"
      />
      <small>ntfy.sh or your own ntfy server, as an https:// address.</small>
    </label>
    <label class="ntfy-field">
      <span>Topic</span>
      <div class="ntfy-topic-row">
        <input
          v-model="topic"
          type="text"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          maxlength="64"
          aria-label="ntfy topic"
          placeholder="my-cookie-mail"
          :disabled="busy"
        />
        <button type="button" class="btn btn-secondary" :disabled="busy" @click="generateTopic">
          Generate
        </button>
      </div>
      <small>
        Anyone who knows the topic can read these alerts, so use a name that is hard to guess or
        reserve it with an access token.
      </small>
    </label>
    <label v-if="tokensSupported" class="ntfy-field">
      <span>Access token (optional)</span>
      <input
        v-model="tokenDraft"
        type="password"
        autocomplete="off"
        spellcheck="false"
        maxlength="200"
        aria-label="ntfy access token"
        :placeholder="tokenHint && !removeToken ? 'Paste a new token to replace it' : 'tk_…'"
        :disabled="busy"
      />
      <small>
        Needed for a reserved topic on ntfy.sh or a server that requires sign-in. Cookie stores it
        encrypted and only sends it to the server above.
      </small>
    </label>
    <p v-else class="settings-section-hint">
      Access tokens are not set up on this Cookie deployment, so the topic must accept anonymous
      publishing.
    </p>
    <p v-if="tokensSupported && tokenHint" class="ntfy-token-state" data-testid="ntfy-token-state">
      <template v-if="removeToken">
        The saved token will be removed when you save.
        <button
          type="button"
          class="ntfy-link-button"
          :disabled="busy"
          @click="removeToken = false"
        >
          Keep it
        </button>
      </template>
      <template v-else>
        Token ending in {{ tokenHint }} is saved.
        <button type="button" class="ntfy-link-button" :disabled="busy" @click="removeToken = true">
          Remove token
        </button>
      </template>
    </p>
    <div class="ntfy-form-actions">
      <button type="submit" class="btn btn-primary" :disabled="busy || !canSave">
        {{ isSaving ? 'Saving…' : enabled ? 'Save' : 'Save and turn on' }}
      </button>
      <button type="button" class="btn btn-secondary" :disabled="!hasSubscription" @click="copyUrl">
        Copy topic URL
      </button>
      <button
        type="button"
        class="btn btn-secondary"
        :disabled="busy || !enabled"
        @click="sendTest"
      >
        {{ isTesting ? 'Sending…' : 'Send test notification' }}
      </button>
    </div>
  </form>

  <div v-if="hasSubscription" class="ntfy-subscription" data-testid="ntfy-subscription">
    <p>Subscribe in ntfy to:</p>
    <code>{{ subscription.subscribeUrl }}</code>
  </div>
  <p v-if="error" class="settings-error" role="alert">{{ error }}</p>
</template>

<style scoped>
.ntfy-form {
  display: grid;
  gap: 14px;
  margin: 20px 0;
}
.ntfy-field {
  display: grid;
  gap: 7px;
}
.ntfy-field small,
.ntfy-token-state {
  color: var(--text-secondary);
}
.ntfy-field input {
  width: 100%;
  max-width: 420px;
  min-height: 40px;
  padding: 8px 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  color: var(--text-primary);
  background: var(--bg-input);
  font-family: var(--font-mono, monospace);
}
.ntfy-topic-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.ntfy-topic-row input {
  flex: 1 1 240px;
}
.ntfy-token-state {
  margin: -6px 0 0;
  font-size: 0.9rem;
}
.ntfy-link-button {
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent);
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}
.ntfy-form-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.ntfy-subscription {
  display: grid;
  gap: 8px;
  margin-top: 12px;
}
.ntfy-subscription code {
  overflow-wrap: anywhere;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--text-primary);
}
</style>
