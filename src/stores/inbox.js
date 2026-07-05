import { defineStore } from 'pinia'

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
    traditionalEmails: [
      {
        id: 1,
        sender: 'City Construction',
        subject: 'Revised Floor Plan - Natural Light adjustments',
        snippet:
          'Hi Rose, following up on our call yesterday, we modified the bay window design...',
        date: '10:04 AM',
        unread: true,
        starred: false,
      },
      {
        id: 2,
        sender: "Homeowner's Insurance",
        subject: 'Claim #99281 - Processing Update',
        snippet:
          'We are pleased to inform you that your insurance claim has been processed. You will hear...',
        date: '9:42 AM',
        unread: true,
        starred: true,
      },
      {
        id: 3,
        sender: 'Coach Mike',
        subject: 'Soccer Snacks - June 6th Scrimmage',
        snippet:
          'Hey parents, just a reminder that tomorrow we play the Green Eagles. Rose has snacks...',
        date: 'Yesterday',
        unread: true,
        starred: false,
      },
      {
        id: 4,
        sender: 'Univ of State Tours',
        subject: 'Confirmation: June 12th guided tour',
        snippet:
          'Thank you for scheduling a campus visit. Please complete the waiver in the link...',
        date: 'Yesterday',
        unread: false,
        starred: false,
      },
      {
        id: 5,
        sender: 'Resale Marketplace',
        subject: 'Item Sold! Baby winter coat bundle',
        snippet: 'Congratulations, your listing was purchased for $15. Print the label and mail...',
        date: 'Jun 3',
        unread: true,
        starred: false,
      },
      {
        id: 6,
        sender: 'Palm House Hotel',
        subject: 'Your reservation upgrade is confirmed',
        snippet: 'Dear Rose, we have upgraded your room to Deluxe. Click here to see detail...',
        date: 'Jun 2',
        unread: false,
        starred: true,
      },
      {
        id: 7,
        sender: 'Sarah Miller',
        subject: 'RE: Neighborhood Block Party',
        snippet: 'I can bring the paper plates and napkins! Do we need cups too?',
        date: 'May 30',
        unread: false,
        starred: false,
      },
      {
        id: 8,
        sender: 'Electric Co.',
        subject: 'Your May billing statement is ready',
        snippet: 'Account ending in 4991. Total due: $112.40. Auto-pay will process on...',
        date: 'May 28',
        unread: false,
        starred: false,
      },
      {
        id: 9,
        sender: 'Netflix',
        subject: 'New Shows for June 2026',
        snippet:
          'Here is your curated list of movies and television series launching this month...',
        date: 'May 27',
        unread: false,
        starred: false,
      },
      {
        id: 10,
        sender: 'Lincoln High',
        subject: 'FAFSA Deadlines and College Prep guidance',
        snippet:
          'Parents of juniors, the FAFSA deadline has been shifted. Please review the new calendar...',
        date: 'May 25',
        unread: false,
        starred: false,
      },
      {
        id: 11,
        sender: 'Target Shop',
        subject: '20% Off Patio Furniture this weekend only',
        snippet: 'Upgrade your backyard space before summer begins. Exclusions apply...',
        date: 'May 24',
        unread: false,
        starred: false,
      },
      {
        id: 12,
        sender: 'Lincoln Counselors',
        subject: 'Scholarships for the Arts program',
        snippet: "We noticed your daughter's excellent fine arts GPA. She may qualify for...",
        date: 'May 22',
        unread: false,
        starred: false,
      },
      {
        id: 13,
        sender: 'Resale Marketplace',
        subject: 'Inquiry: Toddler shoe lot availability',
        snippet: 'A buyer sent a message: Is the lot of shoes still available for pickup?',
        date: 'May 20',
        unread: false,
        starred: false,
      },
      {
        id: 14,
        sender: 'Zoom Video',
        subject: 'Invoice for subscription renewal',
        snippet: 'Your annual Zoom Pro subscription has renewed. Amount charged: $149.90...',
        date: 'May 19',
        unread: false,
        starred: false,
      },
    ],
    unreadInboxCount: 14,
    statusTime: 'Updated 3 minutes ago',
    isRefreshing: false,

    // Chat state
    chatHistory: [],
    isChatDrawerActive: false,
    isChatLoading: false,

    // Composer state
    isComposerActive: false,
    composerTextArea: '',
    isGeminiDraftActive: false,
    geminiDraftPreview: '',
    activeTodoId: null,

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

    refreshInbox() {
      this.isRefreshing = true
      this.statusTime = 'Syncing with Gemini...'

      setTimeout(() => {
        this.isRefreshing = false
        this.statusTime = 'Updated just now'
      }, 1200)
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
    },

    closeComposer() {
      this.isComposerActive = false
      this.activeTodoId = null
      this.composerTextArea = ''
      this.isGeminiDraftActive = false
      this.geminiDraftPreview = ''
    },

    triggerGeminiDraft() {
      this.isGeminiDraftActive = true
      this.geminiDraftPreview = ''

      const draftText =
        "Hi City Tile and Stone,\n\nI confirm the selection of the White Subway Tiles for our kitchen renovation. Please proceed with the order so we stay aligned with the contractor's installation timeline.\n\nBest,\nRose"

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

    sendEmail() {
      this.isComposerActive = false
      if (this.activeTodoId) {
        this.completeTodo(this.activeTodoId)
      }
      this.composerTextArea = ''
      alert('Email sent successfully!')
    },

    saveSoccerSheet() {
      this.closeTodoModal()
      if (this.activeTodoId) {
        this.completeTodo(this.activeTodoId)
      }
      alert('Soccer Snacks Signup updated successfully! Saving details and updating Gmail.')
    },

    submitWaiver() {
      this.closeTodoModal()
      if (this.activeTodoId) {
        this.completeTodo(this.activeTodoId)
      }
      alert('Liability Waiver signed and submitted to the University of State! Checkmark complete.')
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
