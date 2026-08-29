<script setup>
import { computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'

import { useProjectsStore } from '../stores/projects'
import { useTaskItemsStore } from '../stores/taskItems'

const route = useRoute()
const projects = useProjectsStore()
const items = useTaskItemsStore()

// 'inbox' is a filter, not a project id — the Inbox is the tasks that belong
// to no project, so there is no row to look up.
const project = computed(() => String(route.query.project ?? 'inbox'))
const isInbox = computed(() => project.value === 'inbox')
const current = computed(() =>
  isInbox.value ? null : projects.projects.find((row) => row.id === project.value),
)
const ancestors = computed(() =>
  isInbox.value ? [] : projects.ancestorsOf(project.value).slice(0, -1),
)
const title = computed(() => (isInbox.value ? 'Inbox' : (current.value?.name ?? '')))

onMounted(() => {
  projects.loadProjects()
  items.loadItems(project.value)
})

watch(project, (next) => items.loadItems(next))
</script>

<template>
  <div class="view-panel active tasks-view">
    <nav class="tasks-breadcrumb" aria-label="Breadcrumb">
      <span>My Projects</span>
      <template v-for="ancestor in ancestors" :key="ancestor.id">
        <span aria-hidden="true">/</span>
        <router-link :to="{ path: '/tasks', query: { project: ancestor.id } }">
          {{ ancestor.name }}
        </router-link>
      </template>
      <span aria-hidden="true">/</span>
    </nav>

    <h1 class="tasks-title">{{ title }}</h1>

    <p v-if="!isInbox" class="tasks-description">
      {{ current?.description || 'Add a description' }}
    </p>
  </div>
</template>

<style scoped>
.tasks-view {
  max-width: 720px;
  margin: 0 auto;
  padding: 32px 24px;
}

.tasks-breadcrumb {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-secondary);
}

.tasks-breadcrumb a {
  color: inherit;
  text-decoration: none;
}

.tasks-breadcrumb a:hover {
  color: var(--text-primary);
}

.tasks-title {
  margin: 18px 0 6px;
  font-size: 26px;
  font-weight: 700;
}

.tasks-description {
  margin: 0 0 24px;
  color: var(--text-secondary);
  font-size: 14px;
  cursor: text;
}
</style>
