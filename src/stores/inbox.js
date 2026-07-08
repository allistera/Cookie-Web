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

    async loadEmails() {
      this.isRefreshing = true
      this.statusTime = 'Syncing inbox...'
      try {
        const headers = {}
        const auth0 = getAuth0()
        if (auth0) {
          const token = await auth0.getAccessTokenSilently()
          headers.Authorization = `Bearer ${token}`
        }
        const response = await fetch('/api/emails', { headers })
        if (!response.ok) {
          throw new Error(`GET /api/emails responded ${response.status}`)
        }
        const { emails } = await response.json()
        this.traditionalEmails = emails.map((message) => ({
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
        }))
        this.unreadInboxCount = this.traditionalEmails.filter((e) => e.unread).length
        this.statusTime = 'Updated just now'
      } catch (error) {
        console.error('Failed to load inbox:', error)
        this.statusTime = 'Inbox unavailable'
      } finally {
        this.isRefreshing = false
      }
    },

    refreshInbox() {
      return this.loadEmails()
    },

    async updateMessage(id, changes) {
      const headers = { 'Content-Type': 'application/json' }
      const auth0 = getAuth0()
      if (auth0) {
        const token = await auth0.getAccessTokenSilently()
        headers.Authorization = `Bearer ${token}`
      }
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
    setUnread(email, unread) {
      if (email.unread === unread) return
      email.unread = unread
      this.unreadInboxCount = this.traditionalEmails.filter((e) => e.unread).length
      this.updateMessage(email.id, { is_unread: unread }).catch((error) => {
        console.error('Failed to update read state:', error)
        email.unread = !unread
        this.unreadInboxCount = this.traditionalEmails.filter((e) => e.unread).length
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

    async sendMail({ to, subject, text }) {
      const headers = { 'Content-Type': 'application/json' }
      const auth0 = getAuth0()
      if (auth0) {
        const token = await auth0.getAccessTokenSilently()
        headers.Authorization = `Bearer ${token}`
      }
      const response = await fetch('/api/send', {
        method: 'POST',
        headers,
        body: JSON.stringify({ to, subject, text }),
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

    askGemini(query) {
      this.isChatDrawerActive = true

      // User message
      this.chatHistory.push({ text: query, sender: 'user' })

      this.isChatLoading = true

      let responseText =
        "Sorry, I couldn't find details about that in your inbox. Please refine your query."
      let citationLabel = ''
      let citationActionType = '' // 'sheets', 'waiver', 'kitchen'

      if (query.toLowerCase().includes('coach mike') || query.toLowerCase().includes('snack')) {
        responseText =
          "Coach Mike sent an email reminding you that it's your turn to bring snacks for 20 people tomorrow. One child has a peanut allergy, so snacks must be peanut-free. You can log details in the Soccer Signup Sheet."
        citationLabel = 'Open Snack Sheet'
        citationActionType = 'sheets'
      } else if (
        query.toLowerCase().includes('waiver') ||
        query.toLowerCase().includes('college')
      ) {
        responseText =
          "Yes, you have an outstanding liability waiver to sign for your daughter's University of State tour on June 12th. You can sign it directly here."
        citationLabel = 'Sign Digital Waiver'
        citationActionType = 'waiver'
      } else if (
        query.toLowerCase().includes('renovation') ||
        query.toLowerCase().includes('kitchen')
      ) {
        responseText =
          "Here is a summary of your Kitchen Renovation updates:\n\n1. **City Construction**: Sent a revised floor plan this morning. It incorporates the new bay window design to let in more natural light.\n2. **Insurance Claim**: The homeowner's insurance carrier has processed your claim. You should receive a final response in one week."
        citationLabel = 'Reply to Tile Vendor'
        citationActionType = 'kitchen'
      }

      setTimeout(() => {
        this.isChatLoading = false
        const aiMessage = {
          text: '',
          sender: 'ai',
          citationLabel,
          citationActionType,
          typing: true,
        }
        this.chatHistory.push(aiMessage)

        const historyIndex = this.chatHistory.length - 1
        let i = 0
        const interval = setInterval(() => {
          if (i < responseText.length) {
            this.chatHistory[historyIndex].text += responseText.charAt(i)
            i++
          } else {
            clearInterval(interval)
            this.chatHistory[historyIndex].typing = false
          }
        }, 10)
      }, 1500)
    },
  },
})
