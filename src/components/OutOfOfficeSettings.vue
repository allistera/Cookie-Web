<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useOutOfOfficeStore } from '../stores/outOfOffice'
import {
  localDate,
  outOfOfficeDraft,
  outOfOfficeError,
  outOfOfficeStatus,
} from '../lib/outOfOffice'

const store = useOutOfOfficeStore()
const draft = reactive(outOfOfficeDraft(store.document))
const touched = ref(false)
const now = ref(Date.now())
const saved = ref(false)
const timer = setInterval(() => {
  now.value = Date.now()
}, 30_000)
onUnmounted(() => clearInterval(timer))
const status = computed(() => outOfOfficeStatus(store.document, now.value))
const validation = computed(() => outOfOfficeError(draft))
const timeZones = ['UTC', ...Intl.supportedValuesOf('timeZone')]
function markTouched() {
  touched.value = true
  saved.value = false
}
function resetDraft() {
  Object.assign(draft, outOfOfficeDraft(store.document))
  if (!draft.startDate) {
    draft.timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    draft.startDate = draft.endDate = localDate(Date.now(), draft.timeZone)
  }
  touched.value = false
  saved.value = false
}
watch(
  () => store.document,
  () => {
    if (!touched.value) resetDraft()
  },
)
watch(() => store.ownerSub, resetDraft)
async function reload() {
  if (await store.load({ force: true })) {
    store.conflict = false
    store.error = ''
    resetDraft()
  }
}
async function save() {
  if (validation.value || store.conflict) return
  if (await store.save(outOfOfficeDraft(draft))) {
    resetDraft()
    saved.value = true
  }
}
async function stop() {
  if (await store.stop()) resetDraft()
}
onMounted(async () => {
  await store.load()
  resetDraft()
})
</script>

<template>
  <section class="out-of-office-settings" data-testid="out-of-office-settings">
    <h3>Out of office</h3>
    <p>Send a reviewed automatic reply to eligible new mail while you are away. Off by default.</p>
    <p role="status" class="ooo-status">
      Current status: <strong>{{ status }}</strong>
    </p>
    <button
      v-if="store.document.enabled"
      class="btn btn-secondary"
      :disabled="store.saving"
      @click="stop"
    >
      End now
    </button>
    <p>
      End now stops future dispatches. A reply already handed to the mail provider may still arrive.
    </p>
    <p v-if="!store.loaded" role="status">
      {{ store.loading ? 'Loading settings…' : 'Settings are unavailable.' }}
    </p>
    <form @submit.prevent="save" @input="markTouched">
      <fieldset :disabled="!store.loaded || store.saving">
        <label class="ooo-toggle"
          ><input v-model="draft.enabled" type="checkbox" /> Enable automatic replies</label
        >
        <div class="ooo-dates">
          <label>Start date<input v-model="draft.startDate" type="date" required /></label>
          <label
            >End date (inclusive)<input
              v-model="draft.endDate"
              type="date"
              :min="draft.startDate"
              required
          /></label>
        </div>
        <label>Timezone<input v-model="draft.timeZone" list="ooo-timezones" required /></label>
        <datalist id="ooo-timezones">
          <option v-for="zone in timeZones" :key="zone" :value="zone" />
        </datalist>
        <label
          >Reply subject<input v-model="draft.subject" type="text" maxlength="998" required
        /></label>
        <label
          >Reply message<textarea v-model="draft.text" rows="7" maxlength="10000" required />
        </label>
      </fieldset>
      <p>
        Both dates use the selected timezone. Saving an edit starts a new revision for mail received
        after that save.
      </p>
      <div class="ooo-preview" aria-label="Automatic reply preview">
        <h4>Preview</h4>
        <strong>{{ draft.subject || 'Reply subject' }}</strong>
        <pre>{{ draft.text || 'Your plain-text reply will appear here.' }}</pre>
      </div>
      <p>
        Replies use Cookie’s configured sending address and the incoming envelope sender. Spam,
        bulk/list mail, automated replies, self-mail and screened mail are excluded. Each sender
        receives at most one reply every four days. Mail addressed only by Bcc is excluded.
        Processing can take several minutes.
      </p>
      <p v-if="touched && validation" role="alert">{{ validation }}</p>
      <p v-if="store.error" role="alert">{{ store.error }}</p>
      <div class="ooo-actions">
        <button
          class="btn btn-primary"
          type="submit"
          :disabled="!store.loaded || store.saving || !touched || !!validation || store.conflict"
        >
          {{ store.saving ? 'Saving…' : 'Save out of office' }}
        </button>
        <button
          class="btn btn-secondary"
          type="button"
          :disabled="store.loading || store.saving"
          @click="reload"
        >
          {{ touched ? 'Discard edits and load latest' : 'Reload settings' }}
        </button>
      </div>
      <p v-if="saved" role="status">Out-of-office settings saved.</p>
    </form>
    <section
      v-if="store.document.review?.length"
      class="ooo-review"
      aria-label="Replies needing review"
    >
      <h4>Replies needing review</h4>
      <p>
        Cookie has stopped retries for these replies. Check the provider’s delivery history, then
        record the verified result below. These actions never resend a reply.
      </p>
      <article v-for="delivery in store.document.review" :key="delivery.id">
        <strong>{{ delivery.recipient }}</strong>
        <p>
          {{
            delivery.status === 'uncertain'
              ? 'Delivery could not be confirmed.'
              : 'The provider rejected this reply.'
          }}
        </p>
        <p v-if="delivery.status === 'uncertain'">
          Further replies to this sender are paused until you resolve this.
        </p>
        <div class="ooo-actions">
          <button
            class="btn btn-secondary"
            :disabled="store.saving"
            @click="store.resolve(delivery.id, 'delivered')"
          >
            Verified delivered
          </button>
          <button
            class="btn btn-secondary"
            :disabled="store.saving"
            @click="store.resolve(delivery.id, 'not_delivered')"
          >
            Verified not delivered
          </button>
        </div>
      </article>
    </section>
  </section>
</template>

<style scoped>
.out-of-office-settings {
  max-width: 680px;
}
.out-of-office-settings p {
  line-height: 1.55;
  color: var(--text-secondary);
  margin: 12px 0;
}
fieldset {
  border: 0;
  padding: 0;
  margin: 20px 0;
  display: grid;
  gap: 18px;
}
label {
  display: grid;
  gap: 7px;
  font-weight: 500;
}
.ooo-toggle {
  display: flex;
  align-items: center;
  gap: 10px;
}
input:not([type='checkbox']),
textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font: inherit;
}
textarea {
  resize: vertical;
}
.ooo-dates {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.ooo-preview,
.ooo-review article {
  padding: 18px;
  margin: 20px 0;
  border: 1px solid var(--border-color);
  border-radius: 10px;
}
.ooo-preview h4 {
  margin: 0 0 14px;
}
.ooo-preview pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: inherit;
  line-height: 1.55;
}
.ooo-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
@media (max-width: 480px) {
  .ooo-dates {
    grid-template-columns: 1fr;
  }
}
</style>
