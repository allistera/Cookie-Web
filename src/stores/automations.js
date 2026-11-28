import { defineStore } from 'pinia'

import { AUTOMATIONS_API_URL } from '../lib/apiWorkers'
import { authHeaders as buildAuthHeaders } from '../lib/authHeaders'
import { jsonRequest } from '../lib/jsonRequest'
import { useInboxStore } from './inbox'

// The person's automations and what they did, served by the
// cookie-web-automations Worker. Shaped after stores/todoist.js: the same
// auth headers and request helper. The lists are small, so every change is
// sent first and applied from the Worker's answer rather than optimistically.
export const useAutomationsStore = defineStore('automations', {
  state: () => ({
    automations: [],
    runs: [],
    isLoaded: false,
    loadFailed: false,
    // Ids with a request under way, so their controls can be held.
    busy: [],
    loadingSeq: 0,
  }),

  actions: {
    authHeaders(extra = {}) {
      return buildAuthHeaders(extra)
    },

    notify(message, kind = 'info') {
      useInboxStore().notify(message, kind)
    },

    async request(method, path, body) {
      const headers = await this.authHeaders(
        body !== undefined ? { 'Content-Type': 'application/json' } : {},
      )
      return jsonRequest(`${AUTOMATIONS_API_URL}${path}`, { method, headers, body })
    },

    // Both lists, read together: the Dashboard shows them side by side.
    // Resolves false when the read failed, leaving what was shown in place.
    async load() {
      const seq = ++this.loadingSeq
      try {
        const [{ automations }, { runs }] = await Promise.all([
          this.request('GET', '/automations'),
          this.request('GET', '/automation-runs'),
        ])
        // A slower, older read must not replace what a newer one brought.
        if (seq !== this.loadingSeq) return true
        this.automations = automations ?? []
        this.runs = runs ?? []
        this.isLoaded = true
        this.loadFailed = false
        return true
      } catch (error) {
        console.error('Failed to load automations:', error)
        if (seq === this.loadingSeq) this.loadFailed = true
        return false
      }
    },

    async loadRuns() {
      try {
        const { runs } = await this.request('GET', '/automation-runs')
        this.runs = runs ?? []
      } catch (error) {
        console.error('Failed to load automation runs:', error)
      }
    },

    // Resolves the new automation, or null when it could not be created.
    async create({ handler, trigger }) {
      try {
        const { automation } = await this.request('POST', '/automations', { handler, trigger })
        this.automations = [...this.automations, automation]
        this.notify(`“${automation.name}” is switched on`, 'success')
        return automation
      } catch (error) {
        console.error('Failed to create the automation:', error)
        this.notify(error.userMessage || 'Could not create the automation', 'error')
        return null
      }
    },

    async change(id, work, failure) {
      if (this.busy.includes(id)) return false
      this.busy = [...this.busy, id]
      try {
        await work()
        return true
      } catch (error) {
        console.error(`${failure}:`, error)
        this.notify(error.userMessage || failure, 'error')
        return false
      } finally {
        this.busy = this.busy.filter((busyId) => busyId !== id)
      }
    },

    setEnabled(id, enabled) {
      return this.change(
        id,
        async () => {
          const { automation } = await this.request('PATCH', '/automations', { id, enabled })
          this.automations = this.automations.map((row) => (row.id === id ? automation : row))
        },
        'Could not change the automation',
      )
    },

    remove(id) {
      return this.change(
        id,
        async () => {
          await this.request('DELETE', '/automations', { id })
          this.automations = this.automations.filter((row) => row.id !== id)
          // Its runs go with it on the server.
          this.runs = this.runs.filter((run) => run.automationId !== id)
        },
        'Could not delete the automation',
      )
    },

    // Runs it now and waits for the outcome, which goes to the top of the
    // activity list and into a toast.
    runNow(id) {
      return this.change(
        id,
        async () => {
          const { run } = await this.request('POST', '/automations/run', { id })
          this.runs = [run, ...this.runs]
          this.notify(run.summary, run.status === 'failed' ? 'error' : 'success')
        },
        'Could not run the automation',
      )
    },
  },
})
