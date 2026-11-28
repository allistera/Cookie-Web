<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import { automationSection } from '../lib/automations'
import { lazyComponent } from '../router/chunkReload'

const AssistantChatPage = lazyComponent(() => import('../components/AssistantChatPage.vue'))
const AutomationsConnections = lazyComponent(
  () => import('../components/AutomationsConnections.vue'),
)
const AutomationsDashboard = lazyComponent(() => import('../components/AutomationsDashboard.vue'))
const AutomationsTemplates = lazyComponent(() => import('../components/AutomationsTemplates.vue'))

const route = useRoute()
const section = computed(() => automationSection(route.params.section))
</script>

<template>
  <!-- Dashboard greets and lists what the automations did, Connections
       explains how to connect an MCP client, Templates is a gallery of ideas
       and Chat is Cookie Assistant on a page of its own. Create Automation is
       a titled, empty page for now. -->
  <div class="automations-view" data-testid="automations-view">
    <AssistantChatPage v-if="section.id === 'chat'" />
    <AutomationsConnections v-else-if="section.id === 'connections'" />
    <AutomationsTemplates v-else-if="section.id === 'templates'" />
    <AutomationsDashboard v-else-if="section.id === 'dashboard'" />
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
