import { defineStore } from 'pinia'

import { getAuth0 } from '../auth0-client'
import { TASKS_API_URL } from '../lib/apiWorkers'
import { useInboxStore } from './inbox'

// Cookie-owned projects for the Tasks sidebar. Shaped after stores/documents.js:
// the same auth headers, the same request helper, and local state updated
// optimistically with a rollback when the server refuses.
export const useProjectsStore = defineStore('projects', {
  state: () => ({
    projects: [],
    isLoaded: false,
    isLoading: false,
  }),

  getters: {
    // Every descendant of a project, direct and transitive (not including
    // the project itself). Deleting a project cascades to this whole set,
    // both locally and server-side, so this is the single definition of
    // "the subtree a delete destroys" that both the store and the sidebar's
    // confirmation prompt read from.
    descendantIds: (state) => (id) => {
      const ids = []
      let frontier = [id]
      while (frontier.length) {
        const children = state.projects.filter((project) => frontier.includes(project.parentId))
        frontier = []
        for (const child of children) {
          ids.push(child.id)
          frontier.push(child.id)
        }
      }
      return ids
    },

    // The chain from the root down to (and including) this project, for the
    // view's breadcrumb. A parentId that no longer resolves simply stops the
    // walk rather than looping.
    ancestorsOf: (state) => (id) => {
      const byId = new Map(state.projects.map((project) => [project.id, project]))
      const chain = []
      let current = byId.get(id)
      const seen = new Set()
      while (current && !seen.has(current.id)) {
        seen.add(current.id)
        chain.unshift(current)
        current = current.parentId ? byId.get(current.parentId) : null
      }
      return chain
    },
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

    async request(method, body) {
      const headers = await this.authHeaders(
        body !== undefined ? { 'Content-Type': 'application/json' } : {},
      )
      const options = { method, headers }
      if (body !== undefined) options.body = JSON.stringify(body)
      const response = await fetch(`${TASKS_API_URL}/projects`, options)
      if (!response.ok) {
        const error = new Error(`${method} /projects responded ${response.status}`)
        error.status = response.status
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

    async loadProjects({ force = false } = {}) {
      if (this.isLoaded && !force) return
      this.isLoading = true
      try {
        const { projects } = await this.request('GET')
        this.projects = projects
        this.isLoaded = true
      } catch (error) {
        console.error('Failed to load projects:', error)
        this.notify('Failed to load projects.', 'error')
      } finally {
        this.isLoading = false
      }
    },

    // Created rows come back from the server rather than being guessed at
    // locally, so the id in state is the one that was stored.
    async createProject({ name, parentId = null }) {
      try {
        const { project } = await this.request('POST', { name, parentId })
        this.projects.push(project)
        return project
      } catch (error) {
        console.error('Failed to create project:', error)
        this.notify(error.userMessage || 'Failed to create the project.', 'error')
        return null
      }
    },

    async patchProject(id, changes, failureMessage) {
      const project = this.projects.find((row) => row.id === id)
      if (!project) {
        // The sidebar only ever calls this with an id from a row it is
        // currently rendering, so this should be unreachable in practice.
        // Notify anyway so the contract ("every failed mutation notifies")
        // holds even if a stale id ever slips through.
        this.notify(failureMessage, 'error')
        return null
      }
      const previous = { ...project }
      Object.assign(project, changes)
      try {
        const { project: updated } = await this.request('PATCH', { id, ...changes })
        Object.assign(project, updated)
        return project
      } catch (error) {
        console.error('Failed to update project:', error)
        Object.assign(project, previous)
        this.notify(error.userMessage || failureMessage, 'error')
        return null
      }
    },

    renameProject(id, name) {
      return this.patchProject(id, { name }, 'Failed to rename the project.')
    },

    moveProject(id, parentId) {
      return this.patchProject(id, { parentId }, 'Failed to move the project.')
    },

    describeProject(id, description) {
      return this.patchProject(id, { description }, 'Failed to save the description.')
    },

    // The server cascades to sub-projects, so local state has to drop the
    // whole subtree or the sidebar would keep rendering rows that are gone.
    async deleteProject(id) {
      const doomed = new Set([id, ...this.descendantIds(id)])
      const previous = this.projects
      this.projects = this.projects.filter((project) => !doomed.has(project.id))
      try {
        await this.request('DELETE', { id })
        return true
      } catch (error) {
        console.error('Failed to delete project:', error)
        this.projects = previous
        this.notify(error.userMessage || 'Failed to delete the project.', 'error')
        return false
      }
    },
  },
})
