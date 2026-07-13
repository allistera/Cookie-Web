<script setup>
import { computed } from 'vue'
import { useInboxStore } from '../stores/inbox'

// Thin indeterminate bar fixed to the top of the viewport, visible while any
// email list fetch is in flight (initial load, refresh, search, sent view).
const store = useInboxStore()
const isLoading = computed(() => store.isRefreshing || store.isSentRefreshing)
</script>

<template>
  <Transition name="loading-bar-fade">
    <div v-if="isLoading" class="loading-bar" role="progressbar" aria-label="Loading emails">
      <div class="loading-bar-fill"></div>
    </div>
  </Transition>
</template>
