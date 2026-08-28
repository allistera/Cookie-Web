<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import { getStoredExpandedIds, saveExpandedIds } from '../lib/documentsSidebarFolders'
import { flattenProjectTree } from '../lib/taskProjectsTree'
import { useProjectsStore } from '../stores/projects'

const EXPANDED_KEY = 'cookie-tasks-expanded-projects'

const route = useRoute()
const store = useProjectsStore()

// Which projects are open, persisted so a reload restores the same tree.
const expandedIds = ref(new Set(getStoredExpandedIds(EXPANDED_KEY)))
watch(expandedIds, (ids) => saveExpandedIds(EXPANDED_KEY, ids))

const rows = computed(() => flattenProjectTree(store.projects, expandedIds.value))

onMounted(() => store.loadProjects())

function toggle(id) {
  const next = new Set(expandedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedIds.value = next
}
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
        v-for="row in rows"
        :key="row.item.id"
        :to="{ path: '/tasks', query: { project: row.item.id } }"
        class="nav-item project-item"
        :class="{ active: route.query.project === row.item.id }"
        :style="{ paddingLeft: `${10 + row.depth * 14}px` }"
      >
        <button
          v-if="row.hasChildren"
          class="project-arrow"
          type="button"
          :aria-expanded="row.expanded"
          :aria-label="`${row.expanded ? 'Collapse' : 'Expand'} ${row.item.name}`"
          @click.prevent.stop="toggle(row.item.id)"
        >
          <span class="material-symbols-outlined" aria-hidden="true">
            {{ row.expanded ? 'keyboard_arrow_down' : 'keyboard_arrow_right' }}
          </span>
        </button>
        <span v-else class="project-arrow-spacer" aria-hidden="true"></span>
        <span class="project-symbol" aria-hidden="true"></span>
        <span class="nav-text">{{ row.item.name }}</span>
      </router-link>
      <p v-if="!rows.length" class="tasks-projects-empty">No projects yet</p>
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

/* A text marker rather than an icon: projects carry no colour or emoji, and
   the documents sidebar marks its tag rows exactly this way. The marker is
   generated content, not a text node, so a row's rendered text is just its
   project name. */
.project-symbol {
  width: 18px;
  flex: 0 0 auto;
  color: var(--text-secondary);
  font-size: 15px;
  text-align: center;
}

.project-symbol::before {
  content: '#';
}

.project-arrow,
.project-arrow-spacer {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  margin-left: -4px;
  border: none;
  background: none;
  padding: 0;
  color: inherit;
  cursor: pointer;
}

.project-arrow .material-symbols-outlined {
  font-size: 16px;
}

.tasks-projects-empty {
  margin: 0;
  padding: 2px 8px;
  font-size: 13px;
  color: var(--text-secondary);
}
</style>
