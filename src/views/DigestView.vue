<script setup>
import { computed } from 'vue'
import { useFeedStore } from '@/stores/feed.js'
import FeedItem from '@/components/FeedItem.vue'
import CkIcon from '@/components/ui/CkIcon.vue'

const feed = useFeedStore()
const digests = computed(() => feed.items.filter((i) => i.kind === 'digest'))

const today = 'Thursday, June 12'
</script>

<template>
  <div class="feed">
    <div class="feed__head">
      <div class="feed__eyebrow cookie-eyebrow">Digest · {{ today }}</div>
      <h1 class="feed__title">
        <em v-if="digests.length">{{ digests.length }} digest{{ digests.length !== 1 ? 's' : '' }}</em>
        <template v-if="digests.length"> to review</template>
        <template v-else>All caught up</template>
      </h1>
      <p class="feed__sub">Condensed updates from your docs and shared workspaces.</p>
    </div>

    <FeedItem v-for="item in digests" :key="item.id" :item="item" />

    <div
      v-if="!digests.length"
      class="ck-empty"
      style="background: var(--surface-card); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg)"
    >
      <span class="ck-empty__icon"><CkIcon name="layers" :size="24" /></span>
      <div class="ck-empty__title">No digests today</div>
      <p class="ck-empty__text">Cookie will surface condensed updates when your docs and workspaces change.</p>
    </div>
  </div>
</template>
