<script setup>
import { ref } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()

// Projects have no API yet — the tasks worker only serves gathered tasks, with
// no project or list concept behind them. The section renders off this list so
// wiring it to a store later is a one-line swap; until then it stays empty and
// the sidebar shows the empty hint.
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
