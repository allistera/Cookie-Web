<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import { TASKS_API_URL } from '../lib/apiWorkers'
import { authHeaders } from '../lib/authHeaders'
import { jsonRequest } from '../lib/jsonRequest'
import { activityEntries } from '../lib/taskActivity'
import { formatCommentTime } from '../lib/taskComments'
import { useProjectsStore } from '../stores/projects'
import { useTaskItemsStore } from '../stores/taskItems'

// The panel's Activity tab: the changes made to this one task, newest
// first, as a plain list. Account-wide history and completion goals live
// in the list view's History (TaskActivity.vue), not here.
const props = defineProps({ taskId: { type: String, required: true } })

const items = useTaskItemsStore()
const projects = useProjectsStore()
const rows = ref([])
const cursor = ref(null)
const loading = ref(false)
const error = ref('')
let sequence = 0
let disposed = false

async function load(more = false) {
  if (more && (!cursor.value || loading.value)) return
  const current = ++sequence
  loading.value = true
  error.value = ''
  const params = new URLSearchParams({ task: props.taskId })
  if (more) params.set('after', cursor.value)
  try {
    const result = await jsonRequest(`${TASKS_API_URL}/task-activity?${params}`, {
      headers: await authHeaders(),
    })
    if (current !== sequence) return
    const page = result.activities ?? []
    const next = more ? [...rows.value, ...page] : page
    rows.value = [...new Map(next.map((row) => [row.id, row])).values()]
    cursor.value = result.nextCursor
  } catch (failure) {
    if (current === sequence) error.value = failure.userMessage || 'Could not load activity.'
  } finally {
    if (current === sequence) loading.value = false
  }
}

watch(
  () => props.taskId,
  () => {
    rows.value = []
    cursor.value = null
    void load()
  },
  { immediate: true },
)

// A confirmed task write (an edit in this panel, a sync, another client's
// change picked up by a reload) is what adds a line, so reload after each.
const unsubscribe = items.$onAction(({ name, after }) => {
  if (name === 'request')
    after(() => {
      if (!disposed) void load()
    })
})
onBeforeUnmount(() => {
  disposed = true
  ++sequence
  unsubscribe()
})

const entries = computed(() =>
  activityEntries(rows.value, {
    projectName: (id) => projects.projects.find((row) => row.id === id)?.name,
    taskTitle: (id) => items.itemById(id)?.content,
  }),
)
</script>

<template>
  <section class="task-history" aria-label="Activity">
    <p v-if="error" class="task-history-note" role="alert">
      {{ error }} <button type="button" class="task-history-retry" @click="load()">Retry</button>
    </p>
    <p v-else-if="loading && !rows.length" class="task-history-note" role="status">
      Loading activity…
    </p>
    <p v-else-if="!entries.length" class="task-history-note">No changes yet.</p>
    <ul v-else class="task-history-list" aria-label="Changes to this task">
      <li v-for="entry in entries" :key="entry.id" class="task-history-entry">
        <span class="task-history-text">{{ entry.text }}</span>
        <time class="task-history-time" :datetime="entry.occurredAt">{{
          formatCommentTime(entry.occurredAt)
        }}</time>
      </li>
    </ul>
    <button
      v-if="cursor"
      type="button"
      class="task-history-more"
      :disabled="loading"
      @click="load(true)"
    >
      {{ loading ? 'Loading…' : 'Show more' }}
    </button>
  </section>
</template>

<style scoped>
.task-history {
  font-size: 14px;
  color: var(--text-primary);
}

.task-history-note {
  margin: 0;
  color: var(--text-secondary);
}

.task-history-list {
  margin: 0;
  padding-left: 20px;
  list-style: disc;
}

.task-history-entry {
  padding: 3px 0;
  overflow-wrap: anywhere;
}

.task-history-time {
  margin-left: 8px;
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.task-history-retry,
.task-history-more {
  padding: 4px 8px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-primary);
  font: inherit;
  font-size: 13px;
  color: inherit;
  cursor: pointer;
}

.task-history-more {
  margin-top: 10px;
}

.task-history-more:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
