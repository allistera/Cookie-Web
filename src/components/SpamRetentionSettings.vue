<script setup>
import { computed, ref, watch } from 'vue'
import { useInboxStore } from '../stores/inbox'

// SettingsView loads the stored value on open; this pane only edits it.
const store = useInboxStore()

// The input is a local draft so a half-typed number never hits the server;
// it re-syncs whenever the stored value changes (initial load, or a save
// whose server-normalized result differs from what was typed).
const spamRetentionDraft = ref(String(store.spamRetentionDays))
const spamRetentionError = ref('')
const isSavingSpamRetention = ref(false)
watch(
  () => store.spamRetentionDays,
  (days) => {
    spamRetentionDraft.value = String(days)
  },
)
// v-model on a number input hands back a number once typed into, hence String().
const spamRetentionDirty = computed(
  () => String(spamRetentionDraft.value).trim() !== String(store.spamRetentionDays),
)

async function saveSpamRetention() {
  const { minDays, maxDays } = store.spamRetentionBounds
  const days = Number(spamRetentionDraft.value)
  if (!Number.isInteger(days) || days < minDays || days > maxDays) {
    spamRetentionError.value = `Enter a whole number of days from ${minDays} to ${maxDays}.`
    return
  }
  spamRetentionError.value = ''
  isSavingSpamRetention.value = true
  try {
    await store.saveSpamRetention(days)
    store.notify(`Spam will be deleted after ${days} ${days === 1 ? 'day' : 'days'}.`)
  } catch (error) {
    console.error('Failed to save spam retention:', error)
    spamRetentionError.value = 'Could not save. Please try again.'
  } finally {
    isSavingSpamRetention.value = false
  }
}
</script>

<template>
  <section class="settings-section" data-testid="spam-section">
    <h3 class="settings-section-title">Delete spam automatically</h3>
    <p class="settings-section-hint">
      Mail in Spam is deleted once it has been there this many days. The default is
      {{ store.spamRetentionBounds.defaultDays }} days. Anything you mark Not spam before then is
      kept.
    </p>

    <form class="spam-retention" @submit.prevent="saveSpamRetention">
      <label class="spam-retention-field">
        <span>Delete spam after</span>
        <input
          v-model="spamRetentionDraft"
          class="label-input spam-retention-input"
          type="number"
          inputmode="numeric"
          :min="store.spamRetentionBounds.minDays"
          :max="store.spamRetentionBounds.maxDays"
          step="1"
          :disabled="isSavingSpamRetention"
          aria-label="Days to keep spam before deleting it"
        />
        <span>days</span>
      </label>
      <button
        class="btn btn-primary"
        type="submit"
        :disabled="isSavingSpamRetention || !store.spamRetentionLoaded || !spamRetentionDirty"
      >
        Save
      </button>
    </form>
    <p v-if="spamRetentionError" class="settings-error" role="alert">
      {{ spamRetentionError }}
    </p>
  </section>
</template>
