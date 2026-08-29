import { defineStore } from 'pinia'

import { getAuth0 } from '../auth0-client'
import { TASKS_API_URL } from '../lib/apiWorkers'
import { useInboxStore } from './inbox'

// Cookie-owned tasks for the Tasks app. Shaped after stores/projects.js: the
// same auth headers, the same request helper that surfaces the server's own
// error text, and local state updated optimistically with a rollback when the
// server refuses.
export const useTaskItemsStore = defineStore('taskItems', {
  state: () => ({
    items: [],
    // Which project the loaded items belong to ('inbox' or a project id), so
    // navigating between projects refetches rather than showing the last one.
    loadedProject: null,
    isLoading: false,
  }),

  getters: {
    // The panel is addressed by URL, so it resolves its task out of whatever
    // the list has already loaded rather than fetching one by id.
    itemById: (state) => (id) => state.items.find((row) => row.id === id),
  },

  actions: {
    async authHeaders(extra = {}) {
      const headers = { ...extra }
      const auth0 = getAuth0()
      if (auth0) {
        const token = await auth0.getAccessTokenSilently()
        headers.Authorization = `Bearer ${token}`
      }
      return headers
    },

    notify(message, kind = 'info') {
      useInboxStore().notify(message, kind)
    },

    async request(method, { params = '', body } = {}) {
      const headers = await this.authHeaders(
        body !== undefined ? { 'Content-Type': 'application/json' } : {},
      )
      const options = { method, headers }
      if (body !== undefined) options.body = JSON.stringify(body)
      const response = await fetch(`${TASKS_API_URL}/task-items${params}`, options)
      if (!response.ok) {
        const error = new Error(`${method} /task-items responded ${response.status}`)
        error.status = response.status
        // The server explains permanent refusals; a parse failure here must
        // not mask the HTTP error.
        try {
          const data = await response.json()
          const serverMessage = String(data?.error ?? '')
          if (serverMessage) {
            error.message = serverMessage
            error.userMessage = serverMessage
          }
        } catch {
          // Body absent or unparseable: keep the generic HTTP-status message
          // rather than let a parse failure mask the original error.
        }
        throw error
      }
      return response.json()
    },

    async loadItems(project, { force = false } = {}) {
      if (this.loadedProject === project && !force) return
      // Clear the previous project's tasks and disown loadedProject before
      // the request goes out, so a switch never leaves the last project's
      // rows on screen under the new heading — whether the fetch is slow or
      // it fails outright. loadedProject is set back to `project` only on
      // success, so a failed load also leaves the store retryable rather
      // than stuck believing it already "loaded" nothing.
      this.items = []
      this.loadedProject = null
      this.isLoading = true
      try {
        const { items } = await this.request('GET', {
          params: `?project=${encodeURIComponent(project)}`,
        })
        this.items = items
        this.loadedProject = project
      } catch (error) {
        console.error('Failed to load tasks:', error)
        this.notify(error.userMessage || 'Failed to load tasks.', 'error')
      } finally {
        this.isLoading = false
      }
    },

    // Counts every task in the given projects, completed included, since a
    // project delete cascades to all of them regardless of completion state.
    // Read-only: used only to name what a delete is about to destroy before
    // it happens, never to populate the visible list.
    async countForProjects(ids) {
      const results = await Promise.all(
        ids.map((id) =>
          this.request('GET', { params: `?project=${encodeURIComponent(id)}&completed=1` }),
        ),
      )
      return results.reduce((total, { items = [] }) => total + items.length, 0)
    },

    async createItem({ content, projectId = null }) {
      try {
        const { item } = await this.request('POST', { body: { content, projectId } })
        this.items.push(item)
        return item
      } catch (error) {
        console.error('Failed to create task:', error)
        this.notify(error.userMessage || 'Failed to create the task.', 'error')
        return null
      }
    },

    // `localPatch` is applied optimistically to the stored item, so it must
    // only ever contain real item fields (content, completedAt, ...) — never
    // a wire-only field like `completed`, or a failed rollback would leave a
    // stray key on the item forever (Object.assign can add a property but
    // never remove one). `body` is the separate, possibly different, request
    // payload the server expects.
    async patchItem(id, localPatch, body, failureMessage) {
      const item = this.items.find((row) => row.id === id)
      if (!item) {
        this.notify(failureMessage, 'error')
        return null
      }
      const previous = { ...item }
      Object.assign(item, localPatch)
      try {
        const { item: updated } = await this.request('PATCH', { body: { id, ...body } })
        Object.assign(item, updated)
        // A completed task leaves the visible list; it is not deleted.
        if (updated.completedAt) this.items = this.items.filter((row) => row.id !== id)
        return item
      } catch (error) {
        console.error('Failed to update task:', error)
        Object.assign(item, previous)
        this.notify(error.userMessage || failureMessage, 'error')
        return null
      }
    },

    renameItem(id, content) {
      return this.patchItem(id, { content }, { content }, 'Failed to rename the task.')
    },

    describeItem(id, description) {
      return this.patchItem(
        id,
        { description },
        { description },
        'Failed to save the description.',
      )
    },

    // `dueDate` is 'YYYY-MM-DD', or null to clear it. The server refuses
    // anything else rather than clearing the date, so a rejection here is a
    // real error worth surfacing.
    setDueDate(id, dueDate) {
      return this.patchItem(id, { dueDate }, { dueDate }, 'Failed to set the date.')
    },

    setCompleted(id, completed) {
      // `completed` is a request field; `completedAt` is the item's actual
      // state, so that's what gets set locally.
      const completedAt = completed ? new Date().toISOString() : null
      return this.patchItem(id, { completedAt }, { completed }, 'Failed to update the task.')
    },

    async deleteItem(id) {
      const previous = this.items
      this.items = this.items.filter((row) => row.id !== id)
      try {
        await this.request('DELETE', { body: { id } })
        return true
      } catch (error) {
        console.error('Failed to delete task:', error)
        this.items = previous
        this.notify(error.userMessage || 'Failed to delete the task.', 'error')
        return false
      }
    },
  },
})
