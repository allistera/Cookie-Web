<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
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

// Inline create row: null when hidden, '' for a root project, or a project id
// when adding a sub-project of it.
const newProjectFor = ref(null)
const newProjectName = ref('')
const newProjectInput = ref(null)

async function showNewProject(parentId) {
  newProjectFor.value = parentId ?? ''
  newProjectName.value = ''
  await nextTick()
  newProjectInput.value?.focus()
}

async function submitNewProject() {
  // Enter submits and unmounts the input, which fires blur; the second call
  // must be a no-op or every Enter would create the project twice.
  if (newProjectFor.value === null) return
  const name = newProjectName.value.trim()
  const parentId = newProjectFor.value === '' ? null : newProjectFor.value
  newProjectFor.value = null
  if (!name) return
  const created = await store.createProject({ name, parentId })
  if (!created) return
  if (parentId) expandedIds.value = new Set(expandedIds.value).add(parentId)
}

const renamingId = ref(null)
const renameName = ref('')
const renameInput = ref(null)

async function startRename(project) {
  renamingId.value = project.id
  renameName.value = project.name
  await nextTick()
  renameInput.value?.[0]?.focus?.()
  renameInput.value?.[0]?.select?.()
}

async function submitRename(project) {
  // Same Enter-then-blur double-fire as submitNewProject.
  if (renamingId.value !== project.id) return
  const name = renameName.value.trim()
  renamingId.value = null
  if (name && name !== project.name) await store.renameProject(project.id, name)
}

function childCount(id) {
  return store.projects.filter((project) => project.parentId === id).length
}

// The cascade is the one destructive edge here: sub-projects go with the
// parent and there is no undo endpoint, so name the count before doing it.
function removeProject(project) {
  const children = childCount(project.id)
  const plural = children === 1 ? 'sub-project' : 'sub-projects'
  if (children && !confirm(`Delete ${project.name} and its ${children} ${plural}?`)) return
  store.deleteProject(project.id)
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

    <div class="sb-section-label tasks-projects-label">
      <span>My Projects</span>
      <button
        class="new-project-btn"
        type="button"
        title="New project"
        aria-label="New project"
        @click.stop="showNewProject(null)"
      >
        <span class="material-symbols-outlined" aria-hidden="true">add</span>
      </button>
    </div>
    <nav class="sidebar-nav tasks-projects-nav" aria-label="My projects">
      <router-link
        v-for="row in rows"
        :key="row.item.id"
        :to="{ path: '/tasks', query: { project: row.item.id } }"
        class="nav-item project-item"
        :class="{ active: route.query.project === row.item.id }"
        :style="{ paddingLeft: `${10 + row.depth * 14}px` }"
        @dblclick.prevent="startRename(row.item)"
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
        <input
          v-if="renamingId === row.item.id"
          ref="renameInput"
          v-model="renameName"
          class="project-rename-input"
          :aria-label="`Rename ${row.item.name}`"
          @click.prevent.stop
          @keydown.enter.prevent="submitRename(row.item)"
          @keydown.escape="renamingId = null"
          @blur="submitRename(row.item)"
        />
        <span v-else class="nav-text">{{ row.item.name }}</span>
        <span class="row-actions" @click.prevent.stop>
          <button
            class="row-action-btn"
            data-action="add"
            :title="`New project in ${row.item.name}`"
            :aria-label="`New project in ${row.item.name}`"
            @click="showNewProject(row.item.id)"
          >
            <span class="material-symbols-outlined" aria-hidden="true">add</span>
          </button>
          <button
            class="row-action-btn"
            data-action="delete"
            :title="`Delete ${row.item.name}`"
            :aria-label="`Delete ${row.item.name}`"
            @click="removeProject(row.item)"
          >
            <span class="material-symbols-outlined" aria-hidden="true">delete</span>
          </button>
        </span>
      </router-link>
      <form v-if="newProjectFor !== null" class="new-project-row" @submit.prevent="submitNewProject">
        <input
          ref="newProjectInput"
          v-model="newProjectName"
          class="project-rename-input"
          placeholder="Project name"
          aria-label="New project name"
          @keydown.enter.prevent="submitNewProject"
          @keydown.escape="newProjectFor = null"
          @blur="submitNewProject"
        />
      </form>
      <p v-if="!rows.length && newProjectFor === null" class="tasks-projects-empty">
        No projects yet
      </p>
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

/* A text marker rather than an icon: projects carry no colour or emoji, the
   same idea the documents sidebar uses for its tag rows. Here it is rendered
   as generated content rather than a text node, so a row's rendered text
   stays just its project name. */
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

.tasks-projects-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.new-project-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  margin: -5px -4px -5px 0;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--text-secondary);
  padding: 0;
  cursor: pointer;
}

.new-project-btn:hover,
.new-project-btn:focus-visible {
  background-color: var(--bg-hover);
  color: var(--text-primary);
  outline: none;
}

/* Hidden by opacity, not display: display-none rows became unreachable to
   assistive tech and to WebKit hit testing in the documents sidebar. */
.project-item .row-actions {
  display: inline-flex;
  margin-left: auto;
  gap: 2px;
  opacity: 0;
}

.project-item:hover .row-actions,
.project-item:focus-within .row-actions {
  opacity: 1;
}

.row-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  overflow: hidden;
  flex-shrink: 0;
  border: none;
  background: none;
  padding: 1px;
  cursor: pointer;
  color: inherit;
  opacity: 0.65;
  border-radius: 4px;
}

.row-action-btn:hover {
  opacity: 1;
}

.row-action-btn .material-symbols-outlined {
  font-size: 15px;
}

.new-project-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
}

.project-rename-input {
  flex: 1;
  min-width: 0;
  font: inherit;
  color: inherit;
  background: transparent;
  border: 1px solid currentColor;
  border-radius: 4px;
  padding: 1px 4px;
}
</style>
