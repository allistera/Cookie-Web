import { defineStore } from 'pinia'

import { SEARCH_API_URL } from '../lib/apiWorkers'
import { authHeaders } from '../lib/authHeaders'

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

    async save(nextViews) {
      if (!this.ownerSub || !this.loaded || this.saving) {
        this.error = 'Saved views are not ready. Load them and try again.'
        return false
      }
      const owner = this.ownerSub
      const generation = this.generation
      this.saving = true
      this.error = ''
      this.conflict = false
      try {
        const headers = await authHeaders({ 'Content-Type': 'application/json' })
        if (owner !== this.ownerSub || generation !== this.generation) return false
        const response = await fetch(`${SEARCH_API_URL}/saved-views`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ revision: this.revision, views: nextViews }),
        })
        const document = await response.json()
        if (owner !== this.ownerSub || generation !== this.generation) return false
        if (response.status === 409) {
          this.applyDocument(document.current)
          this.conflict = true
          this.error =
            'Saved views changed in another browser. Your edits are still here. Review the latest views before saving again.'
          return false
        }
        if (!response.ok) {
          this.error = document.error || 'Could not save views. Your edits are still here.'
          return false
        }
        this.applyDocument(document)
        return true
      } catch (error) {
        if (owner !== this.ownerSub || generation !== this.generation) return false
        this.error = 'Could not save views. Your edits are still here; please try again.'
        console.error('Failed to save views:', error)
        return false
      } finally {
        if (owner === this.ownerSub && generation === this.generation) this.saving = false
      }
    },
  },
})
