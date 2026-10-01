<script setup>
import { computed, ref, watch } from 'vue'
import { useInboxStore } from '../stores/inbox'
import { normalizeSender, useSendersStore } from '../stores/senders'

const props = defineProps({ email: { type: Object, required: true } })
const emit = defineEmits(['changed'])
const store = useSendersStore()
const inbox = useInboxStore()
const address = computed(() => normalizeSender(props.email.address))
const ready = ref(false)
const decision = computed(() => store.known[address.value])
const withheld = computed(() => ['held', 'blocked'].includes(props.email.screeningStatus))
let lookupRequest = 0
async function reloadDecision() {
  const request = ++lookupRequest
  ready.value = false
  const result = await store.lookup(address.value)
  if (request === lookupRequest) ready.value = result
}
watch([address, () => store.ownerSub], reloadDecision, { immediate: true })
async function act(action) {
  const id = props.email.id
  if (!(await store.update({ action, address: address.value, messageId: id }))) return
  // A domain decision also moves other senders' held mail on that domain;
  // say so, as those emails leave the list too.
  const related = store.lastRelated
  if (related.length) {
    const verb = action === 'block' ? 'blocked' : 'accepted'
    const shown = related.slice(0, 2).join(', ')
    const more = related.length > 2 ? ` and ${related.length - 2} more` : ''
    inbox.notify(`Also ${verb} ${shown}${more} on the same domain.`)
  }
  emit('changed')
}
</script>

<template>
  <details class="sender-controls" :open="withheld" @keydown.stop @click.stop>
    <summary>
      {{
        withheld
          ? email.screeningStatus === 'blocked'
            ? 'Blocked sender'
            : 'Review new sender'
          : 'Sender controls'
      }}
    </summary>
    <p>
      <strong>{{ address }}</strong>
    </p>
    <p v-if="withheld">
      This message is held without alerts or automatic replies. Read, archive and spam decisions are
      preserved when it is released.
    </p>
    <p v-else>
      Block this sender's domain to move this message to Blocked and hold future arrivals from it.
      Public email providers (gmail.com and similar) block only this exact address. Older ordinary
      mail stays where it is.
    </p>
    <p>
      Accepted senders bypass new-sender screening for their whole domain (or just this address on a
      public email provider); independent spam protection still applies. Original forwarding is
      unchanged.
    </p>
    <div class="sender-actions">
      <button
        v-if="decision === 'blocked'"
        class="btn btn-secondary"
        :disabled="!ready || store.saving"
        @click="act('unblock')"
      >
        Unblock sender
      </button>
      <button
        v-else
        class="btn btn-secondary"
        :disabled="!ready || store.saving"
        @click="act('block')"
      >
        Block sender
      </button>
      <button
        v-if="decision !== 'accepted'"
        class="btn btn-primary"
        :disabled="!ready || store.saving"
        @click="act('accept')"
      >
        Accept sender
      </button>
      <button
        v-if="email.screeningStatus === 'held' && decision !== 'blocked'"
        class="btn btn-secondary"
        :disabled="store.saving"
        @click="act('restore')"
      >
        Restore this message only
      </button>
    </div>
    <p v-if="decision === 'blocked'">
      Unblock removes the decision. If screening is on, this sender’s held mail returns to New
      senders; Accept releases it.
    </p>
    <p v-if="decision === 'accepted'">
      Accepted sender. Manage accepted and blocked addresses in
      <router-link to="/settings/senders">Settings</router-link>.
    </p>
    <p v-if="!ready">
      Sender decision unavailable.
      <button class="btn btn-secondary" @click="reloadDecision">Retry</button>
    </p>
    <p v-if="store.error" role="alert">{{ store.error }}</p>
  </details>
</template>

<style scoped>
.sender-controls {
  margin: 12px 0;
  padding: 14px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
}
summary {
  cursor: pointer;
  font-weight: 600;
}
p {
  margin: 10px 0;
  color: var(--text-secondary);
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.sender-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
