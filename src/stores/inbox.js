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
  return {
    id: message.id,
    sender: message.from_name || message.from_address,
    address: message.from_address,
    subject: message.subject,
    snippet: message.snippet,
    body: message.body_text,
    sentAt: message.sent_at,
    date: formatEmailDate(message.sent_at),
    unread: message.is_unread,
    starred: message.is_starred,
    labels: message.labels || [],
  }
}

export const useInboxStore = defineStore('inbox', {
  state: () => ({
    todos: [
      {
        id: 'todo-kitchen',
        title: 'Kitchen Renovation',
        description:
          "A reply to the tile vendor is due, confirming selection so they can order in time to have it installed by the contractor's timeline.",
        from: ['Email'],
        btnText: 'Reply',
        btnIcon: 'edit',
        action: 'open-reply',
        visible: true,
        completed: false,
      },
      {
        id: 'todo-waiver',
        title: 'RSVP for College Tour',
        description:
          'The University of State sent a confirmation for the June 12th tour. You need to sign the digital waiver for your daughter.',
        from: ['Email'],
        btnText: 'View',
        btnIcon: 'mail',
        action: 'open-waiver',
        visible: true,
        completed: false,
      },
      {
        id: 'todo-soccer',
        title: 'Bring snack to soccer practice',
        description:
          "Coach Mike reminded you it's your turn to bring snacks for 20 people tomorrow and to log what you're bringing; one child has a peanut allergy.",
        from: ['Email', 'Sheet'],
        btnText: 'Open',
        btnIcon: 'table_chart',
        action: 'open-sheet',
        visible: true,
        completed: false,
      },
      {
        id: 'todo-marketplace',
        title: 'Resale Marketplace Sale',
        description:
          'Resale Marketplace has notified you that the baby winter coat bundle is now marked as sold for $15. You need to contact buyer within 3 days.',
        from: ['Email'],
        btnText: 'Open',
        btnIcon: 'link',
        action: 'open-marketplace',
        visible: false,
        completed: false,
      },
      {
        id: 'todo-chicago',
        title: 'Chicago Summer Trip',
        description:
          'Confirm your upgrade to the Deluxe room at the Palm House by Tuesday. The hotel has updated your reservation details.',
        from: ['Email'],
        btnText: 'View',
        btnIcon: 'mail',
        action: 'open-chicago',
        visible: false,
        completed: false,
      },
    ],
    traditionalEmails: [],
    unreadInboxCount: 0,
    statusTime: 'Loading...',
    isRefreshing: false,
    activeSearchQuery: '',
    searchSeq: 0,
    emailsCursor: null,
    hasMoreEmails: false,

    // Chat state
    chatHistory: [],
    isChatDrawerActive: false,
    isChatLoading: false,

    // Composer state
    isComposerActive: false,
    composerTo: '',
    composerSubject: '',
    composerTextArea: '',
    isGeminiDraftActive: false,
    geminiDraftPreview: '',
    activeTodoId: null,

    // Toast notifications
    toasts: [],
    nextToastId: 1,

    // Modals
    activeModal: null, // 'sheets' or 'waiver'

    // Sheets input state
    sheetSnackText: 'Fruit kabobs & juice boxes (Peanut Free!)',
  }),

  getters: {
    visibleTodos(state) {
      return state.todos.filter((t) => t.visible && !t.completed)
    },
    hiddenTodosCount(state) {
      return state.todos.filter((t) => !t.visible && !t.completed).length
    },
    totalActiveTodosCount(state) {
      return state.todos.filter((t) => !t.completed).length
    },
    allLabels(state) {
      const byName = new Map()
      for (const email of state.traditionalEmails) {
        for (const label of email.labels || []) {
          if (!byName.has(label.name)) {
            byName.set(label.name, label)
          }
        }
      }
      return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
    },
  },

  actions: {
    completeTodo(id) {
      // Find the todo and mark it complete
      const todo = this.todos.find((t) => t.id === id)
      if (!todo) return

      todo.completed = true

      // Promote the first hidden todo
      const firstHidden = this.todos.find((t) => !t.visible && !t.completed)
      if (firstHidden) {
        firstHidden.visible = true
      }

      // Decrement unread inbox count if relevant
      if (this.unreadInboxCount > 0) {
        this.unreadInboxCount--
      }
    },

    showAllTodos() {
      this.todos.forEach((t) => {
        if (!t.completed) {
          t.visible = true
        }
      })
    },

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
      this.statusTime = 'Syncing inbox...'
      try {
        const headers = await this.authHeaders()
        const response = await fetch(`/api/emails?limit=${PAGE_SIZE}`, { headers })
        if (!response.ok) {
          throw new Error(`GET /api/emails responded ${response.status}`)
        }
        const { emails, nextCursor, unreadCount } = await response.json()
        this.traditionalEmails = emails.map(mapEmailRow)
        this.emailsCursor = nextCursor ?? null
        this.hasMoreEmails = Boolean(nextCursor)
        this.unreadInboxCount =
          typeof unreadCount === 'number'
            ? unreadCount
            : this.traditionalEmails.filter((e) => e.unread).length
        this.statusTime = 'Updated just now'
      } catch (error) {
        console.error('Failed to load inbox:', error)
        this.statusTime = 'Inbox unavailable'
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

    // Hybrid (keyword + semantic) search via /api/search; the results replace
    // the inbox list until clearSearch() restores it. searchSeq guards against
    // out-of-order responses: only the latest issued search may apply.
    async searchEmails(query) {
      const q = query.trim()
      if (!q) return
      const seq = ++this.searchSeq
      this.isRefreshing = true
      this.statusTime = 'Searching...'
      try {
        const headers = {}
        const auth0 = getAuth0()
        if (auth0) {
          const token = await auth0.getAccessTokenSilently()
          headers.Authorization = `Bearer ${token}`
        }
        const response = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { headers })
        if (!response.ok) {
          throw new Error(`GET /api/search responded ${response.status}`)
        }
        const { emails } = await response.json()
        if (seq !== this.searchSeq) return
        this.activeSearchQuery = q
        this.traditionalEmails = emails.map(mapEmailRow)
        this.statusTime = emails.length === 1 ? '1 result' : `${emails.length} results`
      } catch (error) {
        if (seq !== this.searchSeq) return
        console.error('Search failed:', error)
        this.notify('Search failed. Please try again.', 'error')
        this.statusTime = 'Search unavailable'
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

    // Optimistically flips read state and persists it; reverts on failure.
    // The count adjusts incrementally: with pagination (and during search)
    // the loaded list is a subset, so recounting it would be wrong.
    setUnread(email, unread) {
      if (email.unread === unread) return
      email.unread = unread
      this.unreadInboxCount = Math.max(0, this.unreadInboxCount + (unread ? 1 : -1))
      this.updateMessage(email.id, { is_unread: unread }).catch((error) => {
        console.error('Failed to update read state:', error)
        email.unread = !unread
        this.unreadInboxCount = Math.max(0, this.unreadInboxCount + (unread ? -1 : 1))
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
      return response.json()
    },

    toggleTheme() {
      const currentTheme = document.documentElement.getAttribute('data-theme')
      const newTheme = currentTheme === 'dark' ? 'light' : 'dark'
      document.documentElement.setAttribute('data-theme', newTheme)
    },

    openTodoModal(name, todoId) {
      this.activeModal = name
      this.activeTodoId = todoId
    },

    closeTodoModal() {
      this.activeModal = null
      this.activeTodoId = null
    },

    openComposer(todoId) {
      this.isComposerActive = true
      this.activeTodoId = todoId
      if (todoId === 'todo-kitchen') {
        this.composerTo = 'info@citytileandstone.com'
        this.composerSubject = 'Re: Kitchen Renovation - Tile Selection Due'
      }
    },

    closeComposer() {
      this.isComposerActive = false
      this.activeTodoId = null
      this.composerTo = ''
      this.composerSubject = ''
      this.composerTextArea = ''
      this.isGeminiDraftActive = false
      this.geminiDraftPreview = ''
    },

    triggerGeminiDraft() {
      this.isGeminiDraftActive = true
      this.geminiDraftPreview = ''

      const draftText =
        "Hi City Tile and Stone,\n\nI confirm the selection of the White Subway Tiles for our kitchen renovation. Please proceed with the order so we stay aligned with the contractor's installation timeline.\n\nBest,\nAllister"

      let i = 0
      const interval = setInterval(() => {
        if (i < draftText.length) {
          this.geminiDraftPreview += draftText.charAt(i)
          i++
        } else {
          clearInterval(interval)
        }
      }, 15)
    },

    insertGeminiDraft() {
      this.composerTextArea = this.geminiDraftPreview
      this.isGeminiDraftActive = false
    },

    async sendEmail() {
      try {
        await this.sendMail({
          to: this.composerTo,
          subject: this.composerSubject,
          text: this.composerTextArea,
        })
      } catch (error) {
        console.error('Failed to send email:', error)
        this.notify('Failed to send email. Please try again.', 'error')
        return
      }
      if (this.activeTodoId) {
        this.completeTodo(this.activeTodoId)
      }
      this.closeComposer()
      this.notify('Email sent.')
    },

    saveSoccerSheet() {
      this.closeTodoModal()
      if (this.activeTodoId) {
        this.completeTodo(this.activeTodoId)
      }
      this.notify('Soccer Snacks Signup updated.')
    },

    submitWaiver() {
      this.closeTodoModal()
      if (this.activeTodoId) {
        this.completeTodo(this.activeTodoId)
      }
      this.notify('Waiver signed and submitted.')
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
