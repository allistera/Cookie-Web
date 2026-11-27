<script setup>
import { ref } from 'vue'
import { SEND_API_URL } from '../lib/apiWorkers'
import { useInboxStore } from '../stores/inbox'

// The send Worker mints the code itself, as it later consumes it.
const CONFIRMATION_URL = `${SEND_API_URL}/send/confirmation`

const store = useInboxStore()
const confirmation = ref('')
const expiresAt = ref('')
const error = ref('')
const pending = ref(false)

async function createConfirmation() {
  pending.value = true
  error.value = ''
  confirmation.value = ''
  expiresAt.value = ''
  try {
    const headers = await store.authHeaders()
    const response = await fetch(CONFIRMATION_URL, { method: 'POST', headers })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(
        body.error ||
          (response.status === 429
            ? 'Too many confirmations. Wait a minute, then try again.'
            : 'Could not create a send confirmation'),
      )
    }
    confirmation.value = String(body.confirmation || '')
    expiresAt.value = String(body.expiresAt || '')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not create a send confirmation'
  } finally {
    pending.value = false
  }
}

async function copyConfirmation() {
  if (!confirmation.value) return
  try {
    await navigator.clipboard.writeText(confirmation.value)
    store.notify('Send confirmation copied.')
  } catch {
    error.value = 'Could not copy the confirmation.'
  }
}
</script>

<template>
  <section class="settings-section" data-testid="agent-section">
    <h3 class="settings-section-title">Connected agents</h3>
    <p class="settings-section-hint">
      An agent with permission to send mail still needs a confirmation created here. Paste it into
      the agent for one email. It expires in ten minutes and cannot be reused for a different
      message. Instructions inside an email cannot create one.
    </p>
    <button class="btn btn-primary" type="button" :disabled="pending" @click="createConfirmation">
      Create send confirmation
    </button>
    <p v-if="confirmation" class="settings-section-hint">
      <code>{{ confirmation }}</code>
      <button class="btn" type="button" @click="copyConfirmation">Copy</button>
      <span v-if="expiresAt">Expires {{ expiresAt }}</span>
    </p>
    <p v-if="error" class="settings-error" role="alert">{{ error }}</p>
  </section>
</template>
