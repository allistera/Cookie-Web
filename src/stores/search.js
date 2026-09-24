import { startTiming } from '../lib/performance'
import { defineStore } from 'pinia'

import { authHeaders as buildAuthHeaders } from '../lib/authHeaders'
import { SEARCH_API_URL } from '../lib/apiWorkers'
import { useInboxStore } from './inbox'

export const DEFAULT_SEARCH_LIMIT = 20

// Out-of-order guard for search(), mirroring documents.js's searchSeq /
// inbox.js's listSeq: an AbortController isn't reactive state, so it lives at
// module scope rather than on the store.
let searchAbortController = null

// Backs the combined /search results page (views/SearchResultsView.vue).
// Unlike inbox.js's searchEmails (overwrites traditionalEmails in place) or
// documents.js's searchDocuments (its own searchResults array scoped to the
// Documents dashboard), this store's state IS the page: the view derives
// everything it renders from here, driven entirely by the /search route's
// query params (q, scope, mode, page) rather than any app-specific list.
export const useSearchStore = defineStore('search', {
  state: () => ({
    query: '',
    scope: 'all',
    results: [],
    estimatedTotalHits: 0,
    nextOffset: null,
    scanLimitReached: false,
    verifiedPagination: false,
    limit: DEFAULT_SEARCH_LIMIT,
    offset: 0,
    loading: false,
    // null | 'unavailable' (503) | 'invalid' (400) | 'failed' (anything else)
    error: null,
    // Guards every async search() response the same way inbox.js's listSeq
    // guards loadEmails: only the response whose seq still matches this one
    // when it resolves is allowed to touch state.
    seq: 0,
  }),

  getters: {
    hasMore(state) {
      if (state.verifiedPagination) return state.nextOffset !== null
      return state.offset + state.results.length < state.estimatedTotalHits
    },
  },

  actions: {
    // Bearer-token headers for the search Worker, delegating like the other
    // stores so a dead session is recognised in one place.
    authHeaders(extra = {}) {
      return buildAuthHeaders(extra)
    },

    notify(message, kind = 'info') {
      useInboxStore().notify(message, kind)
    },

    // Fetches one page of combined mail + document results. Always trusts its
    // arguments over any pre-existing state — the view calls this whenever
    // the route's q/scope/mode/page change, so the route stays the single
    // source of truth (shareable, back-button friendly).
    async search(
      query,
      {
        scope = 'all',
        mode,
        limit = DEFAULT_SEARCH_LIMIT,
        offset = 0,
        verifiedPagination = false,
      } = {},
    ) {
      const q = query.trim()
      if (!q) {
        this.clear()
        return
      }

      searchAbortController?.abort()
      const controller = new AbortController()
      searchAbortController = controller
      const seq = ++this.seq
      this.loading = true
      this.error = null
      this.nextOffset = null
      this.scanLimitReached = false
      this.verifiedPagination = verifiedPagination
      const completeTiming = startTiming('search')
      try {
        const headers = await this.authHeaders()
        const params = new URLSearchParams({
          q,
          scope,
          limit: String(limit),
          offset: String(offset),
        })
        if (mode) params.set('mode', mode)
        if (verifiedPagination) params.set('pagination', 'verified')
        const response = await fetch(`${SEARCH_API_URL}/search?${params}`, {
          headers,
          signal: controller.signal,
        })
        if (!response.ok) {
          if (seq !== this.seq) return
          this.error =
            response.status === 503 ? 'unavailable' : response.status === 400 ? 'invalid' : 'failed'
          this.results = []
          this.estimatedTotalHits = 0
          return
        }
        const data = await response.json()
        if (seq !== this.seq) return
        if (
          verifiedPagination &&
          !(
            (data.nextOffset === null ||
              (Number.isSafeInteger(data.nextOffset) &&
                data.nextOffset > offset &&
                data.nextOffset < 1000)) &&
            (data.scanLimitReached === true || data.scanLimitReached === false) &&
            !(data.nextOffset !== null && data.scanLimitReached)
          )
        ) {
          this.error = 'failed'
          this.results = []
          this.estimatedTotalHits = 0
          return
        }
        this.query = data.query ?? q
        this.scope = scope
        this.results = data.results ?? []
        this.estimatedTotalHits = data.estimatedTotalHits ?? 0
        this.nextOffset = verifiedPagination ? (data.nextOffset ?? null) : null
        this.scanLimitReached = verifiedPagination && data.scanLimitReached === true
        this.limit = data.limit ?? limit
        this.offset = data.offset ?? offset
      } catch (error) {
        if (seq !== this.seq) return
        if (error?.name === 'AbortError') return
        console.error('Combined search failed:', error)
        this.error = 'failed'
        this.results = []
        this.estimatedTotalHits = 0
      } finally {
        completeTiming()
        if (searchAbortController === controller) searchAbortController = null
        if (seq === this.seq) this.loading = false
      }
    },

    // Invalidates any in-flight request and resets to empty state — called
    // for a blank query and when the /search view unmounts.
    clear() {
      searchAbortController?.abort()
      searchAbortController = null
      this.seq++
      this.query = ''
      this.results = []
      this.estimatedTotalHits = 0
      this.nextOffset = null
      this.scanLimitReached = false
      this.verifiedPagination = false
      this.error = null
      this.loading = false
    },
  },
})
