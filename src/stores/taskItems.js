import { defineStore } from 'pinia'

import { authHeaders as buildAuthHeaders } from '../lib/authHeaders'
import { TASKS_API_URL } from '../lib/apiWorkers'
import { localToday } from '../lib/localDate'
import { dealPositions, sortForList } from '../lib/taskOrder'
import { useInboxStore } from './inbox'

// Re-arranging sends the whole order, so the requests must reach the server
// in the order they were made; one chain carries them. reorderSeq tells a
// failed older request not to roll back a newer order.
let reorderQueue = Promise.resolve()
let reorderSeq = 0

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
    // Delegates so a dead session is recognised in one place: it sends the
    // person to sign in rather than letting each store report a generic
    // failure against a session that will never work again.
    authHeaders(extra = {}) {
      return buildAuthHeaders(extra)
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
        // Today spans every project and needs the caller's own date; the
        // Worker refuses the request without one.
        const date = project === 'today' ? `&date=${localToday()}` : ''
        const { items } = await this.request('GET', {
          params: `?project=${encodeURIComponent(project)}${date}`,
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

    // Whether a task belongs in the list currently on screen. Add Task creates
    // in the Inbox from anywhere, so a new task must not appear under whatever
    // heading happens to be open. A sub-task travels with its parent: it
    // belongs wherever the parent is already listed, which also covers Today,
    // where a fresh sub-task has no due date of its own to qualify on.
    belongsToLoadedList(item) {
      if (this.loadedProject === null) return false
      if (item.parentId) return this.items.some((row) => row.id === item.parentId)
      // Today carries overdue tasks forward, so it is "due on or before".
      if (this.loadedProject === 'today')
        return Boolean(item.dueDate) && item.dueDate <= localToday()
      if (this.loadedProject === 'inbox') return item.projectId === null
      return item.projectId === this.loadedProject
    },

    // A sub-task sends only its parent — the server derives the project from
    // the parent row, so the two can never disagree.
    async createItem({ content, projectId = null, parentId = null }) {
      try {
        const body = parentId === null ? { content, projectId } : { content, parentId }
        const { item } = await this.request('POST', { body })
        if (this.belongsToLoadedList(item)) this.items.push(item)
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
        // A completed task leaves the visible list; it is not deleted. A
        // completed sub-task stays: the panel shows it checked and counts it
        // into its "done/total" progress. A task moved to another project
        // (dragged onto it in the sidebar, or via the panel) leaves too.
        const moved =
          Object.hasOwn(body, 'projectId') &&
          this.loadedProject !== null &&
          !this.belongsToLoadedList(updated)
        if (!updated.parentId && (updated.completedAt || moved)) {
          this.items = this.items.filter((row) => row.id !== id)
        }
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
      return this.patchItem(id, { description }, { description }, 'Failed to save the description.')
    },

    // `dueDate` is 'YYYY-MM-DD', or null to clear it. The server refuses
    // anything else rather than clearing the date, so a rejection here is a
    // real error worth surfacing.
    setDueDate(id, dueDate) {
      return this.patchItem(id, { dueDate }, { dueDate }, 'Failed to set the date.')
    },

    // `priority` is an integer 1..4 (1 most urgent, 4 the default). The
    // server refuses anything else rather than clamping it, so a rejection is
    // a real error worth surfacing.
    setPriority(id, priority) {
      return this.patchItem(id, { priority }, { priority }, 'Failed to set the priority.')
    },

    // `projectId` is a project id, or null for the Inbox — which is the
    // absence of a project rather than a project of its own.
    moveItem(id, projectId) {
      return this.patchItem(id, { projectId }, { projectId }, 'Failed to move the task.')
    },

    // Drag-and-drop re-arranging: `ids` are the rows of one list (or, in
    // Today, of one day) in their new order — lib/taskOrder's orderAfterDrop.
    // Their existing positions are dealt back out in that order, locally at
    // once and on the server in one statement. Requests go out one at a time
    // so two quick drags cannot land out of order, and a reply or failure
    // from an older drag never overwrites a newer one's order.
    async reorderItems(ids) {
      if (!ids?.length) return false
      const seq = ++reorderSeq
      const previous = new Map(this.items.map((row) => [row.id, row.position]))
      const dealt = dealPositions(this.items, ids)
      for (const row of this.items) {
        if (dealt.has(row.id)) row.position = dealt.get(row.id)
      }
      this.items = sortForList(this.items, this.loadedProject)

      const send = () => this.request('POST', { params: '/reorder', body: { ids } })
      reorderQueue = reorderQueue.catch(() => {}).then(send)
      try {
        await reorderQueue
        return true
      } catch (error) {
        if (seq !== reorderSeq) return false
        console.error('Failed to re-arrange tasks:', error)
        for (const row of this.items) {
          if (previous.has(row.id)) row.position = previous.get(row.id)
        }
        this.items = sortForList(this.items, this.loadedProject)
        this.notify(error.userMessage || 'Failed to re-arrange the tasks.', 'error')
        return false
      }
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
