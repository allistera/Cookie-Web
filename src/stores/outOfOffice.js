import { defineStore } from 'pinia'
import { EMAILS_API_URL } from '../lib/apiWorkers'
import { authHeaders } from '../lib/authHeaders'
import { outOfOfficeDefaults } from '../lib/outOfOffice'

const conflictMessage =
  'Settings changed in another browser. Your edits are still here. Load the latest settings before saving.'

export const useOutOfOfficeStore = defineStore('outOfOffice', {
  state: () => ({
    ownerSub: null,
    generation: 0,
    document: outOfOfficeDefaults(),
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
      this.document = outOfOfficeDefaults()
      this.loaded = this.loading = this.saving = false
      this.error = ''
      this.conflict = false
    },
    async load({ force = false } = {}) {
      if (!this.ownerSub || this.loading || this.saving) return false
      if (this.loaded && !force) return true
      const generation = this.generation
      this.loading = true
      try {
        const headers = await authHeaders()
        if (generation !== this.generation) return
        const response = await fetch(`${EMAILS_API_URL}/emails/out-of-office`, {
          headers,
          cache: 'no-store',
        })
        if (!response.ok) throw new Error()
        const document = await response.json()
        if (generation !== this.generation || document.revision < this.document.revision) return
        this.document = document
        this.loaded = true
        if (!this.conflict) this.error = ''
        return true
      } catch {
        if (generation === this.generation)
          this.error =
            'Could not refresh out-of-office settings. The displayed state may be outdated; retry to continue.'
        return false
      } finally {
        if (generation === this.generation) this.loading = false
      }
    },
    async update(body) {
      if (!this.ownerSub || this.saving) return false
      const generation = this.generation
      this.saving = true
      this.error = ''
      this.conflict = false
      try {
        const headers = await authHeaders({ 'Content-Type': 'application/json' })
        if (generation !== this.generation) return false
        const response = await fetch(`${EMAILS_API_URL}/emails/out-of-office`, {
          method: 'PUT',
          headers,
          body: JSON.stringify(body),
        })
        const document = await response.json()
        if (generation !== this.generation) return false
        if (response.status === 409) {
          this.conflict = true
          this.error = conflictMessage
          return false
        }
        if (!response.ok) {
          this.error = document.error || 'Could not save. Your changes have not been applied.'
          return false
        }
        this.document = document
        this.loaded = true
        return true
      } catch {
        if (generation === this.generation)
          this.error =
            'Could not confirm the change. Reload the current settings before trying again.'
        return false
      } finally {
        if (generation === this.generation) this.saving = false
      }
    },
    save(draft) {
      if (!this.loaded || this.conflict) return false
      // A poll may refresh the banner while the owner is editing. The draft
      // must still compare against the revision that the owner actually saw.
      if (draft.revision !== this.document.revision) {
        this.conflict = true
        this.error = conflictMessage
        return false
      }
      return this.update({ ...draft })
    },
    stop() {
      return this.update({ action: 'stop' })
    },
    resolve(deliveryId, outcome) {
      return this.update({ action: 'resolve', deliveryId, outcome })
    },
  },
})
