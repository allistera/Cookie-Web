import { toRaw } from 'vue'
import { defineStore } from 'pinia'

import { TASKS_API_URL } from '../lib/apiWorkers'
import { authHeaders as buildAuthHeaders } from '../lib/authHeaders'
import { jsonRequest } from '../lib/jsonRequest'
import { createSharedLoad } from '../lib/sharedLoad'
import { newFilterRule } from '../lib/taskFilters'
import { useInboxStore } from './inbox'

const filterLoads = createSharedLoad()

// The fields a filter is saved with; anything else on a draft stays behind.
function pickFields(filter) {
  return {
    name: String(filter.name ?? '').trim(),
    match: filter.match === 'any' ? 'any' : 'all',
    rules: (Array.isArray(filter.rules) ? filter.rules : []).map(({ field, value, negate }) => ({
      field,
      value,
      negate: negate === true,
    })),
  }
}

function sameFields(a, b) {
  return JSON.stringify(pickFields(a)) === JSON.stringify(pickFields(b))
}

// Saved task filters for the Tasks sidebar. The Worker keeps them as one
// document per person with a revision, replaced whole on every save (the
// way saved mail views are kept), so every write here edits the latest list
// and PUTs it back; when another session saved first the latest list is
// fetched and the same edit is applied to it once more.
export const useTaskFiltersStore = defineStore('taskFilters', {
  state: () => ({
    filters: [],
    revision: 0,
    isLoaded: false,
    isLoading: false,
    saving: false,
    // Why the last save failed, shown in the editor; '' otherwise.
    error: '',
    // The create/edit dialog (TaskFilterEditor, mounted by TasksSidebar):
    // { mode: 'create' | 'edit', id, name, match, rules } or null.
    editor: null,
  }),

  getters: {
    byId: (state) => (id) => state.filters.find((filter) => filter.id === id),
  },

  actions: {
    authHeaders(extra = {}) {
      return buildAuthHeaders(extra)
    },

    notify(message, kind = 'info', action = null) {
      return useInboxStore().notify(message, kind, action)
    },

    async request(method, body) {
      const headers = await this.authHeaders(
        body !== undefined ? { 'Content-Type': 'application/json' } : {},
      )
      return jsonRequest(`${TASKS_API_URL}/task-filters`, { method, headers, body })
    },

    applyDocument(document) {
      const revision = document?.revision
      this.revision = Number.isSafeInteger(revision) && revision >= 0 ? revision : 0
      this.filters = Array.isArray(document?.filters) ? document.filters : []
      this.isLoaded = true
    },

    // Resolves true once filters are loaded, false when the load failed.
    loadFilters({ force = false } = {}) {
      if (this.isLoaded && !force) return Promise.resolve(true)
      return filterLoads(
        toRaw(this),
        async () => {
          this.isLoading = true
          try {
            this.applyDocument(await this.request('GET'))
            return true
          } catch (error) {
            console.error('Failed to load task filters:', error)
            this.notify(error.userMessage || 'Failed to load saved filters.', 'error')
            return false
          } finally {
            this.isLoading = false
          }
        },
        { force },
      )
    },

    // PUTs a whole list at the current revision. Resolves 'ok', 'conflict'
    // (another session saved first; its list is now loaded) or 'error'
    // (this.error says why).
    async putFilters(filters) {
      this.saving = true
      this.error = ''
      try {
        this.applyDocument(await this.request('PUT', { revision: this.revision, filters }))
        return 'ok'
      } catch (error) {
        if (error.status === 409) {
          await this.loadFilters({ force: true })
          return 'conflict'
        }
        console.error('Failed to save task filters:', error)
        this.error = error.userMessage || 'Failed to save the filter. Please try again.'
        return 'error'
      } finally {
        this.saving = false
      }
    },

    // Applies one change to the latest list and saves it. If another session
    // saved first, the change is applied to its list and tried once more;
    // `change` returns null (having set this.error) when it no longer makes
    // sense, e.g. the filter it edits was deleted elsewhere.
    async applyChange(change) {
      if (!(await this.loadFilters())) {
        this.error = 'Saved filters are not loaded. Please try again.'
        return false
      }
      for (let attempt = 0; attempt < 2; attempt++) {
        this.error = ''
        const next = change(this.filters)
        if (!next) return false
        const result = await this.putFilters(next)
        if (result !== 'conflict') return result === 'ok'
      }
      this.error = 'Saved filters keep changing in another session. Please try again.'
      return false
    },

    async createFilter(fields) {
      const filter = { id: crypto.randomUUID(), ...pickFields(fields) }
      const saved = await this.applyChange((filters) => [...filters, filter])
      return saved ? filter : null
    },

    // `base` is the filter as it was when editing started: if another
    // session has changed it since, the edit stops rather than writing the
    // older draft over it, and the editor's baseline moves to the latest
    // version so a second Save, after review, goes through.
    async updateFilter(id, fields, base = null) {
      let updated = null
      const saved = await this.applyChange((filters) => {
        const current = filters.find((filter) => filter.id === id)
        if (!current) {
          this.error = 'This filter was deleted in another session.'
          return null
        }
        if (base && !sameFields(current, base)) {
          this.error =
            'This filter was changed in another session. Your edits are still here; review the latest version before saving again.'
          if (this.editor?.id === id) this.editor.base = pickFields(current)
          return null
        }
        updated = { ...current, ...pickFields({ ...current, ...fields }) }
        return filters.map((filter) => (filter.id === id ? updated : filter))
      })
      return saved ? updated : null
    },

    renameFilter(id, name) {
      return this.updateFilter(id, { name })
    },

    // Resolves to the removed filter and its position, for Undo.
    async deleteFilter(id) {
      let removed = null
      const saved = await this.applyChange((filters) => {
        const index = filters.findIndex((filter) => filter.id === id)
        removed = index === -1 ? null : { filter: filters[index], index }
        return filters.filter((filter) => filter.id !== id)
      })
      return saved ? removed : null
    },

    // Undo for deleteFilter: puts the filter back where it was, unless it
    // already exists again.
    restoreFilter(filter, index) {
      return this.applyChange((filters) => {
        if (filters.some((existing) => existing.id === filter.id)) return filters
        const next = [...filters]
        next.splice(Math.min(index, next.length), 0, filter)
        return next
      })
    },

    // Opens the create form (optionally prefilled) or the edit form for an
    // existing filter. The draft is a copy: the list is only touched on save.
    // `base` remembers the filter as it was, to spot edits made elsewhere.
    openEditor({ filter = null, draft = {} } = {}) {
      this.error = ''
      this.editor = filter
        ? { mode: 'edit', id: filter.id, base: pickFields(filter), ...pickFields(filter) }
        : {
            mode: 'create',
            id: null,
            ...pickFields({ match: 'all', rules: [newFilterRule()], ...draft }),
          }
      if (!this.isLoaded) this.loadFilters()
    },

    closeEditor() {
      this.editor = null
      this.error = ''
    },
  },
})
