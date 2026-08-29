<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import { useProjectsStore } from '../stores/projects'
import { useTaskItemsStore } from '../stores/taskItems'

const route = useRoute()
const projects = useProjectsStore()
const items = useTaskItemsStore()

// 'inbox' is a filter, not a project id — the Inbox is the tasks that belong
// to no project, so there is no row to look up.
const project = computed(() => String(route.query.project ?? 'inbox'))
const isInbox = computed(() => project.value === 'inbox')
const current = computed(() =>
  isInbox.value ? null : projects.projects.find((row) => row.id === project.value),
)
const ancestors = computed(() =>
  isInbox.value ? [] : projects.ancestorsOf(project.value).slice(0, -1),
)
const title = computed(() => (isInbox.value ? 'Inbox' : (current.value?.name ?? '')))

onMounted(() => {
  projects.loadProjects()
  items.loadItems(project.value)
})

watch(project, (next) => items.loadItems(next))

const editingTitle = ref(false)
const titleDraft = ref('')
const titleInput = ref(null)

async function startTitleEdit() {
  if (isInbox.value) return
  titleDraft.value = current.value?.name ?? ''
  editingTitle.value = true
  await nextTick()
  titleInput.value?.focus()
  titleInput.value?.select()
}

async function submitTitle() {
  // Enter commits and unmounts the input, which fires blur; the second call
  // must be a no-op or every rename would be sent twice.
  if (!editingTitle.value) return
  const name = titleDraft.value.trim()
  editingTitle.value = false
  if (name && name !== current.value?.name) await projects.renameProject(project.value, name)
}

const editingDescription = ref(false)
const descriptionDraft = ref('')
const descriptionInput = ref(null)

async function startDescriptionEdit() {
  if (isInbox.value) return
  descriptionDraft.value = current.value?.description ?? ''
  editingDescription.value = true
  await nextTick()
  descriptionInput.value?.focus()
}

async function submitDescription() {
  // Same Enter-then-blur double fire as submitTitle.
  if (!editingDescription.value) return
  const description = descriptionDraft.value.trim()
  editingDescription.value = false
  if (description !== (current.value?.description ?? '')) {
    await projects.describeProject(project.value, description)
  }
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
      v-if="editingTitle"
      ref="titleInput"
      v-model="titleDraft"
      class="tasks-title-input"
      aria-label="Project name"
      @keydown.enter.prevent="submitTitle"
      @keydown.escape="editingTitle = false"
      @blur="submitTitle"
    />
    <h1 v-else class="tasks-title" @click="startTitleEdit">{{ title }}</h1>

    <input
      v-if="editingDescription"
      ref="descriptionInput"
      v-model="descriptionDraft"
      class="tasks-description-input"
      placeholder="Add a description"
      aria-label="Project description"
      @keydown.enter.prevent="submitDescription"
      @keydown.escape="editingDescription = false"
      @blur="submitDescription"
    />
    <p v-else-if="!isInbox" class="tasks-description" @click="startDescriptionEdit">
      {{ current?.description || 'Add a description' }}
    </p>
  </div>
</template>

<style scoped>
.tasks-view {
  max-width: 720px;
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
}

.tasks-title-input,
.tasks-description-input {
  display: block;
  width: 100%;
  font: inherit;
  color: inherit;
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 2px 6px;
}

.tasks-title-input {
  margin: 18px 0 6px;
  font-size: 26px;
  font-weight: 700;
}

.tasks-description-input {
  margin: 0 0 24px;
  font-size: 14px;
}
</style>
