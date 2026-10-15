import { defineStore } from 'pinia'
import { jsonRequest } from '../lib/jsonRequest'

import { authHeaders as buildAuthHeaders } from '../lib/authHeaders'
import { TASKS_API_URL } from '../lib/apiWorkers'
import { useInboxStore } from './inbox'
import { useProjectsStore } from './projects'
import { useTaskItemsStore } from './taskItems'
import { useTaskLabelsStore } from './taskLabels'

const ENDPOINT = `${TASKS_API_URL}/tasks/todoist`

export const emptyTodoistSettings = () => ({
  configured: false,
  connected: false,
  enabled: false,
  email: null,
  tokenHint: '',
  timeZone: null,
  lastSyncedAt: null,
  lastSyncStatus: null,
  lastSyncError: null,
  lastSyncSummary: null,
})

// The Todoist connection behind Settings > Tasks > Todoist, served by
// cookie-web-tasks's /tasks/todoist routes. Shaped after stores/projects.js:
// the same auth headers and request helper. A sync changes projects, tasks
// and labels server-side, so a successful run reloads the three stores that
// hold them; the Tasks view then shows what Todoist has.
export const useTodoistStore = defineStore('todoist', {
  state: () => ({
    settings: emptyTodoistSettings(),
    isLoaded: false,
    isLoading: false,
    isSaving: false,
    isSyncing: false,
  }),

  actions: {
    authHeaders(extra = {}) {
      return buildAuthHeaders(extra)
    },

    notify(message, kind = 'info') {
      useInboxStore().notify(message, kind)
    },

    async request(method, body, path = '') {
      const headers = await this.authHeaders(
        body !== undefined ? { 'Content-Type': 'application/json' } : {},
      )
      return jsonRequest(`${ENDPOINT}${path}`, { method, headers, body })
    },

    // Resolves true once the settings are loaded, false when the load failed.
    async loadSettings({ force = false } = {}) {
      if (this.isLoaded && !force) return true
      this.isLoading = true
      try {
        const { todoist } = await this.request('GET')
        this.settings = { ...emptyTodoistSettings(), ...todoist }
        this.isLoaded = true
        return true
      } catch (error) {
        console.error('Failed to load Todoist settings:', error)
        return false
      } finally {
        this.isLoading = false
      }
    },

    // Saves a new token (checked against Todoist by the Worker) and, when
    // given, the schedule flag. Resolves the settings, or null with the
    // reason notified.
    async connect(token, { enabled } = {}) {
      return this.save(enabled === undefined ? { token } : { token, enabled }, 'Todoist connected.')
    },

    async setEnabled(enabled) {
      return this.save(
        { enabled },
        enabled ? 'Hourly Todoist sync switched on.' : 'Hourly Todoist sync switched off.',
      )
    },

    async save(body, successMessage) {
      this.isSaving = true
      try {
        const { todoist } = await this.request('PUT', body)
        this.settings = { ...emptyTodoistSettings(), ...todoist }
        this.isLoaded = true
        if (successMessage) this.notify(successMessage)
        return this.settings
      } catch (error) {
        console.error('Failed to save Todoist settings:', error)
        this.notify(error.userMessage || 'Failed to save Todoist settings.', 'error')
        return null
      } finally {
        this.isSaving = false
      }
    },

    // Forgets the token. Mirrored projects and tasks stay in Cookie.
    async disconnect() {
      this.isSaving = true
      try {
        await this.request('DELETE')
        this.settings = { ...emptyTodoistSettings(), configured: this.settings.configured }
        this.notify('Todoist disconnected.')
        return true
      } catch (error) {
        console.error('Failed to disconnect Todoist:', error)
        this.notify(error.userMessage || 'Failed to disconnect Todoist.', 'error')
        return false
      } finally {
        this.isSaving = false
      }
    },

    // Runs a sync now. Resolves the settings (whose summary describes the
    // run), or null with the reason notified. The Worker records a failed
    // run on the connection too, so the settings are re-read either way.
    async syncNow() {
      this.isSyncing = true
      try {
        const { todoist } = await this.request('POST', undefined, '/sync')
        this.settings = { ...emptyTodoistSettings(), ...todoist }
        this.isLoaded = true
        this.notify('Todoist synced.')
        await this.refreshTaskStores()
        return this.settings
      } catch (error) {
        console.error('Todoist sync failed:', error)
        this.notify(error.userMessage || 'Todoist sync failed.', 'error')
        await this.loadSettings({ force: true })
        return null
      } finally {
        this.isSyncing = false
      }
    },

    // Everything a sync may have changed, re-read so an open Tasks view (or
    // the next visit to it) shows the mirrors.
    async refreshTaskStores() {
      const projects = useProjectsStore()
      const labels = useTaskLabelsStore()
      const items = useTaskItemsStore()
      const reloads = [projects.loadProjects({ force: true }), labels.loadLabels({ force: true })]
      if (items.loadedProject) reloads.push(items.loadItems(items.loadedProject, { force: true }))
      await Promise.all(reloads)
    },
  },
})
