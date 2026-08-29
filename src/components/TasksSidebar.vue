<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import AddTaskDialog from './AddTaskDialog.vue'
import { getStoredExpandedIds, saveExpandedIds } from '../lib/documentsSidebarFolders'
import { flattenProjectTree } from '../lib/taskProjectsTree'
import { useProjectsStore } from '../stores/projects'
import { useTaskItemsStore } from '../stores/taskItems'

const EXPANDED_KEY = 'cookie-tasks-expanded-projects'

// Add Task is reachable from any Tasks view, so its dialog lives here beside
// the button rather than in whichever view happens to be on screen.
const addingTask = ref(false)

const route = useRoute()
const router = useRouter()
const store = useProjectsStore()
const taskItems = useTaskItemsStore()

// Which projects are open, persisted so a reload restores the same tree.
const expandedIds = ref(new Set(getStoredExpandedIds(EXPANDED_KEY)))
watch(expandedIds, (ids) => saveExpandedIds(EXPANDED_KEY, ids))

const rows = computed(() => flattenProjectTree(store.projects, expandedIds.value))

// Which row is highlighted. Inbox is the default view, so a bare /tasks — no
// ?project at all — selects it, matching what TasksView already renders.
const selectedProject = computed(() => String(route.query.project ?? 'inbox'))

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

// Drag a project row onto another to re-parent it, or onto the section label
// for the root. The client only blocks the obvious self-drop; the server owns
// the cycle rule, so a drop onto a descendant fails there with a message.
const dragId = ref(null)
const dropId = ref(undefined)

function onDragStart(project, event) {
  dragId.value = project.id
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', project.id)
}

function onDragOver(targetId, event) {
  if (!dragId.value || dragId.value === targetId) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'move'
  dropId.value = targetId
}

function onDrop(targetId) {
  if (dragId.value && dragId.value !== targetId) store.moveProject(dragId.value, targetId)
  dragId.value = null
  dropId.value = undefined
}

function onDragEnd() {
  dragId.value = null
  dropId.value = undefined
}

// The cascade is the one destructive edge here: the whole subtree — and
// every task in it, plus the project's own tasks — goes with the parent, and
// there is no undo endpoint. Both counts must be named before doing it: a
// project can have no sub-projects at all and still lose tasks with a single
// click, which is the part a prompt gated only on sub-project count misses
// entirely. store.descendantIds is the same walk deleteProject uses to know
// what it is about to destroy.
async function removeProject(project) {
  const descendants = store.descendantIds(project.id)
  let taskCount
  try {
    taskCount = await taskItems.countForProjects([project.id, ...descendants])
  } catch (error) {
    // Can't tell how many tasks are at stake: refuse to guess "none" and
    // silently let a destructive delete through.
    console.error('Failed to count tasks before delete:', error)
    taskItems.notify('Failed to check for tasks before deleting.', 'error')
    return
  }

  const parts = []
  if (descendants.length) {
    const plural = descendants.length === 1 ? 'sub-project' : 'sub-projects'
    parts.push(`${descendants.length} ${plural}`)
  }
  if (taskCount) {
    const plural = taskCount === 1 ? 'task' : 'tasks'
    parts.push(`${taskCount} ${plural}`)
  }
  if (parts.length && !confirm(`Delete ${project.name} and its ${parts.join(' and ')}?`)) return

  // Capture before the delete resolves: once it succeeds the route may still
  // point at a project the server has just cascaded away.
  const viewedProject = selectedProject.value
  const viewingDoomed = viewedProject === project.id || descendants.includes(viewedProject)

  const deleted = await store.deleteProject(project.id)
  if (deleted && viewingDoomed) router.push('/tasks?project=inbox')
}
</script>

<template>
  <aside class="left-sidebar tasks-sidebar" aria-label="Tasks sidebar">
    <!-- Reachable from every Tasks view, so the task it creates goes to the
       Inbox rather than to whichever project happens to be on screen. -->
    <button class="compose-btn" type="button" @click="addingTask = true">
      <span class="material-symbols-outlined" aria-hidden="true">add_task</span>
      <span>Add Task</span>
    </button>

    <AddTaskDialog v-if="addingTask" @close="addingTask = false" />

    <!-- Inbox is a rule, not a project: it names the tasks that belong to no
       project, so there is no row behind it to rename, recolour or delete.
       It sits above My Projects, unlabelled, because it is not one of them. -->
    <nav class="sidebar-nav tasks-views-nav" aria-label="Task views">
      <router-link
        :to="{ path: '/tasks', query: { project: 'inbox' } }"
        class="nav-item"
        :class="{ active: selectedProject === 'inbox' }"
      >
        <span class="material-symbols-outlined nav-icon-red" aria-hidden="true">inbox</span>
        <span class="nav-text">Inbox</span>
      </router-link>

      <!-- Today is a rule like Inbox, not a project: it names the tasks due
           on the current date, wherever they live. -->
      <router-link
        :to="{ path: '/tasks', query: { project: 'today' } }"
        class="nav-item"
        :class="{ active: selectedProject === 'today' }"
      >
        <span class="material-symbols-outlined" aria-hidden="true">today</span>
        <span class="nav-text">Today</span>
      </router-link>
    </nav>

    <div
      class="sb-section-label tasks-projects-label"
      :class="{ 'drop-target': dropId === null }"
      @dragover="onDragOver(null, $event)"
      @dragleave="dropId = undefined"
      @drop.prevent="onDrop(null)"
    >
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
        :class="{
          active: selectedProject === row.item.id,
          dragging: dragId === row.item.id,
          'drop-target': dropId === row.item.id,
        }"
        :style="{ paddingLeft: `${10 + row.depth * 14}px` }"
        draggable="true"
        @dblclick.prevent="startRename(row.item)"
        @dragstart="onDragStart(row.item, $event)"
        @dragover="onDragOver(row.item.id, $event)"
        @dragleave="dropId = undefined"
        @drop.prevent="onDrop(row.item.id)"
        @dragend="onDragEnd"
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
      <form
        v-if="newProjectFor !== null"
        class="new-project-row"
        @submit.prevent="submitNewProject"
      >
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

.project-item.dragging {
  opacity: 0.5;
}

.drop-target {
  outline: 1.5px dashed currentColor;
  outline-offset: -1.5px;
  border-radius: 6px;
}
</style>
