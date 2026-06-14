<script setup>
import { ref, watch } from 'vue'
import { useFeedStore } from '@/stores/feed.js'
import CkAvatar from './ui/CkAvatar.vue'
import CkBadge from './ui/CkBadge.vue'
import CkBtn from './ui/CkBtn.vue'
import CkIcon from './ui/CkIcon.vue'
import CkIconBtn from './ui/CkIconBtn.vue'
import CkSwitch from './ui/CkSwitch.vue'
import CkTag from './ui/CkTag.vue'

const feed = useFeedStore()

const text = ref('')
const applyRules = ref(true)

watch(
  () => feed.activeItem,
  (item) => {
    if (item) text.value = item.draft ?? ''
  },
)
</script>

<template>
  <div :class="['scrim', { 'scrim--open': feed.composerOpen }]" @click="feed.closeReply()" />

  <div :class="['drawer', { 'drawer--open': feed.composerOpen }]" :aria-hidden="!feed.composerOpen">
    <template v-if="feed.activeItem">
      <div class="drawer__head">
        <CkAvatar :name="feed.activeItem.org" square size="md" tone="var(--forest-700)" />
        <div style="flex: 1">
          <div class="drawer__title">Reply to {{ feed.activeItem.from }}</div>
          <div class="item__src">{{ feed.activeItem.subject }}</div>
        </div>
        <CkIconBtn name="x" label="Close" @click="feed.closeReply()" />
      </div>

      <div class="drawer__body">
        <div class="thread">
          <div class="cookie-eyebrow" style="margin-bottom: 8px">Cookie condensed the thread</div>
          <ul class="points" style="margin-top: 0">
            <li v-for="(point, i) in feed.activeItem.points" :key="i">{{ point }}</li>
          </ul>
        </div>

        <div>
          <div class="label-row">
            <span class="field-label">Draft reply</span>
            <CkBadge tone="signal"><CkIcon name="sparkles" :size="12" />&nbsp;Written in your tone</CkBadge>
          </div>
          <textarea v-model="text" class="composer-area" />
        </div>

        <div>
          <div class="label-row">
            <span class="field-label">Rules applied</span>
            <CkSwitch v-model="applyRules" />
          </div>
          <div class="rules" :style="{ opacity: applyRules ? 1 : 0.4 }">
            <CkTag v-for="(rule, i) in feed.activeItem.rules" :key="i">{{ rule }}</CkTag>
          </div>
        </div>
      </div>

      <div class="drawer__foot">
        <CkBtn variant="ghost" icon-left="rotate-ccw">Regenerate</CkBtn>
        <span style="flex: 1" />
        <CkBtn variant="outline" @click="feed.closeReply()">Cancel</CkBtn>
        <CkBtn variant="primary" icon-left="send" @click="feed.send(feed.activeItem)">Send reply</CkBtn>
      </div>
    </template>
  </div>
</template>
