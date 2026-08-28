<script setup>
import { ref } from 'vue'
import { useRoute } from 'vue-router'

import { useInboxStore } from '../stores/inbox'

const route = useRoute()

// Same chunking constraint TasksView documents: a lazily-loaded Tasks chunk
// that touches no store makes Rolldown fold the shared pinia/auth0 chunk into
// the entry bundle, blowing the entry-chunk budget the build enforces. The
// store will be needed here as soon as projects have a backing source.
useInboxStore()

// Projects have no API yet — the tasks worker only serves gathered tasks, with
// no project or list concept behind them. The section renders off this list so
// wiring it to a store later is a one-line swap; until then it stays empty and
// the sidebar shows the empty hint. Inbox is deliberately not in here: it is
// the no-project bucket rather than a project of its own.
const projects = ref([])
</script>

<template>
  <aside class="left-sidebar tasks-sidebar" aria-label="Tasks sidebar">
    <!-- No create flow exists yet (the tasks API has no create endpoint), so
       the button is the shell the handler lands in. -->
    <button class="compose-btn" type="button">
      <span class="material-symbols-outlined" aria-hidden="true">add_task</span>
      <span>Add Task</span>
    </button>

    <!-- Inbox is a rule, not a project: it names the tasks that belong to no
       project, so there is no row behind it to rename, recolour or delete.
       It sits above My Projects, unlabelled, because it is not one of them. -->
    <nav class="sidebar-nav tasks-views-nav" aria-label="Task views">
      <router-link
        :to="{ path: '/tasks', query: { project: 'inbox' } }"
        class="nav-item"
        :class="{ active: route.query.project === 'inbox' }"
      >
        <span class="material-symbols-outlined nav-icon-red" aria-hidden="true">inbox</span>
        <span class="nav-text">Inbox</span>
      </router-link>
    </nav>

    <div class="sb-section-label">My Projects</div>
    <nav class="sidebar-nav tasks-projects-nav" aria-label="My projects">
      <router-link
        v-for="project in projects"
        :key="project.id"
        :to="{ path: '/tasks', query: { project: project.id } }"
        class="nav-item"
        :class="{ active: route.query.project === project.id }"
      >
        <span class="material-symbols-outlined" :style="{ color: project.color }">tag</span>
        <span class="nav-text">{{ project.name }}</span>
        <span class="nav-badge" v-if="project.count">{{ project.count }}</span>
      </router-link>
      <p v-if="!projects.length" class="tasks-projects-empty">No projects yet</p>
    </nav>
  </aside>
</template>

<style scoped>
/* Long project names truncate so a badge never overflows the sidebar. */
.tasks-sidebar .nav-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tasks-projects-empty {
  margin: 0;
  padding: 2px 8px;
  font-size: 13px;
  color: var(--text-secondary);
}
</style>
