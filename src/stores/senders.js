import { defineStore } from 'pinia'
import { EMAILS_API_URL } from '../lib/apiWorkers'
import { authHeaders } from '../lib/authHeaders'

export const normalizeSender = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()

export const useSendersStore = defineStore('senders', {
  state: () => ({
    ownerSub: null,
    generation: 0,
    enabled: false,
    decisions: [],
    known: {},
    nextCursor: null,
    // Normalized text the list is narrowed to; '' lists every decision.
    query: '',
    loadRequest: 0,
    loaded: false,
    loading: false,
    saving: false,
    error: '',
    // Other sender addresses whose held mail the last decision also moved
    // (a domain decision covers every address on that domain).
    lastRelated: [],
  }),
  actions: {
    setOwner(sub) {
      const owner = sub || null
      if (this.ownerSub === owner) return
      const generation = this.generation + 1
      this.$reset()
      this.ownerSub = owner
      this.generation = generation
    },
    // A fresh load (reload or a new search) supersedes one still in flight;
    // only a `more` page waits for the previous request.
    async load({ more = false, query = this.query } = {}) {
      if (!this.ownerSub || this.saving || (more && (!this.nextCursor || this.loading)))
        return false
      const generation = this.generation
      const request = ++this.loadRequest
      const current = () => generation === this.generation && request === this.loadRequest
      const text = normalizeSender(query)
      this.query = text
      this.loading = true
      try {
        const headers = await authHeaders()
        if (!current()) return false
        const params = new URLSearchParams()
        if (more) params.set('after', this.nextCursor)
        if (text) params.set('q', text)
        const search = params.toString()
        const response = await fetch(`${EMAILS_API_URL}/emails/senders${search && `?${search}`}`, {
          headers,
          cache: 'no-store',
        })
        if (!response.ok) throw new Error()
        const data = await response.json()
        if (!current()) return false
        this.enabled = data.enabled
        this.decisions = more
          ? [
              ...new Map(
                [...this.decisions, ...data.decisions].map((entry) => [entry.address, entry]),
              ).values(),
            ]
          : data.decisions
        this.nextCursor = data.nextCursor
        for (const entry of data.decisions) this.known[entry.address] = entry.decision
        this.loaded = true
        this.error = ''
        return true
      } catch {
        if (current())
          this.error = 'Could not load sender settings. Retry to see the current state.'
        return false
      } finally {
        if (current()) this.loading = false
      }
    },
    async lookup(address) {
      if (!this.ownerSub) return false
      const generation = this.generation
      const normalized = normalizeSender(address)
      try {
        const headers = await authHeaders()
        if (generation !== this.generation) return false
        const response = await fetch(
          `${EMAILS_API_URL}/emails/senders?address=${encodeURIComponent(normalized)}`,
          { headers, cache: 'no-store' },
        )
        if (!response.ok) throw new Error()
        const data = await response.json()
        if (generation !== this.generation) return false
        this.known[normalized] = data.decisions[0]?.decision ?? null
        this.enabled = data.enabled
        return true
      } catch {
        return false
      }
    },
    async update(body) {
      if (!this.ownerSub || this.saving) return false
      const generation = this.generation
      const owner = this.ownerSub
      this.saving = true
      this.error = ''
      try {
        const headers = await authHeaders({ 'Content-Type': 'application/json' })
        if (generation !== this.generation) return false
        const response = await fetch(`${EMAILS_API_URL}/emails/senders`, {
          method: 'PUT',
          headers,
          body: JSON.stringify(body),
        })
        const data = await response.json()
        if (generation !== this.generation) return false
        if (!response.ok) {
          this.error = data.error || 'Could not change this sender.'
          return false
        }
        if (body.action === 'settings') this.enabled = data.enabled === true
        this.lastRelated = Array.isArray(data.related) ? data.related : []
        if (data.address) {
          // data.address is the decision's key: '@domain' for most senders,
          // the exact address for public email providers. A domain change can
          // alter what applies to many senders, so cached lookups are dropped
          // except the sender this request named.
          const sender = normalizeSender(body.address)
          // An API from before domain decisions has no `effective`; its key is
          // the exact sender, so `decision` is what applies.
          const effective = 'effective' in data ? data.effective : data.decision
          this.known =
            sender.includes('@') && !sender.startsWith('@') ? { [sender]: effective ?? null } : {}
          // The server also replaced the sender's own older exact decision
          // (Accept/Block) or removed it when it matched (Unblock/Remove).
          const removed = { unblock: 'blocked', forget: 'accepted' }[body.action]
          this.decisions = this.decisions.filter(
            (entry) =>
              entry.address !== data.address &&
              !(
                entry.address === sender &&
                (['accept', 'block'].includes(body.action) || entry.decision === removed)
              ),
          )
          if (data.decision) this.decisions.push({ address: data.address, decision: data.decision })
        }
        this.decisions.sort((a, b) => a.address.localeCompare(b.address))
        // Invalidate pre-save reads without changing the account identity.
        this.generation++
        this.loading = false
        return true
      } catch {
        if (generation === this.generation)
          this.error = 'Could not confirm the change. Reload before trying again.'
        return false
      } finally {
        if (
          owner === this.ownerSub &&
          (generation === this.generation || generation + 1 === this.generation)
        )
          this.saving = false
      }
    },
  },
})
