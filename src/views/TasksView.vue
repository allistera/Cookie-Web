<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import TaskDetailPanel from '../components/TaskDetailPanel.vue'
import { localToday } from '../lib/localDate'
import { orderAfterDrop } from '../lib/taskOrder'
import { PRIORITIES, priorityOf } from '../lib/taskPriority'
import { useInlineEdit } from '../composables/useInlineEdit'
import { useProjectsStore } from '../stores/projects'
import { useTaskItemsStore } from '../stores/taskItems'

const route = useRoute()
const router = useRouter()
const projects = useProjectsStore()
const items = useTaskItemsStore()
const taskLayout = computed(() => (route.query.layout === 'board' ? 'board' : 'list'))
const grouping = computed(() => (route.query.group === 'labels' ? 'labels' : 'priority'))
function setLayout(event) {
  router.replace({ query: { ...route.query, layout: event.target.value } })
}
function setGrouping(event) {
  router.replace({ query: { ...route.query, group: event.target.value } })
}

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
// detail panel's delete makes. A divider holds nothing, so it just goes.
async function removeItem(item) {
  if (!isDivider(item) && !confirm(`Delete "${item.content}"?`)) return
  await items.deleteItem(item.id)
}

// --- Dividers ---
// A rule between rows to group them (kind: 'divider'). The line under each
// row grows a plus when the pointer rests on it; the plus adds a divider
// there. Today spans every project, so it has no list to put one in, and a
// search shows rows out of context, so neither offers the plus.
function isDivider(item) {
  return item.kind === 'divider'
}

const canAddDividers = computed(
  () => taskLayout.value === 'list' && !isToday.value && !trimmedQuery.value,
)
// One at a time: a second click while the first is still on its way would
// put two rules side by side.
const addingDivider = ref(false)

// No plus on either side of a divider: two rules in a row say nothing.
function offersDividerAfter(index) {
  if (!canAddDividers.value) return false
  const next = visibleItems.value[index + 1]
  return !isDivider(visibleItems.value[index]) && !(next && isDivider(next))
}

async function addDividerAfter(item) {
  if (addingDivider.value) return
  addingDivider.value = true
  try {
    await items.addDivider({ projectId: isInbox.value ? null : project.value, afterId: item.id })
  } finally {
    addingDivider.value = false
  }
}

function open(id) {
  router.push({ path: '/tasks', query: { ...route.query, task: id } })
}

function labelOf(item) {
  return isDivider(item) ? 'divider' : item.content
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

function formatTime(dueTime) {
  const [hourText, minute] = dueTime.split(':')
  const hour = Number(hourText)
  return `${hour % 12 || 12}:${minute} ${hour < 12 ? 'AM' : 'PM'}`
}

function formatDueLine(item) {
  const parts = []
  if (showsDue(item)) parts.push(formatDue(item.dueDate))
  if (item.dueTime) parts.push(formatTime(item.dueTime))
  return parts.join(' · ')
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

const taskGroups = computed(() => {
  if (taskLayout.value === 'list') return [{ id: 'list', items: visibleItems.value }]
  const tasks = visibleItems.value.filter((item) => !isDivider(item))
  if (grouping.value === 'priority') {
    return PRIORITIES.map((priority) => ({
      id: priority.value,
      name: priority.label,
      items: tasks.filter((item) => priorityOf(item) === priority.value),
    }))
  }
  const labels = [...new Set(tasks.flatMap((item) => item.labels ?? []))].sort((a, b) =>
    a.localeCompare(b),
  )
  return [
    ...labels.map((label) => ({
      id: `label:${label}`,
      name: label,
      items: tasks.filter((item) => item.labels?.includes(label)),
    })),
    { id: 'unlabelled', name: 'No label', items: tasks.filter((item) => !item.labels?.length) },
  ]
})

// --- Drag and drop ---
// A row is dragged by the grip that appears at its left edge. Dropped on
// another row it re-arranges the list; dropped on the sidebar (Inbox, Today,
// or a project) it moves — TasksSidebar handles those drops, reading the id
// back from this MIME type. Today is ordered by due date, so there a row can
// only be re-arranged among the rows due the same day.
const TASK_DRAG_TYPE = 'application/x-cookie-task'
// A divider carries a second type so the sidebar's Today, which sets a due
// date, can refuse it before it lands.
const DIVIDER_DRAG_TYPE = 'application/x-cookie-divider'
const dragTaskId = ref(null)
const dropRowId = ref(null)
const dropPlace = ref('after')
const draggedItem = computed(() =>
  dragTaskId.value ? items.itemById(dragTaskId.value) : undefined,
)

function canDropOn(item) {
  if (taskLayout.value === 'board') return false
  if (!draggedItem.value || draggedItem.value.id === item.id) return false
  return !isToday.value || draggedItem.value.dueDate === item.dueDate
}

// The rows a drop re-arranges: the whole list, or in Today the dragged
// row's day. The full list rather than the filtered one, so a drop made
// while searching still lands between the rows it was seen between.
function reorderGroup() {
  if (!isToday.value) return topLevelItems.value
  const { dueDate } = draggedItem.value
  return topLevelItems.value.filter((row) => row.dueDate === dueDate)
}

function onTaskDragStart(item, event) {
  dragTaskId.value = item.id
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData(TASK_DRAG_TYPE, item.id)
  if (isDivider(item)) event.dataTransfer.setData(DIVIDER_DRAG_TYPE, item.id)
  event.dataTransfer.setData('text/plain', item.id)
}

// A divider is not dropped beside another: two rules in a row say nothing.
function dividerWouldTouch(item, place) {
  if (!isDivider(draggedItem.value)) return false
  if (isDivider(item)) return true
  const list = topLevelItems.value
  const index = list.indexOf(item)
  const neighbour = place === 'before' ? list[index - 1] : list[index + 1]
  return Boolean(neighbour) && neighbour.id !== draggedItem.value.id && isDivider(neighbour)
}

// The upper half of a row means "before it", the lower half "after".
function onTaskDragOver(item, event) {
  if (!canDropOn(item)) return
  const rect = event.currentTarget.getBoundingClientRect()
  const place = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
  if (dividerWouldTouch(item, place)) {
    if (dropRowId.value === item.id) dropRowId.value = null
    return
  }
  event.preventDefault()
  event.dataTransfer.dropEffect = 'move'
  dropRowId.value = item.id
  dropPlace.value = place
}

function onTaskDragLeave(item) {
  if (dropRowId.value === item.id) dropRowId.value = null
}

function clearTaskDrag() {
  dragTaskId.value = null
  dropRowId.value = null
}

// A drop counts only on the row the last dragover accepted.
function onTaskDrop(item) {
  const draggedId = dragTaskId.value
  const place = dropPlace.value
  const allowed = dropRowId.value === item.id && canDropOn(item) && !dividerWouldTouch(item, place)
  const ids = allowed ? reorderGroup().map((row) => row.id) : []
  clearTaskDrag()
  if (!allowed) return
  const order = orderAfterDrop(ids, draggedId, item.id, place)
  if (order) items.reorderItems(order)
}

const composing = ref(false)
const draft = ref('')
const draftInput = ref(null)

async function startCompose() {
  draft.value = ''
  composing.value = true
  await nextTick()
  draftInput.value?.focus()
}

// Today has no compose row or dividers (a new task needs a home), so the
// palette sends the person to the Inbox first; by the time this fires the
// project is set.
watch(
  () => items.viewActionRequest,
  (request) => {
    const action = request?.action
    if (action !== 'new-task' && action !== 'add-divider') return
    items.viewActionRequest = null
    if (action === 'new-task') {
      if (!isToday.value) startCompose()
      return
    }
    // A divider goes under the last row; two in a row would say nothing.
    const last = visibleItems.value.at(-1)
    if (!canAddDividers.value || !last || isDivider(last)) {
      items.notify('Add a task first, then a divider can go under it.')
      return
    }
    addDividerAfter(last)
  },
  { immediate: true },
)

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
  <div class="view-panel active tasks-view" :class="{ 'tasks-board-view': taskLayout === 'board' }">
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
    <div class="task-view-controls">
      <label
        >View
        <select aria-label="Task view" :value="taskLayout" @change="setLayout">
          <option value="list">List</option>
          <option value="board">Board</option>
        </select></label
      >
      <label v-if="taskLayout === 'board'"
        >Group by
        <select aria-label="Group tasks by" :value="grouping" @change="setGrouping">
          <option value="priority">Priority</option>
          <option value="labels">Labels</option>
        </select></label
      >
    </div>

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
    <div v-else :class="{ 'task-board': taskLayout === 'board' }">
      <section
        v-for="group in taskGroups"
        :key="group.id"
        :class="{ 'task-column': taskLayout === 'board' }"
        :aria-label="group.name"
      >
        <h2 v-if="taskLayout === 'board'" class="task-column-title">
          {{ group.name }} <span>{{ group.items.length }}</span>
        </h2>
        <p v-if="taskLayout === 'board' && !group.items.length" class="tasks-empty">No tasks</p>
        <ul class="task-rows">
          <template v-for="(item, index) in group.items" :key="item.id">
            <li
              class="task-row"
              :class="{
                'task-divider': isDivider(item),
                dragging: dragTaskId === item.id,
                'drop-before': dropRowId === item.id && dropPlace === 'before',
                'drop-after': dropRowId === item.id && dropPlace === 'after',
              }"
              @dragover="onTaskDragOver(item, $event)"
              @dragleave="onTaskDragLeave(item)"
              @drop.prevent="onTaskDrop(item)"
            >
              <!-- The grip is the drag source, not the row: text in the title can
             still be selected, and the affordance says what dragging does. -->
              <button
                v-if="taskLayout === 'list'"
                class="task-grip"
                type="button"
                draggable="true"
                title="Drag to re-arrange or move"
                :aria-label="`Drag ${labelOf(item)}`"
                @dragstart="onTaskDragStart(item, $event)"
                @dragend="clearTaskDrag"
                @click.prevent
              >
                <span class="material-symbols-outlined" aria-hidden="true">drag_indicator</span>
              </button>
              <template v-if="isDivider(item)">
                <!-- A rule with its delete in the middle, shown when the pointer
               rests on it. Nothing to confirm: the divider holds nothing. -->
                <span class="divider-line" aria-hidden="true"></span>
                <button
                  class="divider-delete"
                  type="button"
                  title="Delete divider"
                  aria-label="Delete divider"
                  @click="removeItem(item)"
                >
                  <span class="material-symbols-outlined" aria-hidden="true">delete</span>
                </button>
              </template>
              <template v-else>
                <!-- The circle takes the priority's colour, the way Todoist's list
               does, so an urgent task stands out without another chip. -->
                <button
                  class="task-check"
                  :class="`priority-${priorityOf(item)}`"
                  type="button"
                  :disabled="items.completingIds.includes(item.id)"
                  :aria-label="`Complete ${item.content}`"
                  @click="items.setCompleted(item.id, true)"
                ></button>
                <button class="task-open" type="button" @click="open(item.id)">
                  <span class="task-content">{{ item.content }}</span>
                  <span v-if="item.description" class="task-description">{{
                    item.description
                  }}</span>
                  <span
                    v-if="showsDue(item) || item.dueTime"
                    class="task-due"
                    :class="{ overdue: isOverdue(item) }"
                  >
                    {{ formatDueLine(item) }}
                  </span>
                  <span v-if="item.labels?.length" class="task-labels" aria-label="Labels">
                    <span v-for="label in item.labels" :key="label" class="task-label">
                      @{{ label }}
                    </span>
                  </span>
                  <span
                    v-if="item.recurrence"
                    class="task-home"
                    :aria-label="`Repeats ${item.recurrence}`"
                  >
                    ↻ {{ item.recurrence }}
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
              </template>
            </li>
            <!-- A zero-height row straddling the line under the one above: the
           plus appears while the pointer is on the line, and adds a divider
           there. -->
            <li v-if="offersDividerAfter(index)" class="task-insert">
              <button
                class="task-insert-btn"
                type="button"
                title="Add divider"
                :aria-label="`Add divider after ${labelOf(item)}`"
                :disabled="addingDivider"
                @click="addDividerAfter(item)"
              >
                <span class="material-symbols-outlined" aria-hidden="true">add</span>
              </button>
            </li>
          </template>
        </ul>
      </section>
    </div>

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

.tasks-board-view {
  max-width: 1400px;
  min-width: 0;
}
.task-view-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin: 16px 0;
  font-size: 13px;
  color: var(--text-secondary);
}
.task-view-controls label {
  display: flex;
  align-items: center;
  gap: 8px;
}
.task-view-controls select {
  font: inherit;
  color: var(--text-primary);
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 6px 10px;
}
.task-board {
  display: flex;
  gap: 16px;
  overflow-x: auto;
  padding-bottom: 16px;
}
.task-column {
  flex: 1 0 240px;
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
}
.task-column-title {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin: 0 0 12px;
  font-size: 14px;
  overflow-wrap: anywhere;
}
.task-column-title span {
  color: var(--text-secondary);
  font-weight: 400;
}
.task-column .task-row {
  padding: 12px 0;
  gap: 8px;
}
.task-column .task-content {
  overflow-wrap: anywhere;
}
@media (max-width: 600px) {
  .task-column {
    flex-basis: 210px;
  }
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
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border-color);
}

.task-row.dragging {
  opacity: 0.5;
}

/* A divider: the grip, then a rule where a task's circle and title would be,
   with the delete sitting on the rule's midpoint. */
.task-row.task-divider {
  align-items: center;
  padding: 12px 0;
  border-bottom: none;
}

.divider-line {
  flex: 1;
  height: 2px;
  border-radius: 1px;
  background: var(--text-secondary);
  opacity: 0.5;
  transition: opacity var(--transition-fast) ease;
}

.task-divider:hover .divider-line {
  opacity: 1;
}

.divider-delete {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: center;
  padding: 2px;
  border: 1px solid var(--border-color);
  border-radius: 50%;
  background: var(--bg-card);
  color: var(--text-secondary);
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--transition-fast) ease;
}

.task-divider:hover .divider-delete,
.divider-delete:focus-visible {
  opacity: 1;
}

.divider-delete:hover {
  color: var(--text-primary);
}

.divider-delete .material-symbols-outlined {
  font-size: 16px;
}

/* The line under a row, made hoverable: a 14px band straddling the border
   above it (the negative margins pull it over the neighbouring rows, and
   the z-index paints it above them). On the band the line darkens and a
   plus appears at its midpoint. */
.task-insert {
  position: relative;
  z-index: 1;
  height: 14px;
  margin: -7px 0;
}

.task-insert::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 6px;
  height: 2px;
  background: var(--accent-color, #4f7c6b);
  opacity: 0;
  transition: opacity var(--transition-fast) ease;
}

.task-insert-btn {
  position: absolute;
  /* Above the line, which is drawn after it. */
  z-index: 1;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: center;
  padding: 1px;
  border: none;
  border-radius: 50%;
  background: var(--accent-color, #4f7c6b);
  color: #fff;
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--transition-fast) ease;
}

/* Keyboard focus reveals it too — but only focus-visible, or the plus would
   stay lit after a click, which leaves the button focused. */
.task-insert:hover::after,
.task-insert:hover .task-insert-btn,
.task-insert:has(.task-insert-btn:focus-visible)::after,
.task-insert-btn:focus-visible {
  opacity: 1;
}

.task-insert-btn .material-symbols-outlined {
  font-size: 16px;
}

@media (hover: none) {
  /* Without a pointer to rest on the line, the plus has to be visible. */
  .task-insert-btn,
  .divider-delete {
    opacity: 1;
  }
}

/* Sits in the gutter left of the row (the view's side padding), revealed on
   hover like the delete control, and always present for keyboard and touch.
   The margins cancel its width and the row gap so the circle stays put. */
.task-grip {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  width: 20px;
  margin: 1px -8px 0 -24px;
  padding: 2px 0;
  border: none;
  background: none;
  color: var(--text-secondary);
  cursor: grab;
  opacity: 0;
  transition: opacity var(--transition-fast) ease;
}

.task-row:hover .task-grip,
.task-grip:focus-visible {
  opacity: 1;
}

.task-grip:active {
  cursor: grabbing;
}

.task-grip .material-symbols-outlined {
  font-size: 18px;
}

@media (hover: none) {
  .task-grip {
    opacity: 1;
  }
}

/* The insertion line: drawn inside the row's edge so it never shifts layout
   while the pointer moves. */
.task-row.drop-before {
  box-shadow: inset 0 2px 0 0 var(--accent-color, #4f7c6b);
}

.task-row.drop-after {
  box-shadow: inset 0 -2px 0 0 var(--accent-color, #4f7c6b);
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

.task-labels {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 4px;
}

.task-label {
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--bg-hover);
  color: var(--text-secondary);
  font-size: 11px;
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
