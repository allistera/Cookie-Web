<script setup>
import { ref, watch } from 'vue'
import { useSendersStore } from '../stores/senders'
import { useInboxStore } from '../stores/inbox'
const store = useSendersStore()
const inbox = useInboxStore()
const address = ref('')
const decision = ref('accept')
async function change(body) {
  if (await store.update(body)) {
    address.value = ''
    await inbox.refreshSenderMail()
  }
}
watch(
  () => store.ownerSub,
  () => {
    address.value = ''
    decision.value = 'accept'
    void store.load()
  },
  { immediate: true },
)
</script>

<template>
  <section class="sender-settings">
    <h3>Senders and screening</h3>
    <p>
      Only addresses you explicitly Accept are known senders. Past incoming mail, contacts and sent
      mail do not automatically grant trust. Addresses match exactly after trimming spaces and
      ignoring letter case; aliases, plus-addresses and domains are not grouped.
    </p>
    <label class="sender-toggle"
      ><input
        type="checkbox"
        :checked="store.enabled"
        :disabled="!store.loaded || store.saving"
        @change="change({ action: 'settings', enabled: $event.target.checked })"
      />
      Screen unknown senders (off by default)</label
    >
    <p>
      New unknown mail waits in
      <router-link to="/inbox?filter=screening">New senders</router-link> for Accept or Block.
      Turning screening off only changes future arrivals; already-held mail stays reviewable.
    </p>
    <p>
      <router-link to="/inbox?filter=blocked">Blocked mail</router-link> is recoverable and kept
      until you delete it. Neither review folder is subject to Spam retention, even when the
      classifier considers a held message spam.
    </p>
    <p>
      Blocking takes precedence over screening and classification. Acceptance bypasses screening
      only; spam decisions, labels, read state, snooze and archive rules remain. Review folders show
      held mail even when a rule archives it. Restored mail returns according to those existing
      flags, with no delayed alerts or automatic replies.
    </p>
    <p>
      Blocking does not unsubscribe, reject delivery or change your original forwarding. An alert or
      reply already handed off cannot be recalled.
    </p>
    <form @submit.prevent="change({ action: decision, address })">
      <label
        >Exact email address<input
          v-model="address"
          type="email"
          required
          maxlength="320"
          placeholder="person@example.com"
      /></label>
      <label
        >Decision<select v-model="decision">
          <option value="accept">Accept sender</option>
          <option value="block">Block sender</option>
        </select></label
      >
      <button class="btn btn-primary" :disabled="!store.loaded || store.saving">Save sender</button>
    </form>
    <p>
      Blocking from this list applies to future arrivals and already-held mail. Use Block sender in
      the reader to move a particular existing message too. Unblock removes the block; with
      screening enabled its held mail returns to New senders. Accept releases all held mail from
      that address.
    </p>
    <p v-if="store.error" role="alert">{{ store.error }}</p>
    <button
      class="btn btn-secondary"
      :disabled="store.loading || store.saving"
      @click="store.load()"
    >
      Reload senders
    </button>
    <p v-if="store.loading" role="status">Loading senders…</p>
    <p v-else-if="store.loaded && !store.decisions.length">No saved sender decisions.</p>
    <ul>
      <li v-for="entry in store.decisions" :key="entry.address">
        <span>{{ entry.address }} — {{ entry.decision }}</span>
        <button
          class="btn btn-secondary"
          :disabled="store.saving"
          @click="
            change({
              action: entry.decision === 'blocked' ? 'unblock' : 'forget',
              address: entry.address,
            })
          "
        >
          {{ entry.decision === 'blocked' ? 'Unblock' : 'Remove acceptance' }}
        </button>
        <button
          v-if="entry.decision === 'blocked'"
          class="btn btn-secondary"
          :disabled="store.saving"
          @click="change({ action: 'accept', address: entry.address })"
        >
          Accept and release
        </button>
        <button
          v-else
          class="btn btn-secondary"
          :disabled="store.saving"
          @click="change({ action: 'block', address: entry.address })"
        >
          Block
        </button>
      </li>
    </ul>
    <button
      v-if="store.nextCursor"
      class="btn btn-secondary"
      :disabled="store.loading || store.saving"
      @click="store.load({ more: true })"
    >
      Load more senders
    </button>
  </section>
</template>

<style scoped>
.sender-settings {
  max-width: 760px;
}
p {
  line-height: 1.6;
  color: var(--text-secondary);
  margin: 14px 0;
}
form {
  display: flex;
  align-items: end;
  flex-wrap: wrap;
  gap: 14px;
  margin: 20px 0;
}
label {
  display: grid;
  gap: 8px;
}
.sender-toggle {
  display: flex;
  align-items: center;
  gap: 10px;
}
input:not([type='checkbox']),
select {
  padding: 10px;
  background: var(--bg-primary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  font: inherit;
}
ul {
  list-style: none;
  padding: 0;
}
li {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  padding: 12px 0;
  border-bottom: 1px solid var(--border-color);
}
li span {
  flex: 1;
  overflow-wrap: anywhere;
}
</style>
