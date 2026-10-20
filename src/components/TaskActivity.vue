<script setup>
import { subscribeTaskMutations } from '../lib/taskMutationRefresh'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import { TASKS_API_URL } from '../lib/apiWorkers'
import { authHeaders } from '../lib/authHeaders'
import { jsonRequest } from '../lib/jsonRequest'
import { ACTION_LABELS, displayValue, FIELD_LABELS } from '../lib/taskActivity'
import { formatCommentTime } from '../lib/taskComments'
import { useProjectsStore } from '../stores/projects'
import { useTaskItemsStore } from '../stores/taskItems'

// Account-wide history and completion goals for the list view's History.
// One task's own changes are the panel's Activity tab (TaskHistory.vue).
const router = useRouter()
const items = useTaskItemsStore()
const projects = useProjectsStore()
const view = ref('completed')
const activities = ref([])
const cursor = ref(null)
const loading = ref(false)
const error = ref('')
const progress = ref(null)
const progressError = ref('')
const progressLoading = ref(false)
const editingGoals = ref(false)
const daily = ref(0)
const weekly = ref(0)
const saving = ref(false)
const goalError = ref('')
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
let listSequence = 0
let progressSequence = 0
let disposed = false

async function request(path, method = 'GET', body) {
  return jsonRequest(`${TASKS_API_URL}/${path}`, {
    method,
    body,
    headers: await authHeaders(body ? { 'Content-Type': 'application/json' } : {}),
  })
}

async function loadActivity(more = false) {
  if (more && (!cursor.value || loading.value)) return
  const sequence = ++listSequence
  loading.value = true
  error.value = ''
  const params = new URLSearchParams()
  if (view.value === 'completed') params.set('completed', 'true')
  if (more) params.set('after', cursor.value)
  try {
    const result = await request(`task-activity?${params}`)
    if (sequence !== listSequence) return
    const rows = more ? [...activities.value, ...result.activities] : result.activities
    activities.value = [...new Map(rows.map((row) => [row.id, row])).values()]
    cursor.value = result.nextCursor
  } catch (failure) {
    if (sequence === listSequence) error.value = failure.userMessage || 'Could not load activity.'
  } finally {
    if (sequence === listSequence) loading.value = false
  }
}

async function loadProgress() {
  const sequence = ++progressSequence
  progressLoading.value = true
  progressError.value = ''
  try {
    const result = await request(`task-progress?${new URLSearchParams({ timeZone })}`)
    if (sequence === progressSequence) progress.value = result
  } catch (failure) {
    if (sequence === progressSequence)
      progressError.value = failure.userMessage || 'Could not load progress.'
  } finally {
    if (sequence === progressSequence) progressLoading.value = false
  }
}

function editGoals() {
  daily.value = progress.value.goals.daily
  weekly.value = progress.value.goals.weekly
  goalError.value = ''
  editingGoals.value = true
}
const validGoals = computed(() =>
  [daily.value, weekly.value].every(
    (value) => Number.isInteger(value) && value >= 0 && value <= 10000,
  ),
)
async function saveGoals() {
  if (saving.value || !validGoals.value) return
  saving.value = true
  goalError.value = ''
  try {
    const result = await request('task-goals', 'PUT', { daily: daily.value, weekly: weekly.value })
    if (disposed) return
    // Invalidate an older progress response so it cannot restore stale goals.
    ++progressSequence
    progressLoading.value = false
    progress.value.goals = result.goals
    editingGoals.value = false
  } catch (failure) {
    goalError.value = failure.userMessage || 'Could not save goals.'
  } finally {
    saving.value = false
  }
}

function refresh() {
  void loadActivity()
  void loadProgress()
}
watch(
  view,
  () => {
    activities.value = []
    cursor.value = null
    void loadActivity()
  },
  { immediate: true },
)
void loadProgress()
// Reads do not invalidate history; successful writes and bulk edits do.
const unsubscribe = subscribeTaskMutations(items, refresh)
// The browser zone defines these calendar periods. Recompute the next local
// midnight each time so a DST day is not assumed to have exactly 24 hours.
let rolloverTimer
function scheduleRollover() {
  clearTimeout(rolloverTimer)
  const midnight = new Date()
  midnight.setHours(24, 0, 0, 0)
  rolloverTimer = setTimeout(
    () => {
      void loadProgress()
      scheduleRollover()
    },
    Math.max(1, midnight.getTime() - Date.now()),
  )
}
function onVisible() {
  if (document.visibilityState === 'visible') {
    refresh()
    scheduleRollover()
  }
}
scheduleRollover()
document.addEventListener('visibilitychange', onVisible)
onBeforeUnmount(() => {
  clearTimeout(rolloverTimer)
  document.removeEventListener('visibilitychange', onVisible)
  disposed = true
  ++listSequence
  ++progressSequence
  unsubscribe()
})

const lookups = {
  projectName: (id) => projects.projects.find((row) => row.id === id)?.name,
  taskTitle: (id) => items.itemById(id)?.content,
}
function openTask(row) {
  void router.push({ path: '/tasks', query: { task: row.taskId } })
}
</script>

<template>
  <section class="task-activity" aria-label="Activity and progress">
    <header>
      <h3>Activity &amp; progress</h3>
      <button type="button" :disabled="loading || progressLoading" @click="refresh">Refresh</button>
    </header>
    <p class="muted">Across all your tasks · {{ timeZone }} · Weeks start Monday</p>
    <p v-if="progressError" role="alert">
      {{ progressError }} <button type="button" @click="loadProgress">Retry progress</button>
    </p>
    <p v-else-if="!progress" role="status">Loading progress…</p>
    <template v-if="progress">
      <div class="progress-cards">
        <div v-for="period in ['daily', 'weekly']" :key="period" class="progress-card">
          <span>{{ period === 'daily' ? 'Today' : 'This week' }}</span>
          <strong>{{ progress.summary[period] }} completed</strong>
          <template v-if="progress.goals[period]">
            <progress
              :value="progress.summary[period]"
              :max="progress.goals[period]"
              :aria-label="`${period === 'daily' ? 'Daily' : 'Weekly'} completion goal`"
            ></progress>
            <span class="muted"
              >Goal: {{ progress.goals[period] }}
              <span v-if="progress.summary[period] >= progress.goals[period]"> · Goal reached</span>
            </span>
          </template>
          <span v-else class="muted">No goal set</span>
        </div>
      </div>
      <p class="muted">
        Counts completion events, including repeats. Reopening does not erase a completion.
      </p>
      <button v-if="!editingGoals" type="button" @click="editGoals">Set completion goals</button>
      <form v-else class="goal-form" @submit.prevent="saveGoals">
        <label
          >Daily goal
          <input
            v-model.number="daily"
            type="number"
            min="0"
            max="10000"
            step="1"
            required
            :disabled="saving"
        /></label>
        <label
          >Weekly goal
          <input
            v-model.number="weekly"
            type="number"
            min="0"
            max="10000"
            step="1"
            required
            :disabled="saving"
        /></label>
        <p class="muted">Use 0 to turn off a goal.</p>
        <p v-if="goalError" role="alert">{{ goalError }}</p>
        <button type="submit" :disabled="saving || !validGoals">
          {{ saving ? 'Saving…' : 'Save goals' }}
        </button>
        <button type="button" :disabled="saving" @click="editingGoals = false">Cancel</button>
      </form>
    </template>

    <label class="history-filter"
      >History
      <select v-model="view" aria-label="Activity history">
        <option value="completed">Completed tasks</option>
        <option value="all">All task activity</option>
      </select>
    </label>
    <p v-if="error" role="alert">
      {{ error }} <button type="button" @click="loadActivity()">Retry activity</button>
    </p>
    <p v-else-if="loading && !activities.length" role="status">Loading activity…</p>
    <p v-else-if="!activities.length" class="muted">No activity yet.</p>
    <ol class="activity-list" aria-label="Task activity timeline">
      <li v-for="row in activities" :key="row.id">
        <div class="activity-line">
          <strong>{{ ACTION_LABELS[row.action] }}</strong>
          <time :datetime="row.occurredAt">{{ formatCommentTime(row.occurredAt) }}</time>
        </div>
        <button v-if="row.taskExists" type="button" class="task-link" @click="openTask(row)">
          {{ row.title }}
        </button>
        <p v-else>{{ row.title }} <span class="muted">(deleted task)</span></p>
        <details v-if="Object.keys(row.changes).length">
          <summary>
            {{
              Object.keys(row.changes)
                .map((field) => FIELD_LABELS[field] || field)
                .join(', ')
            }}
          </summary>
          <p v-for="(change, field) in row.changes" :key="field" class="change">
            <strong>{{ FIELD_LABELS[field] || field }}:</strong>
            <template v-if="field === 'position' || field === 'today_position'">Reordered</template>
            <template v-else
              >{{ displayValue(change.before, field, lookups) }} →
              {{ displayValue(change.after, field, lookups) }}</template
            >
          </p>
        </details>
      </li>
    </ol>
    <button v-if="cursor" type="button" :disabled="loading" @click="loadActivity(true)">
      {{ loading ? 'Loading…' : 'More activity' }}
    </button>
    <p class="muted">
      Earlier edits and deleted tasks are available only from when activity tracking began.
    </p>
  </section>
</template>

<style scoped>
.task-activity {
  margin: 24px 0 0 32px;
  font-size: 13px;
}
header,
.activity-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
header {
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 8px;
}
h3 {
  font-size: 14px;
  margin: 0;
}
p {
  margin: 8px 0;
  overflow-wrap: anywhere;
}
.muted,
time {
  color: var(--text-secondary);
  font-size: 12px;
}
button,
select,
input {
  font: inherit;
  color: inherit;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 5px;
  padding: 5px 8px;
}
button {
  cursor: pointer;
}
button:disabled {
  opacity: 0.6;
  cursor: default;
}
.progress-cards {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin: 12px 0;
}
.progress-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 12px;
}
progress {
  width: 100%;
  accent-color: var(--accent-color);
}
.goal-form {
  margin-top: 12px;
}
.goal-form label {
  display: inline-flex;
  flex-direction: column;
  gap: 5px;
  margin: 0 12px 8px 0;
}
.goal-form input {
  width: 100px;
}
.history-filter {
  display: flex;
  gap: 12px;
  align-items: center;
  margin: 24px 0 12px;
}
.activity-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.activity-list li {
  border-left: 2px solid var(--border-color);
  padding: 0 0 18px 14px;
}
time {
  font-size: 11px;
}
details {
  margin-top: 6px;
}
summary {
  cursor: pointer;
  color: var(--text-secondary);
}
.change {
  white-space: pre-wrap;
  max-height: 160px;
  overflow: auto;
}
.task-link {
  text-align: left;
  margin-top: 6px;
}
@media (max-width: 520px) {
  .task-activity {
    margin-left: 0;
  }
  .progress-cards {
    grid-template-columns: 1fr;
  }
}
</style>
