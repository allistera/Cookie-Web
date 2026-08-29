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
          const body = await response.json()
          if (body?.error) error.userMessage = String(body.error)
        } catch {
          // no usable body — the generic message stands
        }
        throw error
      }
      return response.json()
    },

    async loadItems(project, { force = false } = {}) {
      if (this.loadedProject === project && !force) return
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

    async patchItem(id, changes, failureMessage) {
      const item = this.items.find((row) => row.id === id)
      if (!item) {
        this.notify(failureMessage, 'error')
        return null
      }
      const previous = { ...item }
      Object.assign(item, changes)
      try {
        const { item: updated } = await this.request('PATCH', { body: { id, ...changes } })
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
      return this.patchItem(id, { content }, 'Failed to rename the task.')
    },

    setCompleted(id, completed) {
      return this.patchItem(id, { completed }, 'Failed to update the task.')
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
