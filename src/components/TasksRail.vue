<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { localToday } from '../lib/localDate'
import { labelChipStyle } from '../lib/taskLabels'
import { subscribeTaskMutations } from '../lib/taskMutationRefresh'
import { priorityOf } from '../lib/taskPriority'
import { SOMEDAY } from '../lib/taskSomeday'
import { inboxRailTasks, railDayLabel, railDue, todayRailTasks } from '../lib/tasksRail'
import { useProjectsStore } from '../stores/projects'
import { useTaskItemsStore } from '../stores/taskItems'
import { useTaskLabelsStore } from '../stores/taskLabels'

// Tasks docked on the right of Mail and Documents, toggled from the header
// (useTasksRail). Two lists, read on their own so they never disturb the list
// the Tasks view has loaded: what is due today (late tasks included) and the
// rest of the Inbox. A task can be completed or added here; anything more
// opens it in Tasks.
const emit = defineEmits(['close'])

const store = useTaskItemsStore()
const projects = useProjectsStore()
const labels = useTaskLabelsStore()
projects.loadProjects()
labels.loadLabels()

const today = ref(localToday())
const dayLabel = computed(() => railDayLabel(today.value))

const SECTIONS = [
  { id: 'today', title: 'Today', empty: 'Nothing due today.' },
  { id: 'inbox', title: 'Inbox', empty: 'Your inbox is clear.' },
]
const lists = reactive({
  today: { items: [], more: false, loaded: false, failed: false },
  inbox: { items: [], more: false, loaded: false, failed: false },
})

let request = 0
let disposed = false
let lastLoad = 0

async function loadList(project, date, seq) {
  const list = lists[project]
  try {
    const { items, nextCursor } = await store.request('GET', {
      params: `?project=${project}${project === 'today' ? `&date=${date}` : ''}&view=page`,
    })
    if (disposed || seq !== request) return
    list.items = project === 'today' ? todayRailTasks(items) : inboxRailTasks(items, date)
    list.more = Boolean(nextCursor)
    list.failed = false
  } catch (error) {
    if (disposed || seq !== request) return
    console.error('Failed to load tasks for the tasks sidebar:', error)
    list.items = []
    list.more = false
    list.failed = true
  }
  list.loaded = true
}

// Both lists are read for the same day, so a task never shows in both or in
// neither around midnight.
function load() {
  const seq = ++request
  const date = localToday()
  today.value = date
  lastLoad = Date.now()
  return Promise.all(SECTIONS.map((section) => loadList(section.id, date, seq)))
}
void load()

// A task added, completed, moved or deleted anywhere on the page, here
// included, is read back straight away.
const stopTaskMutations = subscribeTaskMutations(store, () => void load())

// --- Sections -------------------------------------------------------------
// Folded sections are kept in this browser, like the rail itself.
const FOLDED_STORAGE_KEY = 'cookie.tasksRail.folded'
function readFolded() {
  try {
    return (globalThis.localStorage?.getItem(FOLDED_STORAGE_KEY) ?? '').split(',').filter(Boolean)
  } catch {
    return []
  }
}
const folded = ref(readFolded())
const isFolded = (id) => folded.value.includes(id)
function toggleFolded(id) {
  folded.value = isFolded(id) ? folded.value.filter((row) => row !== id) : [...folded.value, id]
  try {
    if (folded.value.length) {
      globalThis.localStorage?.setItem(FOLDED_STORAGE_KEY, folded.value.join(','))
    } else globalThis.localStorage?.removeItem(FOLDED_STORAGE_KEY)
  } catch {
    // Storage can be blocked; the section still folds for this page load.
  }
}

const completing = ref([])
const sections = computed(() =>
  SECTIONS.map((section) => {
    const list = lists[section.id]
    const rows = list.items
      .filter((item) => !completing.value.includes(item.id))
      .map((item) => ({
        item,
        due: railDue(item, today.value),
        // Inbox rows are all in the Inbox; Today's come from every project.
        home:
          section.id === 'today'
            ? (projects.projectsById.get(item.projectId)?.name ?? 'Inbox')
            : '',
        to: { path: '/tasks', query: { project: section.id, task: item.id } },
      }))
    return {
      ...section,
      ...list,
      rows,
      count: list.loaded && !list.failed ? `${rows.length}${list.more ? '+' : ''}` : '',
    }
  }),
)
const labelStyleOf = (name) => labelChipStyle(labels.byName.get(name)?.color)

// --- Completing -----------------------------------------------------------
// The row leaves at once and comes back if the server refuses. A task the
// Tasks view has loaded goes through the store, which keeps that list right
// and queues the change while offline.
async function complete(item) {
  if (completing.value.includes(item.id)) return
  completing.value = [...completing.value, item.id]
  let done = false
  try {
    if (store.itemById(item.id)) {
      done = Boolean(await store.setCompleted(item.id, true))
    } else {
      const body = { id: item.id, completed: true }
      // A repeating task moves on to its next day instead of closing.
      if (item.recurrence)
        Object.assign(body, { today: today.value, expectedDueDate: item.dueDate })
      await store.request('PATCH', { body })
      store.refreshProjectCounts()
      done = true
    }
  } catch (error) {
    console.error('Failed to complete the task:', error)
    store.notify(error.userMessage || 'Failed to update the task.', 'error')
  }
  if (done && !item.recurrence) {
    for (const list of Object.values(lists)) {
      list.items = list.items.filter((row) => row.id !== item.id)
    }
  }
  completing.value = completing.value.filter((id) => id !== item.id)
}

// --- Adding ---------------------------------------------------------------
// One draft at a time. A task added under Today is due today; one added
// under Inbox starts out on Someday, as it does in the Tasks view. Both land
// in the Inbox.
const composingIn = ref(null)
const draft = ref('')
const draftInput = ref(null)

async function startCompose(id) {
  draft.value = ''
  composingIn.value = id
  await nextTick()
  draftInput.value?.[0]?.focus()
}

async function submitDraft() {
  // Enter also blurs the field, which would send the draft a second time.
  const id = composingIn.value
  if (!id) return
  const content = draft.value.trim()
  composingIn.value = null
  if (!content) return
  await store.createItem({
    content,
    projectId: null,
    dueDate: id === 'today' ? localToday() : SOMEDAY,
  })
}

// --- Refresh --------------------------------------------------------------
// Follows the day across midnight and picks up changes made elsewhere
// (another tab, Todoist) every few minutes and on coming back to the tab.
let timer
function tick() {
  if (document.visibilityState === 'hidden') return
  if (today.value !== localToday() || Date.now() - lastLoad >= 300_000) void load()
}
function onVisibilityChange() {
  if (document.visibilityState === 'visible' && Date.now() - lastLoad >= 30_000) void load()
}
onMounted(() => {
  timer = setInterval(tick, 30_000)
  document.addEventListener('visibilitychange', onVisibilityChange)
})
onUnmounted(() => {
  disposed = true
  stopTaskMutations()
  clearInterval(timer)
  document.removeEventListener('visibilitychange', onVisibilityChange)
})
</script>

<template>
  <aside class="tasks-rail" aria-label="Tasks">
    <header class="tr-head">
      <h2 class="tr-title">Tasks <span class="tr-title-date">· {{ dayLabel }}</span></h2>
      <button
        type="button"
        class="tr-icon-btn"
        aria-label="Hide tasks sidebar"
        @click="emit('close')"
      >
        <span class="material-symbols-outlined" aria-hidden="true">close</span>
      </button>
    </header>

    <div class="tr-body">
      <section
        v-for="section in sections"
        :key="section.id"
        class="tr-section"
        :aria-label="section.title"
      >
        <h3 class="tr-section-head">
          <button
            type="button"
            class="tr-section-toggle"
            :aria-expanded="!isFolded(section.id)"
            @click="toggleFolded(section.id)"
          >
            <span class="tr-section-title">
              {{ section.title }}<template v-if="section.count"> · {{ section.count }}</template>
            </span>
            <span class="material-symbols-outlined" aria-hidden="true">{{
              isFolded(section.id) ? 'expand_more' : 'expand_less'
            }}</span>
          </button>
        </h3>

        <template v-if="!isFolded(section.id)">
          <p v-if="section.failed" class="tr-note" role="status">Tasks could not be loaded.</p>
          <p v-else-if="section.loaded && !section.rows.length" class="tr-note">
            {{ section.empty }}
          </p>
          <ul v-else-if="section.rows.length" class="tr-list">
            <li v-for="row in section.rows" :key="row.item.id" class="tr-task">
              <!-- The circle takes the priority's colour, as in the Tasks view. -->
              <button
                type="button"
                class="tr-check"
                :class="`priority-${priorityOf(row.item)}`"
                :aria-label="`Complete ${row.item.content}`"
                @click="complete(row.item)"
              ></button>
              <RouterLink class="tr-open" :to="row.to">
                <span class="tr-content">{{ row.item.content }}</span>
                <span v-if="row.due.text || row.home || row.item.labels?.length" class="tr-meta">
                  <span v-if="row.due.text" class="tr-due" :class="{ overdue: row.due.overdue }">{{
                    row.due.text
                  }}</span>
                  <span v-if="row.home" class="tr-home">{{ row.home }}</span>
                  <span
                    v-for="label in row.item.labels"
                    :key="label"
                    class="tr-label"
                    :style="labelStyleOf(label)"
                    >@{{ label }}</span
                  >
                </span>
              </RouterLink>
            </li>
          </ul>

          <form v-if="composingIn === section.id" class="tr-add-row" @submit.prevent="submitDraft">
            <input
              ref="draftInput"
              v-model="draft"
              placeholder="Task name"
              aria-label="Task name"
              @keydown.enter.prevent="submitDraft"
              @keydown.escape.stop="composingIn = null"
              @blur="submitDraft"
            />
          </form>
          <button v-else type="button" class="tr-add" @click="startCompose(section.id)">
            <span class="material-symbols-outlined" aria-hidden="true">add</span>
            <span>Add task</span>
          </button>
        </template>
      </section>
    </div>

    <footer class="tr-foot">
      <RouterLink class="tr-open-tasks" to="/tasks">Open Tasks</RouterLink>
    </footer>
  </aside>
</template>

<style scoped>
.tasks-rail {
  position: relative;
  width: 300px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  margin-left: 8px;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
  color: var(--text-primary);
}

.tr-head {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 10px 8px 6px 14px;
}

.tr-title {
  flex: 1;
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tr-title-date {
  font-weight: 400;
  color: var(--text-secondary);
}

.tr-icon-btn {
  display: inline-grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.tr-icon-btn .material-symbols-outlined {
  font-size: 18px;
}

.tr-icon-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.tr-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 12px 8px;
}

.tr-section + .tr-section {
  margin-top: 8px;
  padding-top: 4px;
  border-top: 1px solid var(--border-color);
}

.tr-section-head {
  margin: 0;
  font: inherit;
}

.tr-section-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 6px 2px 6px 4px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.tr-section-toggle:hover {
  color: var(--text-primary);
}

.tr-section-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.tr-section-toggle .material-symbols-outlined {
  font-size: 18px;
}

.tr-note {
  margin: 0;
  padding: 2px 4px 6px;
  font-size: 13px;
  color: var(--text-secondary);
}

.tr-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.tr-task {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 5px 4px;
  border-radius: 6px;
}

.tr-task:hover {
  background: var(--bg-hover);
}

.tr-check {
  width: 16px;
  height: 16px;
  margin-top: 1px;
  flex: 0 0 auto;
  padding: 0;
  border: 1.5px solid var(--text-secondary);
  border-radius: 50%;
  background: none;
  cursor: pointer;
}

.tr-check:hover {
  border-color: var(--text-primary);
}

/* The Tasks view's priority colours (lib/taskPriority). P4 keeps the plain
   circle. */
.tr-check.priority-1 {
  border-color: #d1453b;
  background: rgba(209, 69, 59, 0.12);
}

.tr-check.priority-2 {
  border-color: #eb8909;
  background: rgba(235, 137, 9, 0.12);
}

.tr-check.priority-3 {
  border-color: #246fe0;
  background: rgba(36, 111, 224, 0.12);
}

.tr-open {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
  min-width: 0;
  color: inherit;
  text-decoration: none;
}

.tr-content {
  font-size: 13.5px;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.tr-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 6px;
  font-size: 12px;
  color: var(--text-secondary);
}

.tr-due.overdue {
  color: #eb5757;
  font-weight: 500;
}

/* A time and the task's project read as one line: "13:00 · Inbox". */
.tr-due:not(.overdue) + .tr-home::before {
  content: '· ';
}

.tr-label {
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 11px;
}

.tr-add {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 5px 2px;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--text-secondary);
  font: inherit;
  font-size: 13.5px;
  cursor: pointer;
}

.tr-add:hover {
  color: var(--text-primary);
}

.tr-add .material-symbols-outlined {
  font-size: 20px;
}

.tr-add-row {
  display: flex;
  padding: 3px 2px;
}

.tr-add-row input {
  flex: 1;
  min-width: 0;
  font: inherit;
  font-size: 13.5px;
  color: inherit;
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 4px 8px;
}

.tr-foot {
  padding: 8px 14px;
  border-top: 1px solid var(--border-color);
}

.tr-open-tasks {
  font-size: 13px;
  color: var(--text-blue);
  text-decoration: none;
}

.tr-open-tasks:hover {
  text-decoration: underline;
}

.tasks-rail button:focus-visible,
.tasks-rail a:focus-visible,
.tasks-rail input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

/* Narrow windows: float over the content instead of squeezing it. */
@media (max-width: 1100px) {
  .tasks-rail {
    position: absolute;
    top: 0;
    right: 8px;
    bottom: 8px;
    z-index: var(--z-drawer);
    box-shadow: var(--shadow-lg);
  }
}

/* Phones have no header button to open it with. */
@media (max-width: 760px) {
  .tasks-rail {
    display: none;
  }
}
</style>
