import { defineStore } from 'pinia'
import { jsonRequest } from '../lib/jsonRequest'

import { authHeaders as buildAuthHeaders } from '../lib/authHeaders'
import { TASKS_API_URL } from '../lib/apiWorkers'
import { localToday } from '../lib/localDate'
import { dealPositions, orderAfterDrop, sortForList } from '../lib/taskOrder'
import { useInboxStore } from './inbox'

// Re-arranging sends the whole order, so the requests must reach the server
// in the order they were made; one chain carries them. reorderSeq tells a
// failed older request not to roll back a newer order.
let reorderQueue = Promise.resolve()
let reorderSeq = 0
const itemMutations = new WeakMap()

// Cookie-owned tasks for the Tasks app. Shaped after stores/projects.js: the
// same auth headers, the same request helper that surfaces the server's own
// error text, and local state updated optimistically with a rollback when the
// server refuses.
export const useTaskItemsStore = defineStore('taskItems', {
  state: () => ({
    items: [],
    nextCursor: null,
    isLoadingMore: false,
    detailLoading: {},
    detailErrors: {},
    detailCursors: {},
    detailCounts: {},
    completingIds: [],
    // Which project the loaded items belong to ('inbox' or a project id), so
    // navigating between projects refetches rather than showing the last one.
    loadedProject: null,
    isLoading: false,
    loadSeq: 0,
    // Action asked for by the command palette: 'new-task' and 'add-divider'
    // (TasksView owns the list) or 'new-project' (TasksSidebar owns the
    // inline project row). The owner consumes it, on mount too if it was
    // raised from another app.
    viewActionRequest: null,
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

    requestViewAction(action) {
      this.viewActionRequest = { id: (this.viewActionRequest?.id ?? 0) + 1, action }
    },

    notify(message, kind = 'info') {
      useInboxStore().notify(message, kind)
    },

    async request(method, { params = '', body } = {}) {
      const headers = await this.authHeaders(
        body !== undefined ? { 'Content-Type': 'application/json' } : {},
      )
      return jsonRequest(`${TASKS_API_URL}/task-items${params}`, { method, headers, body })
    },

    async loadItems(project, { force = false } = {}) {
      if (this.loadedProject === project && !force) return
      // Clear the previous project's tasks and disown loadedProject before
      // the request goes out, so a switch never leaves the last project's
      // rows on screen under the new heading — whether the fetch is slow or
      // it fails outright. loadedProject is set back to `project` only on
      // success, so a failed load also leaves the store retryable rather
      // than stuck believing it already "loaded" nothing.
      const seq = ++this.loadSeq
      this.items = []
      this.nextCursor = null
      this.detailErrors = {}
      this.detailCursors = {}
      this.detailCounts = {}
      this.isLoadingMore = false
      this.loadedProject = null
      this.isLoading = true
      try {
        // Today spans every project and needs the caller's own date; the
        // Worker refuses the request without one.
        const date = project === 'today' ? `&date=${localToday()}` : ''
        const { items, nextCursor } = await this.request('GET', {
          params: `?project=${encodeURIComponent(project)}${date}&view=page`,
        })
        if (seq !== this.loadSeq) return
        this.items = items
        this.nextCursor = nextCursor ?? null
        this.loadedProject = project
      } catch (error) {
        if (seq !== this.loadSeq) return
        console.error('Failed to load tasks:', error)
        this.notify(error.userMessage || 'Failed to load tasks.', 'error')
      } finally {
        if (seq === this.loadSeq) this.isLoading = false
      }
    },

    async loadMoreItems() {
      if (!this.nextCursor || this.isLoadingMore || !this.loadedProject) return
      const seq = this.loadSeq
      const project = this.loadedProject
      this.isLoadingMore = true
      try {
        const params = new URLSearchParams({ project, view: 'page', after: this.nextCursor })
        if (project === 'today') params.set('date', localToday())
        const { items, nextCursor } = await this.request('GET', { params: `?${params}` })
        if (seq !== this.loadSeq) return
        const seen = new Set(this.items.map((item) => item.id))
        this.items.push(...items.filter((item) => !seen.has(item.id)))
        this.nextCursor = nextCursor ?? null
      } catch (error) {
        this.notify(error.userMessage || 'Failed to load more tasks.', 'error')
      } finally {
        this.isLoadingMore = false
      }
    },

    async loadDetail(id, { more = false } = {}) {
      if (this.detailLoading[id]) return
      const seq = this.loadSeq
      this.detailLoading[id] = true
      delete this.detailErrors[id]
      try {
        const params = new URLSearchParams({ view: 'detail', id })
        if (more && this.detailCursors[id]) params.set('after', this.detailCursors[id])
        const {
          item,
          subtasks = [],
          nextCursor,
          counts,
        } = await this.request('GET', { params: `?${params}` })
        if (seq !== this.loadSeq || !item) return
        if (!this.belongsToLoadedList(item)) item.detailOnly = true
        const incoming = new Map([item, ...subtasks].map((row) => [row.id, row]))
        this.items = this.items.filter(
          (row) => !incoming.has(row.id) && (more || row.parentId !== id),
        )
        this.items.push(...incoming.values())
        this.items = sortForList(this.items, this.loadedProject)
        this.detailCursors[id] = nextCursor ?? null
        this.detailCounts[id] = counts
      } catch (error) {
        if (seq !== this.loadSeq) return
        this.detailErrors[id] = error.status === 404 ? 'missing' : 'failed'
        if (error.status !== 404)
          this.notify(error.userMessage || 'Failed to load the task.', 'error')
      } finally {
        this.detailLoading[id] = false
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
      // Dividers are rows too, but nobody counts them as tasks.
      return results.reduce(
        (total, { items = [] }) => total + items.filter((row) => row.kind !== 'divider').length,
        0,
      )
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
    async createItem({ content, projectId = null, parentId = null, recurrence, ...fields }) {
      try {
        const body = parentId === null ? { content, projectId } : { content, parentId }
        if (recurrence?.trim()) Object.assign(body, { recurrence, today: localToday() })
        for (const key of ['description', 'dueDate', 'dueTime', 'timeZone', 'priority', 'labels']) {
          if (fields[key] !== undefined) body[key] = fields[key]
        }
        const { item } = await this.request('POST', { body })
        if (this.belongsToLoadedList(item)) this.items.push(item)
        return item
      } catch (error) {
        console.error('Failed to create task:', error)
        this.notify(error.userMessage || 'Failed to create the task.', 'error')
        return null
      }
    },

    async generateItem(text) {
      const { item, subtasks } = await this.request('POST', {
        params: '/generate',
        body: { text, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' },
      })
      if (this.belongsToLoadedList(item)) {
        this.items.push(item, ...subtasks)
      }
      return item
    },

    async interpretItem(text) {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
      const { draft } = await this.request('POST', {
        params: '/interpret',
        body: { text, timeZone },
      })
      return draft
    },

    setDueTime(id, dueTime, timeZone) {
      return this.patchItem(id, {}, { dueTime, timeZone }, 'Failed to set the time.')
    },

    setLabels(id, labels) {
      return this.patchItem(id, {}, { labels }, 'Failed to save task labels.')
    },

    // A divider is a rule between rows (kind: 'divider'), added from the line
    // under `afterId`. The server puts every new row last, so once it is
    // back the list is re-arranged to carry it up to where it was asked for;
    // a failed re-arrange leaves it at the bottom rather than losing it.
    async addDivider({ projectId = null, afterId }) {
      try {
        const { item } = await this.request('POST', { body: { kind: 'divider', projectId } })
        if (!this.belongsToLoadedList(item)) return item
        this.items.push(item)
        const rows = this.items.filter((row) => !row.parentId && row.id !== item.id)
        const offset =
          Math.floor(
            Math.max(
              0,
              rows.findIndex((row) => row.id === afterId),
            ) / 100,
          ) * 100
        const ids = [...rows.slice(offset, offset + 100).map((row) => row.id), item.id]
        const order = orderAfterDrop(ids, item.id, afterId, 'after')
        if (order) await this.reorderItems(order)
        return item
      } catch (error) {
        console.error('Failed to add divider:', error)
        this.notify(error.userMessage || 'Failed to add the divider.', 'error')
        return null
      }
    },

    // `localPatch` is applied optimistically to the stored item, so it must
    // only ever contain real item fields (content, completedAt, ...) — never
    // a wire-only field like `completed`, or a failed rollback would leave a
    // stray key on the item forever (Object.assign can add a property but
    // never remove one). `body` is the separate, possibly different, request
    // payload the server expects.
    patchItem(id, localPatch, body, failureMessage) {
      let item = this.items.find((row) => row.id === id)
      if (!item) {
        this.notify(failureMessage, 'error')
        return Promise.resolve(null)
      }
      const payload = { ...body }
      // Serialize edits to the same row; a later edit snapshots the last
      // confirmed state, so an earlier response or rollback cannot undo it.
      const perform = async () => {
        item = this.items.find((row) => row.id === id) ?? item
        const previous = { ...item }
        const patch = { ...localPatch }
        Object.assign(item, patch)
        try {
          const { item: updated } = await this.request('PATCH', { body: { id, ...payload } })
          item = this.items.find((row) => row.id === id) ?? item
          Object.assign(item, updated)
          if (this.items.includes(item)) {
            const outsideList = this.loadedProject !== null && !this.belongsToLoadedList(item)
            if (!item.parentId && (item.completedAt || outsideList)) {
              this.items = this.items.filter((row) => row.id !== id)
            }
            if (Object.hasOwn(payload, 'projectId') && this.loadedProject) {
              await this.loadItems(this.loadedProject, { force: true })
            }
          }
          return item
        } catch (error) {
          console.error('Failed to update task:', error)
          for (const key of Object.keys(patch)) {
            if (Object.hasOwn(previous, key)) item[key] = previous[key]
            else delete item[key]
          }
          this.notify(error.userMessage || failureMessage, 'error')
          return null
        }
      }
      const queue = itemMutations.get(this) ?? new Map()
      itemMutations.set(this, queue)
      const prior = queue.get(id)
      const pending = prior ? prior.then(perform) : perform()
      queue.set(id, pending)
      return pending.finally(() => {
        if (queue.get(id) === pending) queue.delete(id)
      })
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

    setRecurrence(id, recurrence) {
      return this.patchItem(
        id,
        {},
        { recurrence, today: localToday() },
        'Failed to set the repeat schedule.',
      )
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
    // A list's rows get their existing positions dealt back out in that
    // order; a day's rows are numbered afresh in todayPosition, Today's own
    // order, so the projects they live in are untouched. Applied locally at
    // once and on the server in one statement. Requests go out one at a time
    // so two quick drags cannot land out of order, and a reply or failure
    // from an older drag never overwrites a newer one's order.
    async reorderItems(ids) {
      if (!ids?.length) return false
      const seq = ++reorderSeq
      const today = this.loadedProject === 'today'
      const key = today ? 'todayPosition' : 'position'
      const previous = new Map(this.items.map((row) => [row.id, row[key]]))
      const next = today
        ? new Map(ids.map((id, index) => [id, index + 1]))
        : dealPositions(this.items, ids)
      for (const row of this.items) {
        if (next.has(row.id)) row[key] = next.get(row.id)
      }
      this.items = sortForList(this.items, this.loadedProject)

      const body = today ? { ids, view: 'today', paged: true } : { ids }
      const send = () => this.request('POST', { params: '/reorder', body })
      reorderQueue = reorderQueue.catch(() => {}).then(send)
      try {
        const result = await reorderQueue
        if (seq === reorderSeq && result?.items) {
          for (const updated of result.items) {
            const row = this.items.find((item) => item.id === updated.id)
            if (row) Object.assign(row, updated)
          }
          this.items = sortForList(this.items, this.loadedProject)
        }
        return true
      } catch (error) {
        if (seq !== reorderSeq) return false
        console.error('Failed to re-arrange tasks:', error)
        for (const row of this.items) {
          if (previous.has(row.id)) row[key] = previous.get(row.id)
        }
        this.items = sortForList(this.items, this.loadedProject)
        this.notify(error.userMessage || 'Failed to re-arrange the tasks.', 'error')
        return false
      }
    },

    async setCompleted(id, completed) {
      if (this.completingIds.includes(id)) return null
      const item = this.itemById(id)
      const recurring = completed && item?.recurrence
      const body = recurring
        ? { completed, today: localToday(), expectedDueDate: item.dueDate }
        : { completed }
      const localPatch = recurring
        ? {}
        : { completedAt: completed ? new Date().toISOString() : null }
      this.completingIds.push(id)
      try {
        return await this.patchItem(id, localPatch, body, 'Failed to update the task.')
      } finally {
        this.completingIds = this.completingIds.filter((pending) => pending !== id)
      }
    },

    async deleteItem(id) {
      const index = this.items.findIndex((row) => row.id === id)
      const removed = this.items[index]
      const generation = this.loadSeq
      const project = this.loadedProject
      this.items = this.items.filter((row) => row.id !== id)
      try {
        await this.request('DELETE', { body: { id } })
        return true
      } catch (error) {
        console.error('Failed to delete task:', error)
        if (
          removed &&
          generation === this.loadSeq &&
          project === this.loadedProject &&
          !this.items.some((row) => row.id === id)
        ) {
          this.items.splice(index, 0, removed)
        }
        this.notify(error.userMessage || 'Failed to delete the task.', 'error')
        return false
      }
    },
  },
})
