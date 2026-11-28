<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import { automationSection } from '../lib/automations'
import { lazyComponent } from '../router/chunkReload'

const AssistantChatPage = lazyComponent(() => import('../components/AssistantChatPage.vue'))
const AutomationsConnections = lazyComponent(
  () => import('../components/AutomationsConnections.vue'),
)
const AutomationsCreate = lazyComponent(() => import('../components/AutomationsCreate.vue'))
const AutomationsDashboard = lazyComponent(() => import('../components/AutomationsDashboard.vue'))
const AutomationsTemplates = lazyComponent(() => import('../components/AutomationsTemplates.vue'))

const route = useRoute()
const section = computed(() => automationSection(route.params.section))
</script>

<template>
  <!-- Dashboard greets and lists the automations and what they did,
       Connections explains how to connect an MCP client, Templates is a
       gallery of ideas, Chat is Cookie Assistant on a page of its own and
       Create Automation sets one up. -->
  <div class="automations-view" data-testid="automations-view">
    <AssistantChatPage v-if="section.id === 'chat'" />
    <AutomationsConnections v-else-if="section.id === 'connections'" />
    <AutomationsTemplates v-else-if="section.id === 'templates'" />
    <AutomationsCreate v-else-if="section.id === 'new'" />
    <AutomationsDashboard v-else />
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
</style>
