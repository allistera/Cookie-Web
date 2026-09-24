<script setup>
import { computed, onUnmounted, ref } from 'vue'
import { useOutOfOfficeStore } from '../stores/outOfOffice'
import { outOfOfficeStatus } from '../lib/outOfOffice'

const store = useOutOfOfficeStore()
const now = ref(Date.now())
const timer = setInterval(() => {
  now.value = Date.now()
}, 30_000)
onUnmounted(() => clearInterval(timer))
const active = computed(() => outOfOfficeStatus(store.document, now.value) === 'active')
</script>

<template>
  <aside
    v-if="active || store.document.review?.length"
    class="ooo-banner"
    aria-label="Out-of-office status"
  >
    <span v-if="active" role="status"
      >Out of office is active through {{ store.document.endDate }} ({{
        store.document.timeZone
      }}).</span
    >
    <span v-else role="status">An automatic reply needs delivery review.</span>
    <router-link to="/settings/out-of-office">{{
      store.document.review?.length ? 'Review replies and settings' : 'Settings'
    }}</router-link>
    <button v-if="active" class="btn btn-secondary" :disabled="store.saving" @click="store.stop()">
      End now
    </button>
    <span v-if="store.error" role="alert">{{ store.error }}</span>
  </aside>
</template>

<style scoped>
.ooo-banner {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  padding: 10px 24px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 14px;
}
.ooo-banner > span:first-child {
  flex: 1;
}
.ooo-banner a {
  color: var(--text-primary);
  text-decoration: underline;
}
</style>
