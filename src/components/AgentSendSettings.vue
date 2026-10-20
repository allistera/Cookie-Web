<script setup>
import { ref } from 'vue'
import { useInboxStore } from '../stores/inbox'

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
    const headers = await store.authHeaders({ 'Content-Type': 'application/json' })
    const response = await fetch('/api/send?resource=confirmation', { method: 'POST', headers })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(body.error || 'Could not create a send confirmation')
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
