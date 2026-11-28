<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import { automationSection } from '../lib/automations'

const route = useRoute()
const section = computed(() => automationSection(route.params.section))
</script>

<template>
  <!-- Every Automations page is a titled, empty page for now. -->
  <div class="automations-view" data-testid="automations-view">
    <div class="automations-page">
      <h1>{{ section.label }}</h1>
    </div>
  </div>
</template>

<style scoped>
.automations-view {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.automations-page {
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
