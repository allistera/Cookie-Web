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
        this.notify('Failed to create the project.', 'error')
        return null
      }
    },

    async patchProject(id, changes, failureMessage) {
      const project = this.projects.find((row) => row.id === id)
      if (!project) return null
      const previous = { ...project }
      Object.assign(project, changes)
      try {
        const { project: updated } = await this.request('PATCH', { id, ...changes })
        Object.assign(project, updated)
        return project
      } catch (error) {
        console.error('Failed to update project:', error)
        Object.assign(project, previous)
        this.notify(failureMessage, 'error')
        return null
      }
    },

    renameProject(id, name) {
      return this.patchProject(id, { name }, 'Failed to rename the project.')
    },

    moveProject(id, parentId) {
      return this.patchProject(id, { parentId }, 'Failed to move the project.')
    },

    // The server cascades to sub-projects, so local state has to drop the
    // whole subtree or the sidebar would keep rendering rows that are gone.
    async deleteProject(id) {
      const doomed = new Set([id])
      let grew = true
      while (grew) {
        grew = false
        for (const project of this.projects) {
          if (!doomed.has(project.id) && doomed.has(project.parentId)) {
            doomed.add(project.id)
            grew = true
          }
        }
      }
      const previous = this.projects
      this.projects = this.projects.filter((project) => !doomed.has(project.id))
      try {
        await this.request('DELETE', { id })
        return true
      } catch (error) {
        console.error('Failed to delete project:', error)
        this.projects = previous
        this.notify('Failed to delete the project.', 'error')
        return false
      }
    },
  },
})
