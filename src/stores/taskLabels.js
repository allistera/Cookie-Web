import { toRaw } from 'vue'
import { defineStore } from 'pinia'
import { jsonRequest } from '../lib/jsonRequest'

import { authHeaders as buildAuthHeaders } from '../lib/authHeaders'
import { TASKS_API_URL } from '../lib/apiWorkers'
import { createSharedLoad } from '../lib/sharedLoad'
import { useInboxStore } from './inbox'
import { useTaskItemsStore } from './taskItems'

const labelLoads = createSharedLoad()
// Pending edits per label id, per store: one PATCH at a time per label.
const labelMutations = new WeakMap()

function byNameOrder(a, b) {
  return a.name.localeCompare(b.name)
}

// Apply a label-array transform to every loaded task that has labels.
function rewriteLoadedTasks(transform) {
  const items = useTaskItemsStore()
  for (const item of items.items) {
    if (item.labels?.length) item.labels = transform(item.labels)
  }
}

// Managed task labels (task_labels, migration 0079). Shaped after
// stores/projects.js: the same auth headers and request helper, local state
// updated optimistically with a rollback when the server refuses. A task
// carries label names, not ids, so a rename or delete here also rewrites
// the labels on whatever tasks are loaded, matching what the server did.
export const useTaskLabelsStore = defineStore('taskLabels', {
  state: () => ({
    labels: [],
    isLoaded: false,
    isLoading: false,
  }),

  getters: {
    byName: (state) => new Map(state.labels.map((label) => [label.name, label])),
  },

  actions: {
    authHeaders(extra = {}) {
      return buildAuthHeaders(extra)
    },

    notify(message, kind = 'info') {
      useInboxStore().notify(message, kind)
    },

    async request(method, body) {
      const headers = await this.authHeaders(
        body !== undefined ? { 'Content-Type': 'application/json' } : {},
      )
      return jsonRequest(`${TASKS_API_URL}/task-labels`, { method, headers, body })
    },

    // Resolves true once labels are loaded, false when the load failed.
    loadLabels({ force = false } = {}) {
      if (this.isLoaded && !force) return Promise.resolve(true)
      return labelLoads(
        toRaw(this),
        async () => {
          this.isLoading = true
          try {
            const { labels } = await this.request('GET')
            this.labels = [...labels].sort(byNameOrder)
            this.isLoaded = true
            return true
          } catch (error) {
            console.error('Failed to load labels:', error)
            this.notify('Failed to load labels.', 'error')
            return false
          } finally {
            this.isLoading = false
          }
        },
        { force },
      )
    },

    async createLabel({ name, color }) {
      await labelLoads.current(toRaw(this))
      try {
        const { label } = await this.request('POST', { name, color })
        this.labels = [...this.labels, label].sort(byNameOrder)
        return label
      } catch (error) {
        console.error('Failed to create label:', error)
        this.notify(error.userMessage || 'Failed to create the label.', 'error')
        return null
      }
    },

    // Edits to one label run one at a time, so responses land in order. A
    // failed edit undoes only the fields it changed, and only where they
    // still hold its values, so it never reverts a later edit that worked.
    async patchLabel(id, changes, failureMessage) {
      await labelLoads.current(toRaw(this))
      if (!this.labels.some((row) => row.id === id)) {
        this.notify(failureMessage, 'error')
        return null
      }
      const perform = async () => {
        const label = this.labels.find((row) => row.id === id)
        if (!label) {
          this.notify(failureMessage, 'error')
          return null
        }
        const previous = Object.fromEntries(Object.keys(changes).map((key) => [key, label[key]]))
        const previousName = label.name
        Object.assign(label, changes)
        try {
          const { label: updated } = await this.request('PATCH', { id, ...changes })
          const current = this.labels.find((row) => row.id === id) ?? label
          Object.assign(current, updated)
          if (updated.name !== previousName) {
            this.labels = [...this.labels].sort(byNameOrder)
            rewriteLoadedTasks((labels) =>
              labels.map((name) => (name === previousName ? updated.name : name)),
            )
          }
          return current
        } catch (error) {
          console.error('Failed to update label:', error)
          const current = this.labels.find((row) => row.id === id)
          if (current) {
            for (const [key, value] of Object.entries(previous)) {
              if (current[key] === changes[key]) current[key] = value
            }
          }
          this.notify(error.userMessage || failureMessage, 'error')
          return null
        }
      }
      const store = toRaw(this)
      const queue = labelMutations.get(store) ?? new Map()
      labelMutations.set(store, queue)
      const prior = queue.get(id)
      const pending = prior ? prior.then(perform) : perform()
      queue.set(id, pending)
      return pending.finally(() => {
        if (queue.get(id) === pending) queue.delete(id)
      })
    },

    renameLabel(id, name) {
      return this.patchLabel(id, { name }, 'Failed to rename the label.')
    },

    recolourLabel(id, color) {
      return this.patchLabel(id, { color }, 'Failed to change the label colour.')
    },

    async deleteLabel(id) {
      await labelLoads.current(toRaw(this))
      const doomed = this.labels.find((row) => row.id === id)
      if (!doomed) return false
      this.labels = this.labels.filter((label) => label.id !== id)
      try {
        await this.request('DELETE', { id })
        rewriteLoadedTasks((labels) => labels.filter((name) => name !== doomed.name))
        return true
      } catch (error) {
        console.error('Failed to delete label:', error)
        // Put back only the deleted label, so a create or rename that landed
        // meanwhile survives the rollback.
        if (!this.labels.some((label) => label.id === id)) {
          this.labels = [...this.labels, doomed].sort(byNameOrder)
        }
        this.notify(error.userMessage || 'Failed to delete the label.', 'error')
        return false
      }
    },
  },
})
