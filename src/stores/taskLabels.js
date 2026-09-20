import { toRaw } from 'vue'
import { defineStore } from 'pinia'
import { jsonRequest } from '../lib/jsonRequest'

import { authHeaders as buildAuthHeaders } from '../lib/authHeaders'
import { TASKS_API_URL } from '../lib/apiWorkers'
import { useInboxStore } from './inbox'
import { useTaskItemsStore } from './taskItems'

const labelLoads = new WeakMap()

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

    async loadLabels({ force = false } = {}) {
      if (this.isLoaded && !force) return
      const inFlight = labelLoads.get(toRaw(this))
      if (inFlight) return inFlight
      this.isLoading = true
      const load = (async () => {
        try {
          const { labels } = await this.request('GET')
          this.labels = [...labels].sort(byNameOrder)
          this.isLoaded = true
        } catch (error) {
          console.error('Failed to load labels:', error)
          this.notify('Failed to load labels.', 'error')
        } finally {
          this.isLoading = false
          labelLoads.delete(toRaw(this))
        }
      })()
      labelLoads.set(toRaw(this), load)
      return load
    },

    async createLabel({ name, color }) {
      await labelLoads.get(toRaw(this))
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

    async patchLabel(id, changes, failureMessage) {
      await labelLoads.get(toRaw(this))
      const label = this.labels.find((row) => row.id === id)
      if (!label) {
        this.notify(failureMessage, 'error')
        return null
      }
      const previous = { ...label }
      Object.assign(label, changes)
      try {
        const { label: updated } = await this.request('PATCH', { id, ...changes })
        Object.assign(label, updated)
        if (updated.name !== previous.name) {
          this.labels = [...this.labels].sort(byNameOrder)
          rewriteLoadedTasks((labels) =>
            labels.map((name) => (name === previous.name ? updated.name : name)),
          )
        }
        return label
      } catch (error) {
        console.error('Failed to update label:', error)
        Object.assign(label, previous)
        this.notify(error.userMessage || failureMessage, 'error')
        return null
      }
    },

    renameLabel(id, name) {
      return this.patchLabel(id, { name }, 'Failed to rename the label.')
    },

    recolourLabel(id, color) {
      return this.patchLabel(id, { color }, 'Failed to change the label colour.')
    },

    async deleteLabel(id) {
      await labelLoads.get(toRaw(this))
      const doomed = this.labels.find((row) => row.id === id)
      if (!doomed) return false
      const previous = this.labels
      this.labels = this.labels.filter((label) => label.id !== id)
      try {
        await this.request('DELETE', { id })
        rewriteLoadedTasks((labels) => labels.filter((name) => name !== doomed.name))
        return true
      } catch (error) {
        console.error('Failed to delete label:', error)
        this.labels = previous
        this.notify(error.userMessage || 'Failed to delete the label.', 'error')
        return false
      }
    },
  },
})
