<script setup>
import { useFeedStore } from '@/stores/feed.js'
import CkAvatar from './ui/CkAvatar.vue'
import CkBadge from './ui/CkBadge.vue'
import CkBtn from './ui/CkBtn.vue'
import CkCard from './ui/CkCard.vue'
import CkIcon from './ui/CkIcon.vue'

defineProps({
  item: { type: Object, required: true },
})

const feed = useFeedStore()
</script>

<template>
  <CkCard :accent="item.kind === 'reply'" class="item">
    <div class="item__top">
      <CkAvatar
        :name="item.org"
        square
        size="md"
        :tone="item.kind === 'event' ? 'var(--signal-500)' : 'var(--forest-700)'"
      />
      <div class="item__meta">
        <div class="item__row">
          <span class="item__from">{{ item.from }}</span>
          <span class="item__src">{{ item.source }}</span>
          <span style="flex: 1" />
          <span class="item__time">{{ item.time }}</span>
        </div>
        <div class="item__subject">{{ item.subject }}</div>
      </div>
    </div>

    <ul class="points">
      <li v-for="(point, i) in item.points" :key="i">{{ point }}</li>
    </ul>

    <div class="item__actions">
      <CkBadge v-if="item.kind === 'reply'" tone="signal">Reply ready</CkBadge>
      <CkBadge v-else-if="item.kind === 'digest'" tone="info">{{ item.points.length }} key points</CkBadge>
      <CkBadge v-else tone="success" dot>Auto-scheduled</CkBadge>

      <span v-if="item.when" class="when-chip">
        <CkIcon name="clock" :size="13" />{{ item.when }}
      </span>

      <span class="spacer" />

      <template v-if="item.kind === 'reply'">
        <CkBtn variant="ghost" size="sm" @click="feed.dismiss(item.id)">Snooze</CkBtn>
        <CkBtn variant="primary" size="sm" icon-left="pencil" @click="feed.openReply(item)">Review reply</CkBtn>
      </template>

      <template v-else-if="item.kind === 'digest'">
        <CkBtn variant="outline" size="sm" icon-right="arrow-right" @click="feed.dismiss(item.id)">Mark read</CkBtn>
      </template>

      <template v-else>
        <CkBtn variant="ghost" size="sm" @click="feed.dismiss(item.id)">Reschedule</CkBtn>
        <CkBtn variant="accent" size="sm" icon-left="check" @click="feed.dismiss(item.id)">Keep it</CkBtn>
      </template>
    </div>
  </CkCard>
</template>
