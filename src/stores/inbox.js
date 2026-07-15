import { defineStore } from 'pinia'

import { getAuth0 } from '../auth0-client'

// "3:54 pm" for today, "5 Jul" for anything older — Notion Mail style.
function formatEmailDate(isoString) {
  const sentAt = new Date(isoString)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (sentAt >= startOfToday) {
    return sentAt
      .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      .toLowerCase()
      .replace(/\s/g, ' ')
  }
  return sentAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

const PAGE_SIZE = 50

// Maps a GET /api/emails (or /api/search) row to the shape the views render.
function mapEmailRow(message) {
  const firstRecipient = message.recipients?.to?.[0] ?? null
  return {
    id: message.id,
    sender: message.from_name || message.from_address,
    address: message.from_address,
    // Outbound rows render "To: <recipient>" instead of the sender.
    isSent: Boolean(message.is_sent),
    to: firstRecipient ? firstRecipient.name || firstRecipient.address : null,
    subject: message.subject,
    snippet: message.snippet,
    body: message.body_text,
    sentAt: message.sent_at,
    date: formatEmailDate(message.sent_at),
    unread: message.is_unread,
    starred: message.is_starred,
    scheduledFor: message.scheduled_for ?? null,
    // Whether the message has an HTML body (cheap boolean from the list
    // endpoint). Lets the reader show a spinner during the on-demand body fetch
    // instead of flashing the plain-text fallback before the iframe swaps in.
    hasHtml: Boolean(message.has_html),
    labels: message.labels || [],
  }
}

export const useInboxStore = defineStore('inbox', {
  state: () => ({
    traditionalEmails: [],
    unreadInboxCount: 0,
    userId: null, // the authenticated user's uuid, for the Realtime inbox-ping channel
    isRefreshing: false,
    activeSearchQuery: '',
    searchSeq: 0,
    emailsCursor: null,
    hasMoreEmails: false,

    // Sent/outbox list (?filter=sent), loaded lazily when the view opens.
    // isSentLoaded gates the post-send refresh: no point refreshing a list
    // that has never been fetched.
    sentEmails: [],
    sentCursor: null,
    hasMoreSent: false,
    isSentLoaded: false,
    isSentRefreshing: false,
    spamEmails: [],
    spamCursor: null,
    hasMoreSpam: false,
    isSpamRefreshing: false,
    snoozedEmails: [],
    snoozedCursor: null,
    hasMoreSnoozed: false,
    isSnoozedLoaded: false,
    isSnoozedRefreshing: false,
    doneEmails: [],
    doneCursor: null,
    hasMoreDone: false,
    isDoneLoaded: false,
    isDoneRefreshing: false,
    labels: [], // full palette from /api/labels (settings Labels manager)

    // Chat state
    chatHistory: [],
    isChatDrawerActive: false,
    isChatLoading: false,

    // Composer state
    isComposerActive: false,
    isSendingEmail: false,
    composerTo: '',
    composerSubject: '',
    composerTextArea: '',
    isAiDraftActive: false,
    isAiDraftLoading: false,
    aiDraftPreview: '',
    composerAiInstruction: '',

    // Toast notifications
    toasts: [],
    nextToastId: 1,

    // Modals
    activeModal: null, // 'settings'

    // Reading panel: id of the email open in the traditional inbox reader
    openEmailId: null,

    // Id of the message whose body is currently being fetched (null when idle).
    // Drives the reader's loading spinner so HTML emails show a spinner during
    // the fetch instead of flashing the plain-text fallback. Set only when a
    // real fetch is about to run (not on a cache hit) and cleared when it
    // settles.
    bodyLoadingId: null,

    // Full message bodies fetched on demand (GET /api/messages), keyed by
    // message id. body_html is untrusted, sender-controlled HTML and is kept
    // out of the list payload; it is fetched only when a reader opens and
    // cached so reopening the same message doesn't refetch.
    messageBodies: new Map(),

    // AI summaries are cached per selected message after the owned body API
    // hydrates a saved result or the user generates/regenerates one.
    messageSummaries: new Map(),
    summaryLoadingId: null,

    // Id of the message with an unsubscribe request in flight (null when idle).
    unsubscribingId: null,

    // Command palette (Cmd+K)
    isCommandPaletteOpen: false,
  }),

  getters: {
    allLabels(state) {
      const byName = new Map()
      for (const email of state.traditionalEmails) {
        for (const label of email.labels || []) {
          if (!byName.has(label.name)) {
            byName.set(label.name, label)
          }
        }
      }
      return [...byName.values()]
        .filter((label) => label.kind !== 'system')
        .sort((a, b) => a.name.localeCompare(b.name))
    },
    // The email open in the reading panel; null once it leaves the list
    // (archived, or the list was replaced by a search). Sent mail opens from
    // its own list.
    openEmail(state) {
      return (
        state.traditionalEmails.find((e) => e.id === state.openEmailId) ??
        state.sentEmails.find((e) => e.id === state.openEmailId) ??
        state.spamEmails.find((e) => e.id === state.openEmailId) ??
        state.snoozedEmails.find((e) => e.id === state.openEmailId) ??
        state.doneEmails.find((e) => e.id === state.openEmailId) ??
        null
      )
    },
    // Raw (still-untrusted) body_html for the open email, once fetched; null
    // until the fetch lands or when the message has no HTML body. The reader
    // sanitizes this before rendering it in a sandboxed iframe.
    openEmailHtml(state) {
      const cached = state.openEmailId ? state.messageBodies.get(state.openEmailId) : null
      return cached?.html ?? null
    },
    // Unsubscribe capability parsed server-side from the open email's
    // List-Unsubscribe header (null for non-newsletters, or until the body
    // fetch lands). Truthy means the reader shows an Unsubscribe button.
    openEmailUnsubscribe(state) {
      const cached = state.openEmailId ? state.messageBodies.get(state.openEmailId) : null
      return cached?.unsubscribe ?? null
    },
    // True once this session successfully unsubscribed from the open email.
    openEmailUnsubscribed(state) {
      const cached = state.openEmailId ? state.messageBodies.get(state.openEmailId) : null
      return cached?.unsubscribed === true
    },
    // True while the open email's body is being fetched. The reader uses this
    // (together with the email's hasHtml flag) to show a spinner instead of the
    // text fallback until the HTML iframe is ready.
    isOpenBodyLoading(state) {
      return state.bodyLoadingId !== null && state.bodyLoadingId === state.openEmailId
    },
    // Header-derived unsubscribe metadata is unresolved until the owned body
    // request has completed and populated this cache.
    isOpenBodyResolved(state) {
      return Boolean(state.openEmailId && state.messageBodies.has(state.openEmailId))
    },
    openEmailSummary(state) {
      return state.openEmailId ? (state.messageSummaries.get(state.openEmailId) ?? null) : null
    },
    isOpenSummaryLoading(state) {
      return state.summaryLoadingId !== null && state.summaryLoadingId === state.openEmailId
    },
  },

  actions: {
    // Bearer-token headers for API calls; Auth0 is absent in e2e/fixture mode.
    async authHeaders(extra = {}) {
      const headers = { ...extra }
      const auth0 = getAuth0()
      if (auth0) {
        const token = await auth0.getAccessTokenSilently()
        headers.Authorization = `Bearer ${token}`
      }
      return headers
    },

    async loadEmails() {
      this.isRefreshing = true
      try {
        const headers = await this.authHeaders()
        const response = await fetch(`/api/emails?limit=${PAGE_SIZE}`, { headers })
        if (!response.ok) {
          throw new Error(`GET /api/emails responded ${response.status}`)
        }
        const { emails, nextCursor, unreadCount, userId } = await response.json()
        this.traditionalEmails = emails.map(mapEmailRow)
        this.emailsCursor = nextCursor ?? null
        this.hasMoreEmails = Boolean(nextCursor)
        this.unreadInboxCount =
          typeof unreadCount === 'number'
            ? unreadCount
            : this.traditionalEmails.filter((e) => e.unread).length
        if (userId) this.userId = userId
      } catch (error) {
        console.error('Failed to load inbox:', error)
        this.notify('Failed to load inbox.', 'error')
      } finally {
        this.isRefreshing = false
      }
    },

    // Appends the next keyset page. No-op while a load is already running,
    // when there is no further page, or while search results are displayed.
    async loadMoreEmails() {
      if (!this.emailsCursor || this.isRefreshing || this.activeSearchQuery) return
      this.isRefreshing = true
      try {
        const headers = await this.authHeaders()
        const url = `/api/emails?limit=${PAGE_SIZE}&before=${encodeURIComponent(this.emailsCursor)}`
        const response = await fetch(url, { headers })
        if (!response.ok) {
          throw new Error(`GET /api/emails responded ${response.status}`)
        }
        const { emails, nextCursor } = await response.json()
        this.traditionalEmails.push(...emails.map(mapEmailRow))
        this.emailsCursor = nextCursor ?? null
        this.hasMoreEmails = Boolean(nextCursor)
      } catch (error) {
        console.error('Failed to load more emails:', error)
        this.notify('Failed to load more emails.', 'error')
      } finally {
        this.isRefreshing = false
      }
    },

    refreshInbox() {
      return this.loadEmails()
    },

    // Loads the sent/outbox list (GET /api/emails?folder=sent). Called when
    // the Sent view opens and again after each successful send.
    async loadSentEmails() {
      this.isSentRefreshing = true
      try {
        const headers = await this.authHeaders()
        const response = await fetch(`/api/emails?folder=sent&limit=${PAGE_SIZE}`, { headers })
        if (!response.ok) {
          throw new Error(`GET /api/emails responded ${response.status}`)
        }
        const { emails, nextCursor } = await response.json()
        this.sentEmails = emails.map(mapEmailRow)
        this.sentCursor = nextCursor ?? null
        this.hasMoreSent = Boolean(nextCursor)
        this.isSentLoaded = true
      } catch (error) {
        console.error('Failed to load sent emails:', error)
        this.notify('Failed to load sent emails.', 'error')
      } finally {
        this.isSentRefreshing = false
      }
    },

    // Appends the next keyset page of sent mail. No-op while a load is
    // already running or when there is no further page.
    async loadMoreSentEmails() {
      if (!this.sentCursor || this.isSentRefreshing) return
      this.isSentRefreshing = true
      try {
        const headers = await this.authHeaders()
        const url = `/api/emails?folder=sent&limit=${PAGE_SIZE}&before=${encodeURIComponent(this.sentCursor)}`
        const response = await fetch(url, { headers })
        if (!response.ok) {
          throw new Error(`GET /api/emails responded ${response.status}`)
        }
        const { emails, nextCursor } = await response.json()
        this.sentEmails.push(...emails.map(mapEmailRow))
        this.sentCursor = nextCursor ?? null
        this.hasMoreSent = Boolean(nextCursor)
      } catch (error) {
        console.error('Failed to load more sent emails:', error)
        this.notify('Failed to load more sent emails.', 'error')
      } finally {
        this.isSentRefreshing = false
      }
    },

    async loadSpamEmails() {
      this.isSpamRefreshing = true
      try {
        const headers = await this.authHeaders()
        const response = await fetch(`/api/emails?folder=spam&limit=${PAGE_SIZE}`, { headers })
        if (!response.ok) throw new Error(`GET /api/emails responded ${response.status}`)
        const { emails, nextCursor } = await response.json()
        this.spamEmails = emails.map(mapEmailRow)
        this.spamCursor = nextCursor ?? null
        this.hasMoreSpam = Boolean(nextCursor)
      } catch (error) {
        console.error('Failed to load spam emails:', error)
        this.notify('Failed to load spam.', 'error')
      } finally {
        this.isSpamRefreshing = false
      }
    },

    async loadMoreSpamEmails() {
      if (!this.spamCursor || this.isSpamRefreshing) return
      this.isSpamRefreshing = true
      try {
        const headers = await this.authHeaders()
        const url = `/api/emails?folder=spam&limit=${PAGE_SIZE}&before=${encodeURIComponent(this.spamCursor)}`
        const response = await fetch(url, { headers })
        if (!response.ok) throw new Error(`GET /api/emails responded ${response.status}`)
        const { emails, nextCursor } = await response.json()
        this.spamEmails.push(...emails.map(mapEmailRow))
        this.spamCursor = nextCursor ?? null
        this.hasMoreSpam = Boolean(nextCursor)
      } catch (error) {
        console.error('Failed to load more spam:', error)
        this.notify('Failed to load more spam.', 'error')
      } finally {
        this.isSpamRefreshing = false
      }
    },

    async loadSnoozedEmails() {
      this.isSnoozedRefreshing = true
      try {
        const headers = await this.authHeaders()
        const response = await fetch(`/api/emails?folder=snoozed&limit=${PAGE_SIZE}`, { headers })
        if (!response.ok) throw new Error(`GET /api/emails responded ${response.status}`)
        const { emails, nextCursor } = await response.json()
        this.snoozedEmails = emails.map(mapEmailRow)
        this.snoozedCursor = nextCursor ?? null
        this.hasMoreSnoozed = Boolean(nextCursor)
        this.isSnoozedLoaded = true
      } catch (error) {
        console.error('Failed to load snoozed emails:', error)
        this.notify('Failed to load snoozed emails.', 'error')
      } finally {
        this.isSnoozedRefreshing = false
      }
    },

    async loadMoreSnoozedEmails() {
      if (!this.snoozedCursor || this.isSnoozedRefreshing) return
      this.isSnoozedRefreshing = true
      try {
        const headers = await this.authHeaders()
        const url = `/api/emails?folder=snoozed&limit=${PAGE_SIZE}&before=${encodeURIComponent(this.snoozedCursor)}`
        const response = await fetch(url, { headers })
        if (!response.ok) throw new Error(`GET /api/emails responded ${response.status}`)
        const { emails, nextCursor } = await response.json()
        this.snoozedEmails.push(...emails.map(mapEmailRow))
        this.snoozedCursor = nextCursor ?? null
        this.hasMoreSnoozed = Boolean(nextCursor)
      } catch (error) {
        console.error('Failed to load more snoozed emails:', error)
        this.notify('Failed to load more snoozed emails.', 'error')
      } finally {
        this.isSnoozedRefreshing = false
      }
    },

    async loadDoneEmails() {
      this.isDoneRefreshing = true
      try {
        const headers = await this.authHeaders()
        const response = await fetch(`/api/emails?folder=done&limit=${PAGE_SIZE}`, { headers })
        if (!response.ok) throw new Error(`GET /api/emails responded ${response.status}`)
        const { emails, nextCursor } = await response.json()
        this.doneEmails = emails.map(mapEmailRow)
        this.doneCursor = nextCursor ?? null
        this.hasMoreDone = Boolean(nextCursor)
        this.isDoneLoaded = true
      } catch (error) {
        console.error('Failed to load done emails:', error)
        this.notify('Failed to load done emails.', 'error')
      } finally {
        this.isDoneRefreshing = false
      }
    },

    async loadMoreDoneEmails() {
      if (!this.doneCursor || this.isDoneRefreshing) return
      this.isDoneRefreshing = true
      try {
        const headers = await this.authHeaders()
        const url = `/api/emails?folder=done&limit=${PAGE_SIZE}&before=${encodeURIComponent(this.doneCursor)}`
        const response = await fetch(url, { headers })
        if (!response.ok) throw new Error(`GET /api/emails responded ${response.status}`)
        const { emails, nextCursor } = await response.json()
        this.doneEmails.push(...emails.map(mapEmailRow))
        this.doneCursor = nextCursor ?? null
        this.hasMoreDone = Boolean(nextCursor)
      } catch (error) {
        console.error('Failed to load more done emails:', error)
        this.notify('Failed to load more done emails.', 'error')
      } finally {
        this.isDoneRefreshing = false
      }
    },

    async loadLabels() {
      try {
        const headers = await this.authHeaders()
        const response = await fetch('/api/labels', { headers })
        if (!response.ok) {
          throw new Error(`GET /api/labels responded ${response.status}`)
        }
        const { labels } = await response.json()
        this.labels = labels
      } catch (error) {
        console.error('Failed to load labels:', error)
        this.notify('Failed to load labels.', 'error')
      }
    },

    // Returns true on success so the settings form knows to reset.
    async createLabel({ name, color, description }) {
      try {
        const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
        const response = await fetch('/api/labels', {
          method: 'POST',
          headers,
          body: JSON.stringify({ name, color, description }),
        })
        if (response.status === 409) {
          this.notify('A label with that name already exists.', 'error')
          return false
        }
        if (!response.ok) {
          throw new Error(`POST /api/labels responded ${response.status}`)
        }
        const { label } = await response.json()
        this.labels = [...this.labels, label].sort((a, b) => a.name.localeCompare(b.name))
        this.notify('Label created.')
        return true
      } catch (error) {
        console.error('Failed to create label:', error)
        this.notify('Failed to create label.', 'error')
        return false
      }
    },

    async deleteLabel(id) {
      try {
        const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
        const response = await fetch('/api/labels', {
          method: 'DELETE',
          headers,
          body: JSON.stringify({ id }),
        })
        if (!response.ok) {
          throw new Error(`DELETE /api/labels responded ${response.status}`)
        }
        this.labels = this.labels.filter((label) => label.id !== id)
        this.notify('Label deleted.')
      } catch (error) {
        console.error('Failed to delete label:', error)
        this.notify('Failed to delete label.', 'error')
      }
    },

    async renameLabel(label, name) {
      const nextName = name.trim()
      if (!nextName || nextName === label.name) return nextName === label.name

      const previousName = label.name
      try {
        const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
        const response = await fetch('/api/labels', {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ id: label.id, name: nextName }),
        })
        if (response.status === 409) {
          this.notify('A label with that name already exists.', 'error')
          return false
        }
        if (!response.ok) throw new Error(`PATCH /api/labels responded ${response.status}`)

        const { label: updatedLabel } = await response.json()
        Object.assign(label, updatedLabel)
        this.labels.sort((a, b) => a.name.localeCompare(b.name))

        for (const list of [
          this.traditionalEmails,
          this.sentEmails,
          this.spamEmails,
          this.snoozedEmails,
          this.doneEmails,
        ]) {
          for (const email of list) {
            for (const messageLabel of email.labels || []) {
              if (messageLabel.name === previousName) messageLabel.name = updatedLabel.name
            }
          }
        }

        this.notify('Label renamed.')
        return true
      } catch (error) {
        console.error('Failed to rename label:', error)
        this.notify('Failed to rename label.', 'error')
        return false
      }
    },

    async setLabelAutoApply(label, autoApply) {
      const previous = label.auto_apply
      label.auto_apply = autoApply
      try {
        const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
        const response = await fetch('/api/labels', {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ id: label.id, auto_apply: autoApply }),
        })
        if (!response.ok) throw new Error(`PATCH /api/labels responded ${response.status}`)
      } catch (error) {
        label.auto_apply = previous
        console.error('Failed to update label auto-tagging:', error)
        this.notify('Failed to update auto-tagging.', 'error')
      }
    },

    // Hybrid (keyword + semantic) search via /api/search; the results replace
    // the inbox list until clearSearch() restores it. searchSeq guards against
    // out-of-order responses: only the latest issued search may apply.
    async searchEmails(query) {
      const q = query.trim()
      if (!q) return
      const seq = ++this.searchSeq
      this.isRefreshing = true
      try {
        const headers = await this.authHeaders()
        const response = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { headers })
        if (!response.ok) {
          throw new Error(`GET /api/search responded ${response.status}`)
        }
        const { emails } = await response.json()
        if (seq !== this.searchSeq) return
        this.activeSearchQuery = q
        this.traditionalEmails = emails.map(mapEmailRow)
      } catch (error) {
        if (seq !== this.searchSeq) return
        console.error('Search failed:', error)
        this.notify('Search failed. Please try again.', 'error')
      } finally {
        if (seq === this.searchSeq) {
          this.isRefreshing = false
        }
      }
    },

    // Leaves search mode and reloads the full inbox. Bumping searchSeq also
    // invalidates any search still in flight.
    clearSearch() {
      if (!this.activeSearchQuery) return
      this.searchSeq++
      this.activeSearchQuery = ''
      return this.loadEmails()
    },

    async updateMessage(id, changes) {
      const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
      const response = await fetch('/api/messages', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ id, ...changes }),
      })
      if (!response.ok) {
        throw new Error(`PATCH /api/messages responded ${response.status}`)
      }
      return response.json()
    },

    openReader(email) {
      this.setUnread(email, false)
      this.openEmailId = email.id
      this.fetchMessageBody(email.id)
    },

    // Fetches a message's full body on demand and caches it by id. Returns the
    // cached { html, text } (html is the raw, still-untrusted body_html — the
    // reader sanitizes it before rendering). Successful fetches are cached so
    // reopening doesn't refetch; failures are not cached so a later open can
    // retry. Never throws — the reader falls back to the list's body_text.
    async fetchMessageBody(id) {
      if (!id) return null
      if (this.messageBodies.has(id)) return this.messageBodies.get(id)
      // Only flag loading for an actual fetch — cache hits above return early so
      // reopening a message never spins.
      this.bodyLoadingId = id
      try {
        const headers = await this.authHeaders()
        const response = await fetch(`/api/messages?id=${encodeURIComponent(id)}`, { headers })
        if (!response.ok) {
          throw new Error(`GET /api/messages responded ${response.status}`)
        }
        const { body_html, body_text, unsubscribe, summary } = await response.json()
        const body = { html: body_html ?? null, text: body_text ?? null, unsubscribe: unsubscribe ?? null }
        this.messageBodies.set(id, body)
        if (typeof summary === 'string' && summary.trim()) {
          this.messageSummaries.set(id, summary.trim())
        }
        return body
      } catch (error) {
        console.error('Failed to load message body:', error)
        return null
      } finally {
        // Always clear, whether the fetch succeeded or failed, but only if this
        // call is still the one in flight (a newer open may have superseded it).
        if (this.bodyLoadingId === id) this.bodyLoadingId = null
      }
    },

    async summarizeEmail(email) {
      if (!email || this.summaryLoadingId) return null
      const id = email.id
      this.summaryLoadingId = id
      try {
        const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
        const response = await fetch('/api/summarize', {
          method: 'POST',
          headers,
          body: JSON.stringify({ id }),
        })
        if (!response.ok) {
          throw new Error(`POST /api/summarize responded ${response.status}`)
        }
        const { summary } = await response.json()
        if (typeof summary !== 'string' || !summary.trim()) {
          throw new Error('POST /api/summarize returned an invalid summary')
        }
        const normalized = summary.trim()
        this.messageSummaries.set(id, normalized)
        return normalized
      } catch (error) {
        console.error('AI summarization failed:', error)
        this.notify('AI summarization failed. Please try again.', 'error')
        return null
      } finally {
        if (this.summaryLoadingId === id) this.summaryLoadingId = null
      }
    },

    closeReader() {
      this.openEmailId = null
    },

    // Automated unsubscribe for newsletters (List-Unsubscribe header). The
    // server performs a one-click POST when the sender supports RFC 8058;
    // otherwise it hands back the sender's unsubscribe link (opened in a new
    // tab) or a mailto fallback.
    async unsubscribeEmail(email) {
      if (!email || this.unsubscribingId) return
      this.unsubscribingId = email.id
      try {
        const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
        const response = await fetch('/api/messages', {
          method: 'POST',
          headers,
          body: JSON.stringify({ id: email.id, action: 'unsubscribe' }),
        })
        if (!response.ok) {
          throw new Error(`POST /api/messages responded ${response.status}`)
        }
        const result = await response.json()
        if (result.status === 'unsubscribed') {
          const cached = this.messageBodies.get(email.id)
          if (cached) this.messageBodies.set(email.id, { ...cached, unsubscribed: true })
          this.notify(`Unsubscribed from ${email.sender}.`)
        } else if (result.status === 'manual' && result.url) {
          window.open(result.url, '_blank', 'noopener')
          this.notify('Finish unsubscribing on the page that just opened.')
        } else if (result.status === 'manual' && result.mailto) {
          window.location.href = result.mailto
        } else {
          this.notify('This sender offers no automated unsubscribe.', 'error')
        }
      } catch (error) {
        console.error('Unsubscribe failed:', error)
        this.notify('Failed to unsubscribe. Please try again.', 'error')
      } finally {
        if (this.unsubscribingId === email.id) this.unsubscribingId = null
      }
    },

    // Optimistically flips starred state and persists it; reverts on failure.
    toggleStar(email) {
      const nextStarred = !email.starred
      email.starred = nextStarred
      this.updateMessage(email.id, { is_starred: nextStarred }).catch((error) => {
        console.error('Failed to update starred state:', error)
        email.starred = !nextStarred
        this.notify('Failed to update starred state.', 'error')
      })
    },

    // Moves an inbox message out of sight until its scheduled time. Future
    // messages live in the Snoozed folder; the inbox API returns them again
    // once due, when the view places them in the Due Today group.
    async scheduleEmail(email, scheduledFor, label, shouldNotify = true) {
      if (!email) return false
      const inboxIndex = this.traditionalEmails.indexOf(email)
      const snoozedIndex = this.snoozedEmails.indexOf(email)
      const previousScheduledFor = email.scheduledFor
      const wasUnreadInbox = inboxIndex > -1 && email.unread

      email.scheduledFor = scheduledFor
      if (inboxIndex > -1) this.traditionalEmails.splice(inboxIndex, 1)
      if (this.openEmailId === email.id) this.openEmailId = null
      if (wasUnreadInbox) this.unreadInboxCount = Math.max(0, this.unreadInboxCount - 1)
      if (this.isSnoozedLoaded && snoozedIndex === -1) this.snoozedEmails.unshift(email)

      try {
        await this.updateMessage(email.id, { scheduled_for: scheduledFor })
        if (shouldNotify) this.notify(`Scheduled for ${label}.`)
        return true
      } catch (error) {
        console.error('Failed to schedule email:', error)
        email.scheduledFor = previousScheduledFor
        if (inboxIndex > -1) this.traditionalEmails.splice(inboxIndex, 0, email)
        if (snoozedIndex === -1) {
          this.snoozedEmails = this.snoozedEmails.filter((item) => item !== email)
        }
        if (wasUnreadInbox) this.unreadInboxCount++
        this.notify('Failed to schedule email.', 'error')
        return false
      }
    },

    // Optimistically removes the email from the list (closing the reader if
    // it was open) and persists the archive flag.
    archiveEmail(email) {
      this.setUnread(email, false)
      if (this.openEmailId === email.id) {
        this.openEmailId = null
      }
      for (const list of [this.traditionalEmails, this.snoozedEmails, this.spamEmails]) {
        const index = list.indexOf(email)
        if (index > -1) list.splice(index, 1)
      }
      if (this.isDoneLoaded && !this.doneEmails.some((item) => item.id === email.id)) {
        this.doneEmails.unshift(email)
      }
      this.updateMessage(email.id, { is_archived: true }).catch((error) => {
        console.error('Failed to archive email:', error)
        this.notify('Failed to archive email.', 'error')
      })
    },

    // Optimistically flips read state and persists it; reverts on failure.
    // The count adjusts incrementally: with pagination (and during search)
    // the loaded list is a subset, so recounting it would be wrong.
    setUnread(email, unread) {
      if (email.unread === unread) return
      const countsTowardInbox = this.traditionalEmails.includes(email)
      email.unread = unread
      if (countsTowardInbox) {
        this.unreadInboxCount = Math.max(0, this.unreadInboxCount + (unread ? 1 : -1))
      }
      this.updateMessage(email.id, { is_unread: unread }).catch((error) => {
        console.error('Failed to update read state:', error)
        email.unread = !unread
        if (countsTowardInbox) {
          this.unreadInboxCount = Math.max(0, this.unreadInboxCount + (unread ? -1 : 1))
        }
        this.notify('Failed to update read state.', 'error')
      })
    },

    notify(message, kind = 'info') {
      const id = this.nextToastId++
      this.toasts.push({ id, message, kind })
      setTimeout(() => this.dismissToast(id), 4000)
    },

    dismissToast(id) {
      const index = this.toasts.findIndex((t) => t.id === id)
      if (index > -1) {
        this.toasts.splice(index, 1)
      }
    },

    // replyToMessageId (optional) threads the stored sent copy with the
    // message being replied to.
    async sendMail({ to, subject, text, replyToMessageId }) {
      const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
      const response = await fetch('/api/send', {
        method: 'POST',
        headers,
        body: JSON.stringify({ to, subject, text, replyToMessageId }),
      })
      if (!response.ok) {
        throw new Error(`POST /api/send responded ${response.status}`)
      }
      // Refresh the outbox in the background so the new mail shows up; only
      // once the list has been loaded, and never at the send's expense.
      if (this.isSentLoaded) {
        this.loadSentEmails().catch(() => {})
      }
      return response.json()
    },

    toggleTheme() {
      const currentTheme = document.documentElement.getAttribute('data-theme')
      const newTheme = currentTheme === 'dark' ? 'light' : 'dark'
      document.documentElement.setAttribute('data-theme', newTheme)
    },

    openComposer() {
      this.isComposerActive = true
    },

    closeComposer() {
      this.isComposerActive = false
      this.composerTo = ''
      this.composerSubject = ''
      this.composerTextArea = ''
      this.isAiDraftActive = false
      this.isAiDraftLoading = false
      this.aiDraftPreview = ''
      this.composerAiInstruction = ''
    },

    openAiDraft() {
      this.isAiDraftActive = true
      if (!this.composerAiInstruction) {
        this.composerAiInstruction = this.composerTextArea.trim()
          ? 'Improve this draft while keeping its meaning.'
          : 'Write a concise, friendly email.'
      }
    },

    async requestAiDraft() {
      const instruction = this.composerAiInstruction.trim()
      if (!instruction || this.isAiDraftLoading) return
      this.isAiDraftActive = true
      this.isAiDraftLoading = true
      try {
        const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
        const response = await fetch('/api/compose', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            instruction,
            to: this.composerTo,
            subject: this.composerSubject,
            existingText: this.composerTextArea,
          }),
        })
        if (!response.ok) throw new Error(`POST /api/compose responded ${response.status}`)
        const { draft } = await response.json()
        this.aiDraftPreview = draft.text
        if (!this.composerSubject.trim() && draft.subject) this.composerSubject = draft.subject
      } catch (error) {
        console.error('AI compose failed:', error)
        this.notify('AI compose failed. Please try again.', 'error')
      } finally {
        this.isAiDraftLoading = false
      }
    },

    insertAiDraft() {
      if (!this.aiDraftPreview) return
      this.composerTextArea = this.aiDraftPreview
      this.isAiDraftActive = false
    },

    async sendEmail() {
      // Guard the action as well as the button: two rapid events can otherwise
      // start two requests before the composer has a chance to close.
      if (this.isSendingEmail) return
      this.isSendingEmail = true
      try {
        await this.sendMail({
          to: this.composerTo,
          subject: this.composerSubject,
          text: this.composerTextArea,
        })
        this.closeComposer()
        this.notify('Email sent.')
      } catch (error) {
        console.error('Failed to send email:', error)
        this.notify('Failed to send email. Please try again.', 'error')
      } finally {
        this.isSendingEmail = false
      }
    },

    // Real RAG: /api/ask retrieves the most relevant stored emails via
    // hybrid search and answers with the sources it used.
    async askGemini(query) {
      this.isChatDrawerActive = true
      this.chatHistory.push({ text: query, sender: 'user' })
      this.isChatLoading = true
      try {
        const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
        const response = await fetch('/api/ask', {
          method: 'POST',
          headers,
          body: JSON.stringify({ question: query }),
        })
        if (!response.ok) {
          throw new Error(`POST /api/ask responded ${response.status}`)
        }
        const { answer, sources } = await response.json()
        this.chatHistory.push({ text: answer, sender: 'ai', sources: sources || [] })
      } catch (error) {
        console.error('Ask failed:', error)
        this.chatHistory.push({
          text: "Sorry, I couldn't reach the assistant. Please try again.",
          sender: 'ai',
          sources: [],
        })
      } finally {
        this.isChatLoading = false
      }
    },
  },
})
