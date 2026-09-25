import { toRaw } from 'vue'
import { defineStore } from 'pinia'
import { jsonRequest } from '../lib/jsonRequest'

import { authHeaders as buildAuthHeaders } from '../lib/authHeaders'
import { TASKS_API_URL } from '../lib/apiWorkers'
import { useInboxStore } from './inbox'

const projectLoads = new WeakMap()
const projectMutations = new WeakMap()

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
    // Delegates so a dead session is recognised in one place: it sends the
    // person to sign in rather than letting each store report a generic
    // failure against a session that will never work again.
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
      return jsonRequest(`${TASKS_API_URL}/projects`, { method, headers, body })
    },

    async loadProjects({ force = false } = {}) {
      if (this.isLoaded && !force) return
      const inFlight = projectLoads.get(toRaw(this))
      if (inFlight) return inFlight
      this.isLoading = true
      const load = (async () => {
        try {
          const { projects } = await this.request('GET')
          this.projects = projects
          this.isLoaded = true
        } catch (error) {
          console.error('Failed to load projects:', error)
          this.notify('Failed to load projects.', 'error')
        } finally {
          this.isLoading = false
          projectLoads.delete(toRaw(this))
        }
      })()
      projectLoads.set(toRaw(this), load)
      return load
    },

    // Created rows come back from the server rather than being guessed at
    // locally, so the id in state is the one that was stored.
    async createProject({ name, parentId = null }) {
      await projectLoads.get(toRaw(this))
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
      await projectLoads.get(toRaw(this))
      let project = this.projects.find((row) => row.id === id)
      if (!project) {
        // The sidebar only ever calls this with an id from a row it is
        // currently rendering, so this should be unreachable in practice.
        // Notify anyway so the contract ("every failed mutation notifies")
        // holds even if a stale id ever slips through.
        this.notify(failureMessage, 'error')
        return null
      }
      const perform = async () => {
        project = this.projects.find((row) => row.id === id) ?? project
        const previous = { ...project }
        Object.assign(project, changes)
        try {
          const { project: updated } = await this.request('PATCH', { id, ...changes })
          project = this.projects.find((row) => row.id === id) ?? project
          Object.assign(project, updated)
          return project
        } catch (error) {
          console.error('Failed to update project:', error)
          Object.assign(project, previous)
          this.notify(error.userMessage || failureMessage, 'error')
          return null
        }
      }
      const queue = projectMutations.get(this) ?? new Map()
      projectMutations.set(this, queue)
      const prior = queue.get(id)
      const pending = prior ? prior.then(perform) : perform()
      queue.set(id, pending)
      return pending.finally(() => {
        if (queue.get(id) === pending) queue.delete(id)
      })
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
      await projectLoads.get(toRaw(this))
      const doomed = new Set([id, ...this.descendantIds(id)])
      const removed = []
      this.projects.forEach((project, index) => {
        if (doomed.has(project.id)) removed.push({ project, index })
      })
      this.projects = this.projects.filter((project) => !doomed.has(project.id))
      try {
        await this.request('DELETE', { id })
        return true
      } catch (error) {
        console.error('Failed to delete project:', error)
        // Put back only the removed rows, at their old positions, so a create
        // or rename that landed meanwhile survives the rollback.
        const projects = [...this.projects]
        for (const { project, index } of removed) {
          if (projects.some((row) => row.id === project.id)) continue
          projects.splice(Math.min(index, projects.length), 0, project)
        }
        this.projects = projects
        this.notify(error.userMessage || 'Failed to delete the project.', 'error')
        return false
      }
    },
  },
})
