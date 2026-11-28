<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import {
  AUTOMATION_SECTIONS,
  NEW_AUTOMATION_SECTION,
  automationRoute,
  automationSection,
} from '../lib/automations'

const route = useRoute()
const activeId = computed(() => automationSection(route.params.section).id)
</script>

<template>
  <aside class="left-sidebar automations-sidebar" aria-label="Automations sidebar">
    <router-link class="compose-btn" :to="automationRoute(NEW_AUTOMATION_SECTION)">
      <span class="material-symbols-outlined" aria-hidden="true">add</span>
      <span>{{ NEW_AUTOMATION_SECTION.label }}</span>
    </router-link>

    <nav class="sidebar-nav" aria-label="Automations">
      <router-link
        v-for="section in AUTOMATION_SECTIONS"
        :key="section.id"
        :to="automationRoute(section)"
        class="nav-item"
        :class="{ active: activeId === section.id }"
      >
        <span class="material-symbols-outlined" aria-hidden="true">{{ section.icon }}</span>
        <span class="nav-text">{{ section.label }}</span>
      </router-link>
    </nav>
  </aside>
</template>

<style scoped>
/* The shared button style is written for a <button>; as a link it needs its
   underline taken off. */
.compose-btn {
  text-decoration: none;
}
</style>
