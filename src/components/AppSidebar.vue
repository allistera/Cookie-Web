<script setup>
import { useRouter, useRoute } from 'vue-router'
import { useFeedStore } from '@/stores/feed.js'
import CkIcon from './ui/CkIcon.vue'
import CkAvatar from './ui/CkAvatar.vue'
import CkIconBtn from './ui/CkIconBtn.vue'

const router = useRouter()
const route = useRoute()
const feed = useFeedStore()

const nav = [
  { id: 'today', icon: 'sparkles', label: 'Today' },
  { id: 'digest', icon: 'layers', label: 'Digest' },
  { id: 'calendar', icon: 'calendar', label: 'Calendar' },
  { id: 'sent', icon: 'send', label: 'Sent' },
]

function isActive(id) {
  return route.name === id
}
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar__logo">
      <img src="/cookie-horizontal-cream.png" alt="Cookie" />
    </div>

    <nav class="nav">
      <button
        v-for="item in nav"
        :key="item.id"
        class="nav__item"
        :class="{ 'nav__item--active': isActive(item.id) }"
        @click="router.push({ name: item.id })"
      >
        <CkIcon :name="item.icon" :size="17" />
        <span>{{ item.label }}</span>
        <span v-if="item.id === 'today' && feed.replyCount" class="count">{{ feed.replyCount }}</span>
      </button>
    </nav>

    <div class="sidebar__user">
      <CkAvatar name="Allister Antosik" size="sm" tone="var(--forest-600)" />
      <div style="flex: 1">
        <div class="nm">Allister Antosik</div>
      </div>
      <CkIconBtn name="settings" label="Settings" @click="router.push({ name: 'settings' })" />
    </div>
  </aside>
</template>
