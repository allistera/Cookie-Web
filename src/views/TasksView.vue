<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import TaskDetailPanel from '../components/TaskDetailPanel.vue'
import { localToday } from '../lib/localDate'
import { priorityOf } from '../lib/taskPriority'
import { useInlineEdit } from '../composables/useInlineEdit'
import { useProjectsStore } from '../stores/projects'
import { useTaskItemsStore } from '../stores/taskItems'

const route = useRoute()
const router = useRouter()
const projects = useProjectsStore()
const items = useTaskItemsStore()

// 'inbox' is a filter, not a project id — the Inbox is the tasks that belong
// to no project, so there is no row to look up.
const project = computed(() => String(route.query.project ?? 'today'))
const isInbox = computed(() => project.value === 'inbox')
// Today, like Inbox, is a rule rather than a project: nothing to rename,
// describe or nest, and no single project a new task would belong to.
const isToday = computed(() => project.value === 'today')
const isRule = computed(() => isInbox.value || isToday.value)
const current = computed(() =>
  isRule.value ? null : projects.projects.find((row) => row.id === project.value),
)
const ancestors = computed(() =>
  isRule.value ? [] : projects.ancestorsOf(project.value).slice(0, -1),
)
const title = computed(() => {
  if (isToday.value) return 'Today'
  return isInbox.value ? 'Inbox' : (current.value?.name ?? '')
})

// Today's rows come from across the tree, so each says where it lives.
function homeOf(item) {
  if (!item.projectId) return 'Inbox'
  return projects.projects.find((row) => row.id === item.projectId)?.name ?? 'Inbox'
}

// Which task the panel is showing, if any. Keeping it in the URL makes a task
// linkable and survive a reload.
const openTaskId = computed(() => {
  const id = route.query.task
  return id ? String(id) : ''
})

// Deleting cascades to any sub-tasks and there is no undo endpoint, so it
// confirms first and names what it is about to remove — the same bargain the
// detail panel's delete makes.
async function removeItem(item) {
  if (!confirm(`Delete "${item.content}"?`)) return
  await items.deleteItem(item.id)
}

function open(id) {
  router.push({ path: '/tasks', query: { ...route.query, task: id } })
}

const DUE_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

// due_date is a plain calendar date with no zone, so it is formatted from its
// own parts rather than through a Date: constructing one and formatting it in
// the local zone moves the chip a day for anyone west of Greenwich. Intl is
// avoided for a second reason — en-GB's short September is 'Sep' on some ICU
// versions and 'Sept' on others, which would pass locally and fail in CI.
// Today carries overdue tasks forward, so its rows no longer share one date.
// A row due today needs no chip — the heading already says so — but anything
// late does, and says it plainly.
function isOverdue(item) {
  return Boolean(item.dueDate) && item.dueDate < localToday()
}

function showsDue(item) {
  return Boolean(item.dueDate) && (!isToday.value || isOverdue(item))
}

function formatDue(dueDate) {
  const [, month, day] = dueDate.split('-')
  return `${Number(day)} ${DUE_MONTHS[Number(month) - 1]}`
}

onMounted(() => {
  projects.loadProjects()
  items.loadItems(project.value)
})

watch(project, (next) => {
  // A query naming a task in the old project would silently keep filtering
  // once the new project's rows arrive, hiding them for no visible reason.
  searchQuery.value = ''
  items.loadItems(next)
})

const titleEdit = useInlineEdit({
  read: () => current.value?.name ?? '',
  // An empty title is not a rename: leaving edit mode keeps the existing name,
  // which is what Enter on a cleared field should do.
  write: (name) => (name ? projects.renameProject(project.value, name) : undefined),
  canEdit: () => !isRule.value,
})

const descriptionEdit = useInlineEdit({
  read: () => current.value?.description ?? '',
  write: (description) => projects.describeProject(project.value, description),
  canEdit: () => !isRule.value,
  selectAll: false,
})

// Descriptions are multi-line, so Enter makes a newline and only blur (or
// Escape, discarding) leaves the edit. The rows track the draft as a fallback
// for browsers without field-sizing, which otherwise does the growing.
const descriptionRows = computed(() =>
  Math.min(8, Math.max(2, descriptionEdit.draft.value.split('\n').length)),
)

// Sub-tasks live inside their parent's panel, not in the list; the store
// still loads them so the panel can resolve them from the same list.
const topLevelItems = computed(() => items.items.filter((item) => !item.parentId))

const searchQuery = ref('')
const trimmedQuery = computed(() => searchQuery.value.trim())

function matchesQuery(item, query) {
  return (
    item.content.toLowerCase().includes(query) ||
    (item.description ?? '').toLowerCase().includes(query)
  )
}

// A match can be a sub-task nested more than one level deep, so each match is
// walked up to its top-level ancestor through a map rather than the tree
// itself — the flat list has no child pointers. The hop count is capped at
// the list length as a guard against a dangling parentId or an accidental
// cycle, either of which would otherwise loop forever.
function rootOf(item, byId) {
  let current = item
  let hops = 0
  while (current.parentId && hops < items.items.length) {
    const parent = byId.get(current.parentId)
    if (!parent) break
    current = parent
    hops += 1
  }
  return current
}

const visibleItems = computed(() => {
  const query = trimmedQuery.value.toLowerCase()
  if (!query) return topLevelItems.value

  const byId = new Map(items.items.map((item) => [item.id, item]))
  const matchingRootIds = new Set()
  for (const item of items.items) {
    if (matchesQuery(item, query)) matchingRootIds.add(rootOf(item, byId).id)
  }

  return topLevelItems.value.filter((item) => matchingRootIds.has(item.id))
})

const composing = ref(false)
const draft = ref('')
const draftInput = ref(null)

async function startCompose() {
  draft.value = ''
  composing.value = true
  await nextTick()
  draftInput.value?.focus()
}

async function submitDraft() {
  // Same Enter-then-blur double fire as the title and description edits.
  if (!composing.value) return
  const content = draft.value.trim()
  composing.value = false
  if (!content) return
  await items.createItem({ content, projectId: isInbox.value ? null : project.value })
}
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

    <input
      v-if="titleEdit.editing.value"
      :ref="(el) => (titleEdit.inputRef.value = el)"
      v-model="titleEdit.draft.value"
      class="tasks-title-input"
      aria-label="Project name"
      @keydown.enter.prevent="titleEdit.submit"
      @keydown.escape="titleEdit.editing.value = false"
      @blur="titleEdit.submit"
    />
    <h1 v-else class="tasks-title" @click="titleEdit.start">{{ title }}</h1>

    <textarea
      v-if="descriptionEdit.editing.value"
      :ref="(el) => (descriptionEdit.inputRef.value = el)"
      v-model="descriptionEdit.draft.value"
      class="tasks-description-input"
      placeholder="Add a description"
      aria-label="Project description"
      :rows="descriptionRows"
      @keydown.escape="descriptionEdit.editing.value = false"
      @blur="descriptionEdit.submit"
    ></textarea>
    <p v-else-if="!isRule" class="tasks-description" @click="descriptionEdit.start">
      {{ current?.description || 'Add a description' }}
    </p>

    <input
      v-if="items.items.length"
      v-model="searchQuery"
      type="search"
      class="task-search"
      placeholder="Search tasks"
      aria-label="Search tasks"
      @keydown.escape="searchQuery = ''"
    />

    <!-- The store clears items.items before a switch goes out, so this only
       ever shows while genuinely waiting on the newly-selected project —
       never the previous project's rows. -->
    <p v-if="items.isLoading && !items.items.length" class="tasks-loading">Loading tasks…</p>
    <p v-else-if="trimmedQuery && !visibleItems.length" class="tasks-empty">
      No tasks match "{{ trimmedQuery }}"
    </p>
    <ul v-else class="task-rows">
      <li v-for="item in visibleItems" :key="item.id" class="task-row">
        <!-- The circle takes the priority's colour, the way Todoist's list
           does, so an urgent task stands out without another chip. -->
        <button
          class="task-check"
          :class="`priority-${priorityOf(item)}`"
          type="button"
          :aria-label="`Complete ${item.content}`"
          @click="items.setCompleted(item.id, true)"
        ></button>
        <button class="task-open" type="button" @click="open(item.id)">
          <span class="task-content">{{ item.content }}</span>
          <span v-if="item.description" class="task-description">{{ item.description }}</span>
          <span v-if="showsDue(item)" class="task-due" :class="{ overdue: isOverdue(item) }">
            {{ formatDue(item.dueDate) }}
          </span>
          <span v-if="isToday" class="task-home">{{ homeOf(item) }}</span>
        </button>
        <button
          class="task-delete"
          type="button"
          title="Delete task"
          :aria-label="`Delete ${item.content}`"
          @click="removeItem(item)"
        >
          <span class="material-symbols-outlined" aria-hidden="true">delete</span>
        </button>
      </li>
    </ul>

    <!-- A task added while a query is active would match nothing and vanish
       the instant it appears, so the composer waits for the query to clear. -->
    <form
      v-if="composing && !isToday && !trimmedQuery"
      class="add-task-row"
      @submit.prevent="submitDraft"
    >
      <input
        ref="draftInput"
        v-model="draft"
        placeholder="Task name"
        aria-label="Task name"
        @keydown.enter.prevent="submitDraft"
        @keydown.escape="composing = false"
        @blur="submitDraft"
      />
    </form>
    <button
      v-else-if="!isToday && !trimmedQuery"
      class="add-task-btn"
      type="button"
      @click="startCompose"
    >
      <span aria-hidden="true">+</span>
      <span>Add task</span>
    </button>

    <TaskDetailPanel v-if="openTaskId" :key="openTaskId" :task-id="openTaskId" />
  </div>
</template>

<style scoped>
/* The panel is a flex item in .main-content's column flex container, so the
   cross axis is horizontal: an auto side margin there beats align-items:
   stretch and sizes the box to its content. Without an explicit width that
   collapsed the column to the width of its widest row and floated it out to
   the middle of the panel, so state the width and let max-width cap it. */
.tasks-view {
  width: 100%;
  max-width: 900px;
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
  white-space: pre-wrap;
}

/* Editing happens in place: the field carries the same metrics as the text it
   replaces and no box of its own, so entering and leaving edit mode moves
   nothing — the caret is the only sign the field is live. */
.tasks-title-input,
.tasks-description-input {
  display: block;
  width: 100%;
  font: inherit;
  color: inherit;
  background: transparent;
  border: none;
  outline: none;
  padding: 0;
}

.tasks-title-input {
  margin: 18px 0 6px;
  font-size: 26px;
  font-weight: 700;
}

.tasks-description-input {
  margin: 0 0 24px;
  font-size: 14px;
  resize: none;
  field-sizing: content;
}

.task-search {
  display: block;
  width: 100%;
  margin: 0 0 12px;
  font: inherit;
  color: inherit;
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 4px 8px;
}

.tasks-loading,
.tasks-empty {
  margin: 0;
  padding: 10px 0;
  color: var(--text-secondary);
  font-size: 14px;
}

.task-rows {
  list-style: none;
  margin: 0;
  padding: 0;
}

.task-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border-color);
}

/* Revealed on hover, but always present for keyboard and touch: a control
   that only exists on hover cannot be reached without a pointer. */
.task-delete {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  /* The row is top-aligned, so this sits level with the circle and the first
     line of the title rather than drifting down beside a long description. */
  margin-top: 1px;
  padding: 2px;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--text-secondary);
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--transition-fast) ease;
}

.task-row:hover .task-delete,
.task-delete:focus-visible {
  opacity: 1;
}

.task-delete:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.task-delete .material-symbols-outlined {
  font-size: 18px;
}

@media (hover: none) {
  /* No hover to reveal it on a touch screen. */
  .task-delete {
    opacity: 1;
  }
}

.task-open {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  flex: 1;
  min-width: 0;
  padding: 0;
  border: none;
  background: none;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.task-due.overdue {
  color: #eb5757;
}

.task-due,
.task-home {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-secondary);
}

.task-check {
  width: 18px;
  height: 18px;
  margin-top: 2px;
  flex: 0 0 auto;
  border: 1.5px solid var(--text-secondary);
  border-radius: 50%;
  background: none;
  cursor: pointer;
}

.task-check:hover {
  border-color: var(--text-primary);
}

/* Todoist's colours, shared with the detail panel's flags (lib/taskPriority).
   P4 keeps the plain circle. */
.task-check.priority-1 {
  border-color: #d1453b;
  background: rgba(209, 69, 59, 0.12);
}

.task-check.priority-2 {
  border-color: #eb8909;
  background: rgba(235, 137, 9, 0.12);
}

.task-check.priority-3 {
  border-color: #246fe0;
  background: rgba(36, 111, 224, 0.12);
}

.task-content {
  font-size: 14px;
}

.task-description {
  font-size: 13px;
  color: var(--text-secondary);
}

.add-task-row {
  display: flex;
  padding: 10px 0;
}

.add-task-row input {
  flex: 1;
  font: inherit;
  color: inherit;
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 4px 8px;
}

.add-task-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 0;
  border: none;
  background: none;
  color: var(--text-secondary);
  font: inherit;
  cursor: pointer;
}

.add-task-btn:hover {
  color: var(--text-primary);
}
</style>
