<script setup>
import { ref, reactive, computed, watch } from 'vue'
import { useAuth } from '../composables/useAuth'
import { useInboxStore } from '../stores/inbox'

const store = useInboxStore()
const { user, getAccessTokenSilently } = useAuth()

const isOpen = computed(() => store.activeModal === 'settings')

// --- Appearance ---
const isDarkMode = ref(document.documentElement.getAttribute('data-theme') === 'dark')

function toggleDarkMode() {
  store.toggleTheme()
  isDarkMode.value = document.documentElement.getAttribute('data-theme') === 'dark'
}

// --- Notification preferences (persisted locally) ---
const PREFS_KEY = 'cookie-settings-prefs'

function loadPrefs() {
  try {
    return { ...defaultPrefs, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }
  } catch {
    return { ...defaultPrefs }
  }
}

const defaultPrefs = {
  emailSummaries: true,
  todoReminders: true,
  aiSuggestions: true,
}

const prefs = reactive(loadPrefs())

watch(prefs, (val) => {
  localStorage.setItem(PREFS_KEY, JSON.stringify(val))
})

// --- Passkeys (Auth0 MyAccount API + WebAuthn) ---
const AUTH0_DOMAIN = import.meta.env.VITE_AUTH0_DOMAIN
const MY_ACCOUNT_AUDIENCE = `https://${AUTH0_DOMAIN}/me/`

const passkeys = ref([])
const passkeysLoading = ref(false)
const passkeyBusy = ref(false)
const passkeyMessage = ref('')
const passkeyError = ref('')

const webAuthnSupported =
  typeof window !== 'undefined' && !!(navigator.credentials && window.PublicKeyCredential)

function base64UrlToBuffer(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const buffer = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) buffer[i] = raw.charCodeAt(i)
  return buffer.buffer
}

function bufferToBase64Url(buffer) {
  const bytes = new Uint8Array(buffer)
  let raw = ''
  for (const b of bytes) raw += String.fromCharCode(b)
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function getMeToken(scope) {
  return getAccessTokenSilently({
    authorizationParams: { audience: MY_ACCOUNT_AUDIENCE, scope },
    cacheMode: 'off',
  })
}

async function loadPasskeys() {
  if (!webAuthnSupported) return
  passkeysLoading.value = true
  passkeyError.value = ''
  try {
    const token = await getMeToken('read:me:authentication_methods')
    const res = await fetch(`https://${AUTH0_DOMAIN}/me/v1/authentication-methods`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(`Auth0 returned ${res.status}`)
    const data = await res.json()
    const methods = Array.isArray(data) ? data : data.authentication_methods || []
    passkeys.value = methods.filter((m) => m.type === 'passkey')
  } catch (err) {
    passkeyError.value = describePasskeyError(err)
  } finally {
    passkeysLoading.value = false
  }
}

async function setupPasskey() {
  passkeyBusy.value = true
  passkeyMessage.value = ''
  passkeyError.value = ''
  try {
    const token = await getMeToken('create:me:authentication_methods')

    // 1. Ask Auth0 for a WebAuthn registration challenge
    const enrollRes = await fetch(`https://${AUTH0_DOMAIN}/me/v1/authentication-methods`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'passkey' }),
    })
    if (!enrollRes.ok) {
      const body = await enrollRes.json().catch(() => ({}))
      throw new Error(body.detail || body.title || `Auth0 returned ${enrollRes.status}`)
    }
    const enrollment = await enrollRes.json()
    const params = enrollment.authn_params_public_key

    // 2. Create the credential with the platform authenticator
    const publicKey = {
      ...params,
      challenge: base64UrlToBuffer(params.challenge),
      user: { ...params.user, id: base64UrlToBuffer(params.user.id) },
      excludeCredentials: (params.excludeCredentials || []).map((c) => ({
        ...c,
        id: base64UrlToBuffer(c.id),
      })),
    }
    const credential = await navigator.credentials.create({ publicKey })

    // 3. Send the attestation back to Auth0 for verification
    const verifyRes = await fetch(
      `https://${AUTH0_DOMAIN}/me/v1/authentication-methods/passkey|new/verify`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auth_session: enrollment.auth_session,
          authn_response: {
            id: credential.id,
            rawId: bufferToBase64Url(credential.rawId),
            type: credential.type,
            authenticatorAttachment: credential.authenticatorAttachment,
            response: {
              clientDataJSON: bufferToBase64Url(credential.response.clientDataJSON),
              attestationObject: bufferToBase64Url(credential.response.attestationObject),
            },
          },
        }),
      },
    )
    if (!verifyRes.ok) {
      const body = await verifyRes.json().catch(() => ({}))
      throw new Error(body.detail || body.title || `Verification failed (${verifyRes.status})`)
    }

    passkeyMessage.value = 'Passkey created successfully.'
    await loadPasskeys()
  } catch (err) {
    passkeyError.value = describePasskeyError(err)
  } finally {
    passkeyBusy.value = false
  }
}

async function removePasskey(id) {
  passkeyBusy.value = true
  passkeyError.value = ''
  try {
    const token = await getMeToken('delete:me:authentication_methods')
    const res = await fetch(
      `https://${AUTH0_DOMAIN}/me/v1/authentication-methods/${encodeURIComponent(id)}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
    )
    if (!res.ok && res.status !== 204) throw new Error(`Auth0 returned ${res.status}`)
    passkeyMessage.value = 'Passkey removed.'
    await loadPasskeys()
  } catch (err) {
    passkeyError.value = describePasskeyError(err)
  } finally {
    passkeyBusy.value = false
  }
}

function describePasskeyError(err) {
  const msg = err?.message || String(err)
  if (err?.name === 'NotAllowedError') {
    return 'Passkey prompt was dismissed or timed out.'
  }
  if (
    err?.error === 'consent_required' ||
    err?.error === 'login_required' ||
    /consent|audience|access is denied|service not (found|enabled)/i.test(msg)
  ) {
    return 'Passkeys are not enabled for this Auth0 tenant yet. Enable the MyAccount API and passkey authentication in the Auth0 dashboard, then try again.'
  }
  return msg
}

// Refresh passkey list whenever the modal opens
watch(isOpen, (open) => {
  if (open) {
    passkeyMessage.value = ''
    loadPasskeys()
  }
})
</script>

<template>
  <div class="modal-overlay" :class="{ active: isOpen }">
    <div class="modal-container settings-modal-container">
      <div class="modal-header">
        <div class="modal-title">
          <span class="material-symbols-outlined text-blue">settings</span>
          <span>Settings</span>
        </div>
        <button class="close-modal-btn" @click="store.closeTodoModal">&times;</button>
      </div>

      <div class="modal-body settings-body">
        <!-- Account -->
        <section class="settings-section">
          <h3 class="settings-section-title">Account</h3>
          <div class="settings-account-row">
            <img :src="user?.picture || '/rose_avatar.jpg'" :alt="user?.name" class="settings-avatar" />
            <div class="settings-account-info">
              <span class="settings-account-name">{{ user?.name || 'Allister' }}</span>
              <span class="settings-account-email">{{ user?.email || '' }}</span>
              <span class="settings-account-provider">Signed in with Google via Auth0</span>
            </div>
          </div>
        </section>

        <!-- Appearance -->
        <section class="settings-section">
          <h3 class="settings-section-title">Appearance</h3>
          <label class="settings-row">
            <div class="settings-row-text">
              <span>Dark mode</span>
              <small>Switch between light and dark themes</small>
            </div>
            <input type="checkbox" class="settings-switch" :checked="isDarkMode" @change="toggleDarkMode" />
          </label>
        </section>

        <!-- Notifications -->
        <section class="settings-section">
          <h3 class="settings-section-title">Notifications</h3>
          <label class="settings-row">
            <div class="settings-row-text">
              <span>Email summaries</span>
              <small>Daily digest of new mail and topics</small>
            </div>
            <input type="checkbox" class="settings-switch" v-model="prefs.emailSummaries" />
          </label>
          <label class="settings-row">
            <div class="settings-row-text">
              <span>To-do reminders</span>
              <small>Nudges when suggested to-dos are due</small>
            </div>
            <input type="checkbox" class="settings-switch" v-model="prefs.todoReminders" />
          </label>
          <label class="settings-row">
            <div class="settings-row-text">
              <span>AI suggestions</span>
              <small>Let Gemini surface suggested questions</small>
            </div>
            <input type="checkbox" class="settings-switch" v-model="prefs.aiSuggestions" />
          </label>
        </section>

        <!-- Security -->
        <section class="settings-section">
          <h3 class="settings-section-title">Security</h3>

          <div class="settings-row">
            <div class="settings-row-text">
              <span>Passkeys</span>
              <small>Sign in with Touch ID, Face ID, or a security key</small>
            </div>
            <button
              class="btn btn-primary settings-passkey-btn"
              :disabled="!webAuthnSupported || passkeyBusy"
              @click="setupPasskey"
            >
              <span class="material-symbols-outlined font-sm">fingerprint</span>
              {{ passkeyBusy ? 'Working…' : 'Set up passkey' }}
            </button>
          </div>

          <p v-if="!webAuthnSupported" class="settings-hint">
            This browser does not support passkeys.
          </p>

          <div v-if="passkeysLoading" class="settings-hint">Loading passkeys…</div>
          <ul v-else-if="passkeys.length" class="settings-passkey-list">
            <li v-for="pk in passkeys" :key="pk.id" class="settings-passkey-item">
              <span class="material-symbols-outlined text-blue">passkey</span>
              <div class="settings-row-text">
                <span>{{ pk.key_name || pk.credential_device_type || 'Passkey' }}</span>
                <small v-if="pk.created_at">Added {{ new Date(pk.created_at).toLocaleDateString() }}</small>
              </div>
              <button class="btn btn-text-sm" :disabled="passkeyBusy" @click="removePasskey(pk.id)">
                Remove
              </button>
            </li>
          </ul>

          <p v-if="passkeyMessage" class="settings-hint settings-hint-success">{{ passkeyMessage }}</p>
          <p v-if="passkeyError" class="settings-hint settings-hint-error">{{ passkeyError }}</p>
        </section>
      </div>

      <div class="modal-footer">
        <button class="btn btn-secondary" @click="store.closeTodoModal">Close</button>
      </div>
    </div>
  </div>
</template>
