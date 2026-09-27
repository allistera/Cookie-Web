import { defineStore } from 'pinia'

import { SEARCH_API_URL } from '../lib/apiWorkers'
import { authHeaders } from '../lib/authHeaders'

const FIELDS = ['name', 'query', 'folder']

function pickFields(view) {
  return {
    name: String(view.name ?? '').trim(),
    query: String(view.query ?? '').trim(),
    folder: view.folder ?? 'all',
  }
}

function sameFields(a, b) {
  return FIELDS.every((field) => a[field] === b[field])
}

export const useSavedViewsStore = defineStore('savedViews', {
  state: () => ({
    ownerSub: null,
    generation: 0,
    revision: 0,
    views: [],
    loaded: false,
    loading: false,
    saving: false,
    error: '',
    conflict: false,
    // The create/edit form (SavedViewEditor, mounted once in App.vue):
    // { mode: 'create' | 'edit', id, base, name, query, folder } or null.
    editor: null,
  }),

  actions: {
    setOwner(sub) {
      const owner = sub || null
      if (owner === this.ownerSub) return
      this.generation++
      this.ownerSub = owner
      this.revision = 0
      this.views = []
      this.loaded = false
      this.loading = false
      this.saving = false
      this.error = ''
      this.conflict = false
      this.editor = null
    },

    // Opens the create form (optionally prefilled from a search) or the edit
    // form for an existing view. `base` remembers the view as it was when
    // editing started, to spot edits made in another session meanwhile.
    openEditor({ view = null, draft = {} } = {}) {
      this.error = ''
      this.conflict = false
      this.editor = view
        ? { mode: 'edit', id: view.id, base: { ...view }, ...pickFields(view) }
        : { mode: 'create', id: null, base: null, ...pickFields({ folder: 'all', ...draft }) }
      if (!this.loaded) this.load()
    },

    closeEditor() {
      this.editor = null
      this.error = ''
      this.conflict = false
    },

    applyDocument(document) {
      this.revision = document.revision
      this.views = document.views
      this.loaded = true
    },

    async load({ force = false } = {}) {
      if (!this.ownerSub || this.loading || (this.loaded && !force)) return
      const owner = this.ownerSub
      const generation = this.generation
      this.loading = true
      this.error = ''
      try {
        const headers = await authHeaders()
        if (owner !== this.ownerSub || generation !== this.generation) return
        const response = await fetch(`${SEARCH_API_URL}/saved-views`, {
          headers,
          cache: 'no-store',
        })
        if (!response.ok) throw new Error(`GET saved views responded ${response.status}`)
        const document = await response.json()
        if (owner !== this.ownerSub || generation !== this.generation) return
        if (this.loaded && (!force || document.revision < this.revision)) return
        this.applyDocument(document)
      } catch (error) {
        if (owner !== this.ownerSub || generation !== this.generation) return
        this.error = 'Could not load saved views. Try again.'
        console.error('Failed to load saved views:', error)
      } finally {
        if (owner === this.ownerSub && generation === this.generation) this.loading = false
      }
    },

    // PUTs a whole list at the current revision. Resolves to 'ok',
    // 'conflict' (another session saved first; the latest list is applied)
    // or 'error' (this.error says why); a switched account resolves 'stale'.
    async putViews(nextViews) {
      const owner = this.ownerSub
      const generation = this.generation
      const current = () => owner === this.ownerSub && generation === this.generation
      this.saving = true
      this.error = ''
      try {
        const headers = await authHeaders({ 'Content-Type': 'application/json' })
        if (!current()) return 'stale'
        const response = await fetch(`${SEARCH_API_URL}/saved-views`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ revision: this.revision, views: nextViews }),
        })
        const document = await response.json()
        if (!current()) return 'stale'
        if (response.status === 409) {
          this.applyDocument(document.current)
          return 'conflict'
        }
        if (!response.ok) {
          this.error = document.error || 'Could not save views. Your edits are still here.'
          return 'error'
        }
        this.applyDocument(document)
        return 'ok'
      } catch (error) {
        if (!current()) return 'stale'
        this.error = 'Could not save views. Your edits are still here; please try again.'
        console.error('Failed to save views:', error)
        return 'error'
      } finally {
        if (current()) this.saving = false
      }
    },

    // Saves a whole edited list (Manage: rename and reorder). A conflict
    // keeps the draft and asks the user to review, since every view may
    // have been touched.
    async save(nextViews) {
      if (!this.ownerSub || !this.loaded || this.saving) {
        this.error = 'Saved views are not ready. Load them and try again.'
        return false
      }
      this.conflict = false
      const result = await this.putViews(nextViews)
      if (result === 'conflict') {
        this.conflict = true
        this.error =
          'Saved views changed in another browser. Your edits are still here. Review the latest views before saving again.'
      }
      return result === 'ok'
    },

    // Applies one change to the latest list and saves it. If another session
    // saved first, the same change is re-applied to its list and retried
    // once; `change` returns null (having set this.error) when that no
    // longer makes sense, e.g. the view it edits was deleted elsewhere.
    async applyChange(change) {
      if (!this.ownerSub || !this.loaded || this.saving) {
        this.error = 'Saved views are not ready. Load them and try again.'
        return false
      }
      this.conflict = false
      for (let attempt = 0; attempt < 2; attempt++) {
        this.error = ''
        const next = change(this.views)
        if (!next) return false
        const result = await this.putViews(next)
        if (result !== 'conflict') return result === 'ok'
      }
      this.error = 'Saved views keep changing in another session. Please try again.'
      return false
    },

    async createView(fields) {
      const view = { id: crypto.randomUUID(), ...pickFields(fields) }
      const saved = await this.applyChange((views) => [...views, view])
      return saved ? view : null
    },

    // `base` is the view as it was when editing started: if another session
    // has changed it since, the edit stops so it is not silently overwritten.
    async updateView(id, fields, base = null) {
      let updated = null
      const saved = await this.applyChange((views) => {
        const current = views.find((view) => view.id === id)
        if (!current) {
          this.error = 'This view was deleted in another session.'
          return null
        }
        if (base && !sameFields(current, base)) {
          this.error =
            'This view was changed in another session. Your edits are still here; review the latest version before saving again.'
          this.conflict = true
          if (this.editor?.id === id) this.editor.base = { ...current }
          return null
        }
        updated = { ...current, ...pickFields(fields) }
        return views.map((view) => (view.id === id ? updated : view))
      })
      return saved ? updated : null
    },

    // Resolves to the removed view and its position, for Undo.
    async deleteView(id) {
      let removed = null
      const saved = await this.applyChange((views) => {
        const index = views.findIndex((view) => view.id === id)
        removed = index === -1 ? null : { view: views[index], index }
        return views.filter((view) => view.id !== id)
      })
      return saved ? removed : null
    },

    // Undo for deleteView: puts the view back where it was, unless it
    // already exists again.
    async restoreView(view, index) {
      return this.applyChange((views) => {
        if (views.some((existing) => existing.id === view.id)) return views
        const next = [...views]
        next.splice(Math.min(index, next.length), 0, view)
        return next
      })
    },
  },
})
