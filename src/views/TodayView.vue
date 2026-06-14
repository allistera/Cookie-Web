<script setup>
import { useFeedStore } from '@/stores/feed.js'
import FeedItem from '@/components/FeedItem.vue'
import CkIcon from '@/components/ui/CkIcon.vue'

const feed = useFeedStore()

const today = 'Thursday, June 12'
</script>

<template>
  <div class="feed">
    <div class="feed__head">
      <div class="feed__eyebrow cookie-eyebrow">Today · {{ today }}</div>
      <h1 class="feed__title">
        <em v-if="feed.items.length">{{ feed.items.length }} things</em>
        <template v-if="feed.items.length"> need you today</template>
        <template v-else>You're all caught up</template>
      </h1>
      <p class="feed__sub">
        <template v-if="feed.items.length">
          Cookie pulled these from your inbox, docs, and calendar — and handled the rest.
        </template>
        <template v-else> Cookie's watching the rest. We'll surface anything that needs you. </template>
      </p>
    </div>

    <FeedItem v-for="item in feed.items" :key="item.id" :item="item" />

    <div
      v-if="!feed.items.length"
      class="ck-empty"
      style="background: var(--surface-card); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg)"
    >
      <span class="ck-empty__icon"><CkIcon name="check" :size="24" /></span>
      <div class="ck-empty__title">Inbox zero, the calm way</div>
      <p class="ck-empty__text">Nothing needs you right now. Cookie has drafted, scheduled, and filed everything else.</p>
    </div>
  </div>
</template>
