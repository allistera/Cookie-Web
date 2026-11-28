<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import { automationSection } from '../lib/automations'
import { lazyComponent } from '../router/chunkReload'

const AssistantChatPage = lazyComponent(() => import('../components/AssistantChatPage.vue'))

const route = useRoute()
const section = computed(() => automationSection(route.params.section))
</script>

<template>
  <!-- Chat is Cookie Assistant on a page of its own; every other Automations
       page is a titled, empty page for now. -->
  <div class="automations-view" data-testid="automations-view">
    <AssistantChatPage v-if="section.id === 'chat'" />
    <div v-else class="automations-page">
      <h1>{{ section.label }}</h1>
    </div>
  </div>
</template>

<style scoped>
.automations-view {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.automations-page {
  width: 100%;
  max-width: 760px;
  margin: 0 auto;
  padding: 32px 24px;
}

.automations-page h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
}
</style>
