<script setup>
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { useProjectsStore } from '../stores/projects'
import { useTaskItemsStore } from '../stores/taskItems'

const props = defineProps({ taskId: { type: String, required: true } })

const route = useRoute()
const router = useRouter()
const items = useTaskItemsStore()
const projects = useProjectsStore()

const item = computed(() => items.itemById(props.taskId))

// A task with no project is in the Inbox — the same rule the sidebar encodes.
const projectName = computed(() => {
  if (!item.value?.projectId) return 'Inbox'
  return projects.projects.find((row) => row.id === item.value.projectId)?.name ?? 'Inbox'
})

// Siblings are the loaded list in its displayed order, so stepping through
// them matches what is visible behind the modal.
const siblingIndex = computed(() => items.items.findIndex((row) => row.id === props.taskId))
const previousId = computed(() =>
  siblingIndex.value > 0 ? items.items[siblingIndex.value - 1].id : null,
)
const nextId = computed(() =>
  siblingIndex.value >= 0 && siblingIndex.value < items.items.length - 1
    ? items.items[siblingIndex.value + 1].id
    : null,
)

function close() {
  const query = { ...route.query }
  delete query.task
  router.push({ path: '/tasks', query })
}

function open(id) {
  if (id) router.push({ path: '/tasks', query: { ...route.query, task: id } })
}

async function remove() {
  if (!item.value) return
  if (!confirm(`Delete "${item.value.content}"?`)) return
  const deleted = await items.deleteItem(props.taskId)
  if (deleted) close()
}

// A task id naming nothing in the loaded list is a stale link, a deleted task,
// or one hidden because it is complete. Wait for the load to settle before
// judging, or a panel opened by a deep link closes itself while the list is
// still in flight.
watch(
  () => [items.isLoading, items.loadedProject, item.value],
  () => {
    if (items.isLoading || items.loadedProject === null || item.value) return
    items.notify('That task no longer exists.', 'error')
    close()
  },
  { immediate: true },
)

function onKeydown(event) {
  if (event.key === 'Escape') close()
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="task-panel-backdrop" @click="close()">
    <div
      class="task-panel"
      role="dialog"
      aria-modal="true"
      :aria-label="item?.content ?? 'Task'"
      @click.stop
    >
      <header class="task-panel-header">
        <span class="task-panel-project">
          <span v-if="item?.projectId" class="project-symbol" aria-hidden="true"></span>
          <span v-else class="material-symbols-outlined" aria-hidden="true">inbox</span>
          {{ projectName }}
        </span>

        <div class="task-panel-actions">
          <button
            class="task-panel-prev"
            type="button"
            title="Previous task"
            aria-label="Previous task"
            :disabled="!previousId"
            @click="open(previousId)"
          >
            <span class="material-symbols-outlined" aria-hidden="true">expand_less</span>
          </button>
          <button
            class="task-panel-next"
            type="button"
            title="Next task"
            aria-label="Next task"
            :disabled="!nextId"
            @click="open(nextId)"
          >
            <span class="material-symbols-outlined" aria-hidden="true">expand_more</span>
          </button>
          <button
            class="task-panel-delete"
            type="button"
            title="Delete task"
            aria-label="Delete task"
            @click="remove()"
          >
            <span class="material-symbols-outlined" aria-hidden="true">more_horiz</span>
          </button>
          <button
            class="task-panel-close"
            type="button"
            title="Close"
            aria-label="Close task"
            @click="close()"
          >
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>
      </header>

      <div class="task-panel-body">
        <div class="task-panel-main">
          <h2 class="task-panel-title">{{ item?.content }}</h2>
        </div>
        <aside class="task-panel-rail"></aside>
      </div>
    </div>
  </div>
</template>

<style scoped>
.task-panel-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 48px 24px;
  background: rgba(0, 0, 0, 0.35);
}

.task-panel {
  width: 100%;
  max-width: 860px;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-dialog);
  border-radius: 10px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
  overflow: hidden;
}

.task-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color);
}

.task-panel-project {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  color: var(--text-secondary);
}

.task-panel-project .material-symbols-outlined {
  font-size: 18px;
}

.task-panel-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.task-panel-actions button {
  display: flex;
  align-items: center;
  padding: 4px;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--text-secondary);
  cursor: pointer;
}

.task-panel-actions button:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.task-panel-actions button:disabled {
  opacity: 0.35;
  cursor: default;
}

.task-panel-body {
  display: flex;
  min-height: 0;
  flex: 1;
}

.task-panel-main {
  flex: 1;
  min-width: 0;
  padding: 20px 24px;
  overflow-y: auto;
}

.task-panel-rail {
  width: 260px;
  flex: 0 0 auto;
  padding: 20px;
  border-left: 1px solid var(--border-color);
  background: var(--bg-app);
}

.task-panel-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
}
</style>
