import { defineStore } from 'pinia'

import { TASKS_API_URL } from '../lib/apiWorkers'
import { authHeaders as buildAuthHeaders } from '../lib/authHeaders'
import { jsonRequest } from '../lib/jsonRequest'
import { useInboxStore } from './inbox'

// The discussion thread under each task: text comments and file attachments
// served by cookie-web-tasks under /task-comments. One thread per task,
// loaded when the task panel opens and kept while the Tasks app is mounted,
// so closing and reopening a task does not refetch. Shaped after
// stores/taskItems.js: the same auth headers, the same request helper that
// surfaces the server's own error text, local state updated as the server
// confirms each write, with a rollback where the change was shown early.

const EMPTY_THREAD = Object.freeze({
  comments: [],
  nextCursor: null,
  loaded: false,
  loading: false,
  error: null,
})

function newThread() {
  return { comments: [], nextCursor: null, loaded: false, loading: false, error: null }
}

export const useTaskCommentsStore = defineStore('taskComments', {
  state: () => ({
    // taskId → thread
    threads: {},
    // Ids of comments with a write in flight, so the buttons on that entry
    // are disabled rather than double-submitted.
    busyIds: [],
  }),

  getters: {
    thread: (state) => (taskId) => state.threads[taskId] ?? EMPTY_THREAD,
  },

  actions: {
    authHeaders(extra = {}) {
      return buildAuthHeaders(extra)
    },

    notify(message, kind = 'info') {
      useInboxStore().notify(message, kind)
    },

    async request(method, path, { body } = {}) {
      const headers = await this.authHeaders(
        body !== undefined ? { 'Content-Type': 'application/json' } : {},
      )
      return jsonRequest(`${TASKS_API_URL}/task-comments${path}`, { method, headers, body })
    },

    ensureThread(taskId) {
      if (!this.threads[taskId]) this.threads[taskId] = newThread()
      return this.threads[taskId]
    },

    // Oldest first, 100 at a time; `more` continues past the last page's
    // cursor. A loaded thread is reused unless forced.
    async loadThread(taskId, { more = false, force = false } = {}) {
      const thread = this.ensureThread(taskId)
      if (thread.loading) return
      if (thread.loaded && !more && !force) return
      if (more && !thread.nextCursor) return
      thread.loading = true
      thread.error = null
      try {
        const params = new URLSearchParams({ task: taskId })
        if (more) params.set('after', thread.nextCursor)
        const { comments = [], nextCursor = null } = await this.request('GET', `?${params}`)
        // The thread may have been dropped (task deleted) while the page
        // was in flight; a reply for a thread no longer kept is discarded.
        if (this.threads[taskId] !== thread) return
        const seen = new Set(more ? thread.comments.map((row) => row.id) : [])
        const incoming = comments.filter((row) => !seen.has(row.id))
        thread.comments = more ? [...thread.comments, ...incoming] : incoming
        thread.nextCursor = nextCursor
        thread.loaded = true
      } catch (error) {
        if (this.threads[taskId] !== thread) return
        console.error('Failed to load comments:', error)
        thread.error = error.userMessage || 'Failed to load comments.'
      } finally {
        thread.loading = false
      }
    },

    // One multipart request carrying the text and, when chosen, the file.
    // The entry appears once the server has it: the id, stamps and sniffed
    // type come back from the row, and a refused upload leaves the draft in
    // the composer rather than a ghost in the thread.
    async addComment(taskId, { body = '', file = null } = {}) {
      const thread = this.ensureThread(taskId)
      try {
        const form = new FormData()
        form.append('task', taskId)
        form.append('body', String(body ?? '').trim())
        if (file) form.append('file', file)
        const headers = await this.authHeaders()
        const response = await fetch(`${TASKS_API_URL}/task-comments`, {
          method: 'POST',
          headers,
          body: form,
        })
        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          const error = new Error(data.error || `Comment failed (${response.status})`)
          error.status = response.status
          throw error
        }
        const { comment } = await response.json()
        if (!thread.comments.some((row) => row.id === comment.id)) thread.comments.push(comment)
        return comment
      } catch (error) {
        console.error('Failed to add comment:', error)
        this.notify(error.message || 'Failed to add the comment.', 'error')
        return null
      }
    },

    async editComment(taskId, id, body) {
      return this.patchComment(taskId, id, { body }, 'Failed to save the comment.')
    },

    // Takes the file off an entry that still has text; the entry stays.
    async removeAttachment(taskId, id) {
      return this.patchComment(taskId, id, { attachment: null }, 'Failed to remove the attachment.')
    },

    async patchComment(taskId, id, body, failureMessage) {
      if (this.busyIds.includes(id)) return null
      const thread = this.ensureThread(taskId)
      this.busyIds.push(id)
      try {
        const { comment } = await this.request('PATCH', `/${encodeURIComponent(id)}`, { body })
        const index = thread.comments.findIndex((row) => row.id === id)
        if (index >= 0) thread.comments.splice(index, 1, comment)
        return comment
      } catch (error) {
        console.error('Failed to update comment:', error)
        this.notify(error.userMessage || failureMessage, 'error')
        return null
      } finally {
        this.busyIds = this.busyIds.filter((busy) => busy !== id)
      }
    },

    // Removed from the thread at once and put back in place if the server
    // refuses, the way deleting a task works.
    async deleteComment(taskId, id) {
      if (this.busyIds.includes(id)) return false
      const thread = this.ensureThread(taskId)
      const index = thread.comments.findIndex((row) => row.id === id)
      const removed = thread.comments[index]
      if (index >= 0) thread.comments.splice(index, 1)
      this.busyIds.push(id)
      try {
        await this.request('DELETE', `/${encodeURIComponent(id)}`)
        return true
      } catch (error) {
        console.error('Failed to delete comment:', error)
        if (removed && !thread.comments.some((row) => row.id === id)) {
          thread.comments.splice(Math.min(index, thread.comments.length), 0, removed)
        }
        this.notify(error.userMessage || 'Failed to delete the comment.', 'error')
        return false
      } finally {
        this.busyIds = this.busyIds.filter((busy) => busy !== id)
      }
    },

    // The attachment route needs the bearer header, so the bytes are fetched
    // here and shown or saved through an object URL by the caller.
    async fetchAttachmentBlob(id) {
      const headers = await this.authHeaders()
      const response = await fetch(
        `${TASKS_API_URL}/task-comments/${encodeURIComponent(id)}/attachment`,
        { headers },
      )
      if (!response.ok) throw new Error(`Download failed (${response.status})`)
      return response.blob()
    },

    // A deleted task takes its thread with it on the server; forget it here
    // too so a reopened id (a stale link) does not show the old entries.
    forgetThread(taskId) {
      delete this.threads[taskId]
    },
  },
})
