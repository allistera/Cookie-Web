<script setup>
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import {
  DUE_OPTIONS,
  FILTER_FIELDS,
  MAX_FILTER_RULES,
  defaultRuleValue,
  filterDraftError,
  filterRoute,
  newFilterRule,
} from '../lib/taskFilters'
import { PRIORITIES } from '../lib/taskPriority'
import { flattenProjectTree } from '../lib/taskProjectsTree'
import { useProjectsStore } from '../stores/projects'
import { useTaskFiltersStore } from '../stores/taskFilters'
import { useTaskItemsStore } from '../stores/taskItems'
import { useTaskLabelsStore } from '../stores/taskLabels'

// The one create/edit form for saved task filters, mounted by TasksSidebar
// while store.editor holds a draft: opened from the sidebar's "+" and a
// row's edit button, and from the filter view's "Edit filter". A rule reads
// as a sentence — "Due is Today", "Project is not Work" — and the Save
// button stays off until the draft is something the Worker would keep.
const store = useTaskFiltersStore()
const projects = useProjectsStore()
const labels = useTaskLabelsStore()
const items = useTaskItemsStore()
const route = useRoute()
const router = useRouter()
const dialog = ref(null)
const nameInput = ref(null)

const editor = computed(() => store.editor)
const isEdit = computed(() => editor.value?.mode === 'edit')
const problem = computed(() => filterDraftError(editor.value))

// Every project, nested ones indented, so the select reads like the sidebar.
const projectOptions = computed(() =>
  flattenProjectTree(projects.projects, new Set(projects.projects.map((project) => project.id))),
)

onMounted(async () => {
  projects.loadProjects()
  labels.loadLabels()
  if (!dialog.value?.open) dialog.value?.showModal?.()
  await nextTick()
  nameInput.value?.focus()
})

function close() {
  store.closeEditor()
}

// A new field gets a value that is always a legal choice for it.
function setField(rule, field) {
  rule.field = field
  rule.value = defaultRuleValue(field, { labels: labels.labels })
}

function addRule() {
  if (editor.value.rules.length >= MAX_FILTER_RULES) return
  editor.value.rules.push(newFilterRule('due'))
}

function removeRule(index) {
  editor.value.rules.splice(index, 1)
}

async function save() {
  const fields = editor.value
  if (!fields || problem.value) return
  // Read before the editor closes and takes the mode with it.
  const editing = isEdit.value
  const filter = editing
    ? await store.updateFilter(fields.id, fields)
    : await store.createFilter(fields)
  if (!filter) return
  store.closeEditor()
  // A new filter opens straight away; an edited one refetches its list if
  // that is what is on screen, so the rows match the new rules.
  const project = `filter:${filter.id}`
  if (!editing) router.push(filterRoute(filter))
  else if (route.query.project === project) items.loadItems(project, { force: true })
}
</script>

<template>
  <dialog
    ref="dialog"
    class="task-filter-editor"
    :aria-label="isEdit ? 'Edit filter' : 'New filter'"
    @cancel.prevent="close"
    @click.stop
    @keydown.stop
  >
    <form v-if="editor" method="dialog" @submit.prevent="save">
      <div class="task-filter-editor-body">
        <h2>{{ isEdit ? 'Edit filter' : 'New filter' }}</h2>
        <input
          ref="nameInput"
          v-model="editor.name"
          class="task-filter-name"
          type="text"
          maxlength="60"
          placeholder="Filter name"
          aria-label="Filter name"
          required
        />

        <p class="task-filter-match">
          Show tasks that match
          <select v-model="editor.match" aria-label="Match">
            <option value="all">all</option>
            <option value="any">any</option>
          </select>
          of these rules
        </p>

        <ul class="task-filter-rules">
          <li v-for="(rule, index) in editor.rules" :key="index" class="task-filter-rule">
            <select
              :value="rule.field"
              :aria-label="`Rule ${index + 1} field`"
              @change="setField(rule, $event.target.value)"
            >
              <option v-for="field in FILTER_FIELDS" :key="field.value" :value="field.value">
                {{ field.label }}
              </option>
            </select>
            <select v-model="rule.negate" :aria-label="`Rule ${index + 1} includes or excludes`">
              <option :value="false">is</option>
              <option :value="true">is not</option>
            </select>
            <select
              v-if="rule.field === 'due'"
              v-model="rule.value"
              :aria-label="`Rule ${index + 1} due`"
            >
              <option v-for="option in DUE_OPTIONS" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
            <select
              v-else-if="rule.field === 'project'"
              v-model="rule.value"
              :aria-label="`Rule ${index + 1} project`"
            >
              <option value="inbox">Inbox</option>
              <option v-for="row in projectOptions" :key="row.item.id" :value="row.item.id">
                {{ ' '.repeat(row.depth) }}{{ row.item.name }}
              </option>
            </select>
            <select
              v-else-if="rule.field === 'priority'"
              v-model="rule.value"
              :aria-label="`Rule ${index + 1} priority`"
            >
              <option v-for="priority in PRIORITIES" :key="priority.value" :value="priority.value">
                {{ priority.label }}
              </option>
            </select>
            <select v-else v-model="rule.value" :aria-label="`Rule ${index + 1} label`">
              <option v-if="!labels.labels.length" value="" disabled>No labels yet</option>
              <option v-for="label in labels.labels" :key="label.id" :value="label.name">
                @{{ label.name }}
              </option>
            </select>
            <button
              type="button"
              class="task-filter-rule-remove"
              :aria-label="`Remove rule ${index + 1}`"
              title="Remove rule"
              :disabled="editor.rules.length === 1"
              @click="removeRule(index)"
            >
              <span class="material-symbols-outlined" aria-hidden="true">close</span>
            </button>
          </li>
        </ul>
        <button
          type="button"
          class="task-filter-add-rule"
          :disabled="editor.rules.length >= MAX_FILTER_RULES"
          @click="addRule"
        >
          <span class="material-symbols-outlined" aria-hidden="true">add</span>
          Add rule
        </button>

        <p v-if="store.error" class="task-filter-editor-error" role="alert">{{ store.error }}</p>
      </div>

      <div class="task-filter-editor-footer">
        <span class="task-filter-editor-hint">{{ problem }}</span>
        <div class="task-filter-editor-actions">
          <button type="button" class="task-filter-cancel" @click="close">Cancel</button>
          <button
            type="submit"
            class="task-filter-submit"
            :disabled="Boolean(problem) || store.saving"
          >
            {{ isEdit ? 'Save changes' : 'Save filter' }}
          </button>
        </div>
      </div>
    </form>
  </dialog>
</template>

<style scoped>
.task-filter-editor {
  width: min(560px, calc(100vw - 32px));
  max-height: calc(100dvh - 48px);
  /* The global reset zeroes margins; a modal dialog centres by margin. */
  margin: auto;
  padding: 0;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--bg-dialog);
  color: var(--text-primary);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
}

.task-filter-editor::backdrop {
  background: rgba(0, 0, 0, 0.35);
}

.task-filter-editor-body {
  padding: 18px 20px 16px;
}

.task-filter-editor h2 {
  margin: 0 0 10px;
  font-size: 20px;
}

.task-filter-name {
  display: block;
  box-sizing: border-box;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--text-primary);
  font: inherit;
  font-size: 15px;
}

.task-filter-name:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}

.task-filter-match {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 18px 0 10px;
  font-size: 14px;
  color: var(--text-secondary);
}

.task-filter-editor select {
  padding: 6px 28px 6px 10px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-card);
  color: var(--text-primary);
  font: inherit;
  font-size: 13px;
}

.task-filter-rules {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

/* Field, is/is not, value, remove: the value takes whatever width is left,
   and on a narrow screen the row wraps rather than squeezing the selects. */
.task-filter-rule {
  display: grid;
  grid-template-columns: auto auto minmax(120px, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-input);
}

.task-filter-rule select {
  min-width: 0;
}

@media (max-width: 520px) {
  .task-filter-rule {
    grid-template-columns: 1fr 1fr;
  }
}

.task-filter-rule-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--text-secondary);
  cursor: pointer;
}

.task-filter-rule-remove:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.task-filter-rule-remove:disabled {
  opacity: 0.35;
  cursor: default;
}

.task-filter-rule-remove .material-symbols-outlined {
  font-size: 18px;
}

.task-filter-add-rule {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  padding: 6px 10px 6px 6px;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--text-secondary);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.task-filter-add-rule:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.task-filter-add-rule:disabled {
  opacity: 0.5;
  cursor: default;
}

.task-filter-add-rule .material-symbols-outlined {
  font-size: 18px;
}

.task-filter-editor-error {
  margin: 12px 0 0;
  color: var(--text-red, #c53636);
  font-size: 13px;
}

.task-filter-editor-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-top: 1px solid var(--border-color);
}

.task-filter-editor-hint {
  font-size: 13px;
  color: var(--text-secondary);
}

.task-filter-editor-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.task-filter-editor-actions button {
  padding: 6px 14px;
  border-radius: 6px;
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}

.task-filter-cancel {
  border: 1px solid var(--border-color);
  background: transparent;
  color: var(--text-primary);
}

.task-filter-cancel:hover {
  background: var(--bg-hover);
}

.task-filter-submit {
  border: 1px solid transparent;
  background: var(--accent);
  color: #fff;
}

.task-filter-submit:hover:not(:disabled) {
  background: var(--accent-hover);
}

.task-filter-submit:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
