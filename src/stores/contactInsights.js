import { defineStore } from 'pinia'

import { EMAILS_API_URL, MESSAGES_API_URL } from '../lib/apiWorkers'
import { jsonRequest } from '../lib/jsonRequest'
import { useInboxStore } from './inbox'

function cleanAddress(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
}

// The screening decision that applies to this sender: its own row, else the
// most specific domain row covering it ('@example.com'). `decision` is null
// when none applies; `failed` marks a lookup that could not be completed, so
// the drawer never presents an unknown decision as "not blocked".
async function fetchScreening(address, headers) {
  try {
    const data = await jsonRequest(
      `${EMAILS_API_URL}/emails/senders?address=${encodeURIComponent(address)}`,
      { headers },
    )
    const applied = data.decisions?.[0] ?? null
    return { key: applied?.address ?? null, decision: applied?.decision ?? null, failed: false }
  } catch (error) {
    console.error('Failed to load the sender decision:', error)
    return { key: null, decision: null, failed: true }
  }
}

export const useContactInsightsStore = defineStore('contactInsights', {
  state: () => ({
    isOpen: false,
    contact: null,
    screening: null,
    history: [],
    nextCursor: null,
    isLoading: false,
    isLoadingMore: false,
    saveState: 'idle',
    loadError: '',
    requestId: 0,
  }),

  actions: {
    async openContact({ address, name = null }) {
      const normalized = cleanAddress(address)
      if (!normalized) return
      useInboxStore().isChatDrawerActive = false
      this.isOpen = true
      this.contact = {
        address: normalized,
        name: name || null,
        company: null,
        role: null,
        linkedinUrl: null,
        notes: '',
      }
      this.screening = null
      this.history = []
      this.nextCursor = null
      this.loadError = ''
      this.saveState = 'idle'
      await this.loadContact()
    },

    close() {
      this.isOpen = false
    },

    async loadContact({ more = false } = {}) {
      const address = this.contact?.address
      if (!address || (more && !this.nextCursor)) return
      const requestId = ++this.requestId
      if (more) this.isLoadingMore = true
      else this.isLoading = true
      try {
        const headers = await useInboxStore().authHeaders()
        const params = new URLSearchParams({ address, limit: '10' })
        if (more) params.set('before', this.nextCursor)
        const [data, screening] = await Promise.all([
          jsonRequest(`${MESSAGES_API_URL}/messages/contact-insights?${params}`, { headers }),
          more ? this.screening : fetchScreening(address, headers),
        ])
        if (requestId !== this.requestId || this.contact?.address !== address) return
        this.screening = screening
        this.contact = {
          ...this.contact,
          ...data.contact,
          name: data.contact.name || this.contact.name,
        }
        this.history = more ? [...this.history, ...data.history] : data.history
        this.nextCursor = data.nextCursor
        this.loadError = ''
      } catch (error) {
        if (requestId !== this.requestId) return
        console.error('Failed to load contact insights:', error)
        this.loadError = 'Could not load contact insights.'
      } finally {
        if (requestId === this.requestId) {
          this.isLoading = false
          this.isLoadingMore = false
        }
      }
    },

    async saveContact(address, fields) {
      this.saveState = 'saving'
      try {
        const headers = await useInboxStore().authHeaders({ 'Content-Type': 'application/json' })
        const data = await jsonRequest(`${MESSAGES_API_URL}/messages/contact-insights`, {
          method: 'PATCH',
          headers,
          body: { address, ...fields },
        })
        if (this.contact?.address === address) {
          this.contact = {
            ...this.contact,
            ...data.contact,
            name: data.contact.name || this.contact.name,
          }
          this.saveState = 'saved'
        }
        return true
      } catch (error) {
        console.error('Failed to save contact insights:', error)
        if (this.contact?.address === address) this.saveState = 'error'
        useInboxStore().notify(
          error.userMessage || 'Could not save contact insights. Please try again.',
          'error',
        )
        return false
      }
    },

    openHistoryEmail(message) {
      useInboxStore().openEmailFromSearch(message)
    },
  },
})
