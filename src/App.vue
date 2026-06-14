<script setup>
import { useFeedStore } from '@/stores/feed.js'
import AppSidebar from '@/components/AppSidebar.vue'
import ReplyComposer from '@/components/ReplyComposer.vue'
import CkIcon from '@/components/ui/CkIcon.vue'
import CkToast from '@/components/ui/CkToast.vue'

const feed = useFeedStore()
</script>

<template>
  <div class="app">
    <AppSidebar />

    <div class="main">
      <div class="topbar">
        <div class="topbar__search">
          <CkIcon name="search" :size="16" />
          Search everything Cookie has read…
        </div>
      </div>

      <div class="scroll">
        <RouterView />
      </div>

      <ReplyComposer />

      <div :class="['toast-region', { 'toast-region--hidden': !feed.toast }]">
        <CkToast
          v-if="feed.toast"
          :icon="feed.toast.icon"
          :title="feed.toast.title"
          :message="feed.toast.message"
          @close="feed.toast = null"
        />
      </div>
    </div>
  </div>
</template>
