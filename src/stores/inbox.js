import { defineStore } from 'pinia'

import { getAuth0 } from '../auth0-client'
import { LABELS_API_URL, MESSAGES_API_URL, TASKS_API_URL } from '../lib/apiWorkers'
import { recipientsValid } from '../lib/recipients'
import { isSafeUnsubscribeUrl } from '../lib/isSafeUnsubscribeUrl'
import { sanitizeEmailHtml } from '../lib/sanitizeEmailHtml'
import { plainTextToHtml, htmlToText } from '../lib/composeHtml'
import { getStoredSignature, saveStoredSignature } from '../lib/signature'
import { getStoredSnippets, saveStoredSnippets } from '../lib/snippets'

// Undo-send: the message waits this many (cancellable) seconds before it is
// actually sent. sendCountdownTimer is the interval driving that countdown; it
// lives at module scope so it stays out of reactive state.
const UNDO_SEND_SECONDS = 5
let sendCountdownTimer = null
let searchAbortController = null

// A body fetch that resolves faster than this would otherwise flash straight
// from click to rendered content with no visible feedback at all — hold the
// reveal open at least this long so the reader's loading spinner is always
// perceivable, not just on a slow connection.
const MIN_BODY_LOADING_MS = 200

// AI compose should draft the message body only. The personal signature is
// boilerplate the user pre-configured (and we prefill it into fresh drafts), so
// feeding it back as "existing text" makes the model reply to its own footer.
// Strip the trailing signature (and the blank lines above it) before sending.
function bodyWithoutSignature(bodyText, signatureHtml) {
  if (!signatureHtml) return bodyText
  const signatureText = htmlToText(signatureHtml).trim()
  if (!signatureText) return bodyText
  const at = bodyText.lastIndexOf(signatureText)
  if (at === -1) return bodyText
  return bodyText.slice(0, at).trimEnd()
}

function followUpSubject(subject) {
  const value = String(subject ?? '').trim()
  if (!value) return ''
  return /^re:/i.test(value) ? value : `Re: ${value}`
}

// Bounds on the in-memory caches below, so a long-lived tab reading many
// emails or asking many questions doesn't grow these without limit. Same
// delete-then-set-to-refresh-recency LRU pattern as embedTextCached
// (api/_lib/embeddings.js).
const MAX_CACHED_MESSAGE_BODIES = 100
const MAX_CACHED_SUMMARIES = 100
const MAX_CHAT_HISTORY = 200

function cacheSet(map, key, value, maxSize) {
  map.delete(key)
  map.set(key, value)
  if (map.size > maxSize) {
    map.delete(map.keys().next().value)
  }
}

function pushCapped(array, item, maxSize) {
  array.push(item)
  if (array.length > maxSize) array.splice(0, array.length - maxSize)
}

// In-flight body fetches by message id. Lives outside the store because
// promises don't belong in reactive state; entries remove themselves on
// settle, so the map only ever holds requests that are actually in flight.
const pendingBodyFetches = new Map()

// Serializes toggleStar/setUnread's PATCH requests per message id so two
// rapid toggles reach the server in click order instead of racing - without
// this, a network reordering could leave the server holding the *first*
// click's value even though the UI (and the user's actual intent) reflects
// the second. Each map holds the tail of that message's update chain.
const pendingStarUpdates = new Map()
const pendingUnreadUpdates = new Map()

// @param {Map<string, Promise<unknown>>} pending
// @param {string} id
// @param {() => Promise<unknown>} run
function serializePerMessage(pending, id, run) {
  const chained = (pending.get(id) ?? Promise.resolve()).catch(() => {}).then(run)
  pending.set(id, chained)
  chained.finally(() => {
    if (pending.get(id) === chained) pending.delete(id)
  })
  return chained
}

function captureListPositions(email, lists) {
  return lists.map((list) => ({ list, index: list.indexOf(email) }))
}

function removeFromCapturedLists(email, positions) {
  for (const { list } of positions) {
    const index = list.indexOf(email)
    if (index > -1) list.splice(index, 1)
  }
}

function restoreCapturedLists(email, positions) {
  for (const { list, index } of positions) {
    if (index > -1 && !list.includes(email)) {
      list.splice(Math.min(index, list.length), 0, email)
    }
  }
}

function reversibleMessageUpdate(
  store,
  { email, apply, restore, changes, undoChanges, message, errorMessage, shouldNotify },
) {
  let undoRequested = false
  let toastId = null
  apply()

  const persistence = store
    .updateMessage(email.id, changes)
    .then(() => true)
    .catch((error) => {
      console.error(errorMessage, error)
      if (!undoRequested) {
        restore()
        if (toastId !== null) store.dismissToast(toastId)
        store.notify(errorMessage, 'error')
      }
      return false
    })

  const undo = async () => {
    if (undoRequested) return
    undoRequested = true
    restore()
    if (!(await persistence)) return

    try {
      await store.updateMessage(email.id, undoChanges)
    } catch (error) {
      console.error('Failed to undo email action:', error)
      apply()
      store.notify('Failed to undo email action.', 'error')
    }
  }

  if (shouldNotify) {
    toastId = store.notify(message, 'info', { label: 'Undo', run: undo })
  }

  return { persistence, undo }
}

// Hoisted formatter instances: toLocale* constructs a formatter internally on
// every call, and formatEmailDate runs once per row on every inbox load and
// realtime refresh.
const EMAIL_TIME_FMT = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })
const EMAIL_DAY_FMT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' })

// "3:54 pm" for today, "5 Jul" for anything older — Notion Mail style.
export function formatEmailDate(isoString) {
  const sentAt = new Date(isoString)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (sentAt >= startOfToday) {
    return EMAIL_TIME_FMT.format(sentAt).toLowerCase().replace(/\s/g, ' ')
  }
  return EMAIL_DAY_FMT.format(sentAt)
}

const PAGE_SIZE = 50
// The Done archive pages at up to 100 emails (the API's MAX_LIMIT); a page
// ends on a whole calendar day, so it usually shows slightly fewer.
const DONE_PAGE_SIZE = 100

// Local calendar day of a timestamp. Done-page trimming and the view's day
// groups must agree on this definition of "day".
export function localDayKey(sentAt) {
  const date = new Date(sentAt)
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

// State keys for each server-backed folder list (?folder=). The inbox list
// has its own loader: it additionally tracks the unread count, userId, and
// search interplay. Folders without consumers of a "loaded" flag omit it.
const FOLDER_STATE = {
  sent: {
    list: 'sentEmails',
    cursor: 'sentCursor',
    hasMore: 'hasMoreSent',
    loaded: 'isSentLoaded',
    refreshing: 'isSentRefreshing',
    label: 'sent emails',
  },
  spam: {
    list: 'spamEmails',
    cursor: 'spamCursor',
    hasMore: 'hasMoreSpam',
    loaded: null,
    refreshing: 'isSpamRefreshing',
    label: 'spam',
  },
  snoozed: {
    list: 'snoozedEmails',
    cursor: 'snoozedCursor',
    hasMore: 'hasMoreSnoozed',
    loaded: 'isSnoozedLoaded',
    refreshing: 'isSnoozedRefreshing',
    label: 'snoozed emails',
  },
}

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
    readAt: null,
    readCount: 0,
    // Whether the message has an HTML body (cheap boolean from the list
    // endpoint). Lets the reader show a spinner during the on-demand body fetch
    // instead of flashing the plain-text fallback before the iframe swaps in.
    hasHtml: Boolean(message.has_html),
    // List endpoints expose only summary presence, never the generated text.
    hasAiSummary: Boolean(message.has_ai_summary),
    hasAttachments: Boolean(message.has_attachments),
    labels: message.labels || [],
  }
}

export const useInboxStore = defineStore('inbox', {
  state: () => ({
    traditionalEmails: [],
    unreadInboxCount: 0,
    userId: null, // the authenticated user's uuid, for the Realtime inbox-ping channel
    isInboxStateLoaded: false,
    isInboxLoaded: false,
    isRefreshing: false,
    activeSearchQuery: '',
    // Guards every async operation that populates traditionalEmails
    // (loadEmails, loadMoreEmails, searchEmails) against out-of-order
    // responses: only the response whose seq still matches listSeq at
    // resolution time may apply. Whichever of those started last wins,
    // regardless of which resolves first.
    listSeq: 0,
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
    // Done archive pager (page replacement, not append): the cursor used to
    // fetch page N lives at donePageCursors[N] (null for page 0), so Newer
    // simply refetches with the earlier cursor.
    doneEmails: [],
    donePageCursors: [null],
    donePageIndex: 0,
    doneHasNext: false,
    isDoneLoaded: false,
    isDoneRefreshing: false,
    labels: [], // full palette from /api/labels (settings Labels manager)
    rules: [], // tag rules from /api/labels?resource=rules (settings Rules manager)

    // Chat state
    chatHistory: [],
    isChatDrawerActive: false,
    isChatLoading: false,

    // Composer state
    isComposerActive: false,
    isSendingEmail: false,
    composerTo: '',
    composerSubject: '',
    composerTextArea: '', // plain-text body (innerText of the rich editor)
    composerHtml: '', // rich HTML body from the WYSIWYG editor
    composerReplyToMessageId: null,

    // Personal email signature (rich HTML), edited in settings and appended to
    // new emails. Persisted locally.
    signatureHtml: getStoredSignature(),
    snippets: getStoredSnippets(),
    isAiDraftActive: false,
    isAiDraftLoading: false,
    aiDraftPreview: '',
    composerAiInstruction: '',
    followUpDraftTaskId: null,

    // Undo-send countdown: null when idle, else { to, subject, text,
    // secondsLeft, paused } while a queued send is counting down.
    pendingSend: null,

    // "Send Later" queue (?resource=scheduled), loaded lazily when the
    // Scheduled view opens. A Cloudflare Worker cron flushes due rows
    // server-side; the client only ever lists/cancels them.
    scheduledSends: [],
    isScheduledSendsLoaded: false,

    // Compose auto-suggest: [{ address, name }] of mailbox correspondents,
    // loaded lazily on first composer open.
    contacts: [],
    contactsLoaded: false,

    // AI dashboard "Needs attention" tasks (Todoist + email action items),
    // loaded lazily when the AI view opens.
    tasks: [],
    tasksLoaded: false,

    // AI Today's three-tier email triage: Reply Needed and Review groups plus
    // summarized Noise, or null. The legacy API field name remains `digest`.
    digest: null,

    // AI Today's news round-up, { created_at, sections } or null. Also
    // arrives with tasks.
    news: null,

    // Personalisation topics for AI Today's news section, edited in settings.
    // Server-side (users.prefs) rather than localStorage, because the enricher
    // Worker reads them overnight with no browser running.
    interests: [],
    interestsLoaded: false,

    // Toast notifications
    toasts: [],
    nextToastId: 1,

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
    // Bumped by the command palette's "Create Event" command; CalendarView
    // watches it to open its New Event dialog without the two views needing
    // a direct reference to each other.
    calendarNewEventRequestId: 0,
    calendarNewEventDraft: null,
  }),

  getters: {
    // Every user-defined label from the /api/labels palette (the same source
    // as the settings Labels manager), so the sidebar lists all of them — not
    // only those that happen to appear on a currently-loaded email. Requires
    // loadLabels() to have run (called at app boot and when settings opens).
    allLabels(state) {
      return state.labels
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
    openEmailText(state) {
      const cached = state.openEmailId ? state.messageBodies.get(state.openEmailId) : null
      return cached?.text ?? this.openEmail?.body ?? this.openEmail?.snippet ?? ''
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
    // The open email's other conversation messages (oldest first), excluding
    // itself — empty until the body fetch lands, or when it is the thread's
    // only message. Drives the reader's collapsed conversation history.
    openEmailThread(state) {
      const cached = state.openEmailId ? state.messageBodies.get(state.openEmailId) : null
      return (cached?.thread ?? []).filter((message) => message.id !== state.openEmailId)
    },
    // The open email's attachment metadata. Private Blob URLs remain server-side;
    // downloadable tells the reader whether it can request a short-lived URL.
    openEmailAttachments(state) {
      const cached = state.openEmailId ? state.messageBodies.get(state.openEmailId) : null
      return cached?.attachments ?? []
    },
  },

  actions: {
    requestCalendarNewEvent(draft = null) {
      this.calendarNewEventDraft = draft
      this.calendarNewEventRequestId++
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

    // Fetches one keyset page of a list. Throws on a non-2xx response so the
    // callers' catch blocks handle notification.
    async fetchEmailPage({ folder, before, limit = PAGE_SIZE } = {}) {
      const headers = await this.authHeaders()
      const params = new URLSearchParams()
      if (folder) params.set('folder', folder)
      params.set('limit', limit)
      if (before) params.set('before', before)
      const response = await fetch(`/api/emails?${params}`, { headers })
      if (!response.ok) {
        throw new Error(`GET /api/emails responded ${response.status}`)
      }
      return response.json()
    },

    async loadInboxState({ force = false } = {}) {
      if (this.isInboxStateLoaded && !force) return
      try {
        const headers = await this.authHeaders()
        const response = await fetch('/api/emails?resource=state', { headers })
        if (!response.ok) throw new Error(`GET inbox state responded ${response.status}`)
        const { unreadCount, userId } = await response.json()
        this.unreadInboxCount = Number.isFinite(unreadCount) ? unreadCount : 0
        if (userId) this.userId = userId
        this.isInboxStateLoaded = true
      } catch (error) {
        console.error('Failed to load inbox state:', error)
        this.notify('Failed to load inbox state.', 'error')
      }
    },

    // listSeq-guarded: a search started (and resolved) while this fetch was
    // in flight must not have its stale inbox page overwrite the search
    // results still being displayed. See the listSeq state comment.
    async loadEmails() {
      const seq = ++this.listSeq
      this.isRefreshing = true
      try {
        const { emails, nextCursor, unreadCount, userId } = await this.fetchEmailPage()
        if (seq !== this.listSeq) return
        this.traditionalEmails = emails.map(mapEmailRow)
        this.emailsCursor = nextCursor ?? null
        this.hasMoreEmails = Boolean(nextCursor)
        this.unreadInboxCount = Number.isFinite(unreadCount)
          ? unreadCount
          : this.traditionalEmails.filter((e) => e.unread).length
        if (userId) this.userId = userId
        this.isInboxStateLoaded = true
        this.isInboxLoaded = true
      } catch (error) {
        if (seq !== this.listSeq) return
        console.error('Failed to load inbox:', error)
        this.notify('Failed to load inbox.', 'error')
      } finally {
        if (seq === this.listSeq) this.isRefreshing = false
      }
    },

    // Appends the next keyset page. No-op while a load is already running,
    // when there is no further page, or while search results are displayed.
    // listSeq-guarded like loadEmails: a search that starts and resolves
    // while this page fetch is in flight must not have a stale page appended
    // after it.
    async loadMoreEmails() {
      if (!this.emailsCursor || this.isRefreshing || this.activeSearchQuery) return
      const seq = ++this.listSeq
      this.isRefreshing = true
      try {
        const { emails, nextCursor } = await this.fetchEmailPage({ before: this.emailsCursor })
        if (seq !== this.listSeq) return
        this.traditionalEmails.push(...emails.map(mapEmailRow))
        this.emailsCursor = nextCursor ?? null
        this.hasMoreEmails = Boolean(nextCursor)
      } catch (error) {
        if (seq !== this.listSeq) return
        console.error('Failed to load more emails:', error)
        this.notify('Failed to load more emails.', 'error')
      } finally {
        if (seq === this.listSeq) this.isRefreshing = false
      }
    },

    refreshInbox() {
      return this.isInboxLoaded ? this.loadEmails() : this.loadInboxState({ force: true })
    },

    // Loads (or reloads) a server-backed folder list; see FOLDER_STATE.
    async loadFolder(folder) {
      const keys = FOLDER_STATE[folder]
      this[keys.refreshing] = true
      try {
        const { emails, nextCursor, readReceiptsAvailable } = await this.fetchEmailPage({ folder })
        this[keys.list] = emails.map(mapEmailRow)
        if (folder === 'sent' && readReceiptsAvailable) {
          await this.loadReadReceipts(this[keys.list])
        }
        this[keys.cursor] = nextCursor ?? null
        this[keys.hasMore] = Boolean(nextCursor)
        if (keys.loaded) this[keys.loaded] = true
      } catch (error) {
        console.error(`Failed to load ${keys.label}:`, error)
        this.notify(`Failed to load ${keys.label}.`, 'error')
      } finally {
        this[keys.refreshing] = false
      }
    },

    // Appends the folder's next keyset page. No-op while a load is already
    // running or when there is no further page.
    async loadMoreFolder(folder) {
      const keys = FOLDER_STATE[folder]
      if (!this[keys.cursor] || this[keys.refreshing]) return
      this[keys.refreshing] = true
      try {
        const { emails, nextCursor, readReceiptsAvailable } = await this.fetchEmailPage({
          folder,
          before: this[keys.cursor],
        })
        const nextEmails = emails.map(mapEmailRow)
        if (folder === 'sent' && readReceiptsAvailable) {
          await this.loadReadReceipts(nextEmails)
        }
        this[keys.list].push(...nextEmails)
        this[keys.cursor] = nextCursor ?? null
        this[keys.hasMore] = Boolean(nextCursor)
      } catch (error) {
        console.error(`Failed to load more ${keys.label}:`, error)
        this.notify(`Failed to load more ${keys.label}.`, 'error')
      } finally {
        this[keys.refreshing] = false
      }
    },

    loadSentEmails() {
      return this.loadFolder('sent')
    },
    loadMoreSentEmails() {
      return this.loadMoreFolder('sent')
    },

    async loadReadReceipts(emails) {
      if (!emails.length) return
      try {
        const headers = await this.authHeaders()
        const ids = emails.map((email) => email.id).join(',')
        const response = await fetch(`/api/read-receipts?messageIds=${encodeURIComponent(ids)}`, {
          headers,
        })
        if (!response.ok) throw new Error(`GET /api/read-receipts responded ${response.status}`)
        const { receipts } = await response.json()
        const byMessage = new Map(receipts.map((receipt) => [receipt.message_id, receipt]))
        for (const email of emails) {
          const receipt = byMessage.get(email.id)
          email.readAt = receipt?.first_opened_at ?? null
          email.readCount = receipt?.open_count ?? 0
        }
      } catch (error) {
        // Receipt status is advisory; never make Sent unusable when it fails.
        console.error('Failed to load read receipts:', error)
      }
    },
    loadSpamEmails() {
      return this.loadFolder('spam')
    },
    loadMoreSpamEmails() {
      return this.loadMoreFolder('spam')
    },
    loadSnoozedEmails() {
      return this.loadFolder('snoozed')
    },
    loadMoreSnoozedEmails() {
      return this.loadMoreFolder('snoozed')
    },

    // Loads one page of the Done archive (page replacement — the view offers
    // Newer/Older instead of the other folders' append-style Load more).
    // A page holds up to DONE_PAGE_SIZE emails but always ends on a whole
    // calendar day: when the server has more rows, the trailing day may
    // continue there, so it is held back for the next page — unless the whole
    // page is one oversized day, where the size cap wins over the invariant.
    async loadDonePage(pageIndex = 0) {
      const cursor = this.donePageCursors[pageIndex] ?? null
      this.isDoneRefreshing = true
      try {
        const { emails, nextCursor } = await this.fetchEmailPage({
          folder: 'done',
          before: cursor ?? undefined,
          limit: DONE_PAGE_SIZE,
        })
        let page = emails.map(mapEmailRow)
        if (nextCursor && page.length > 0) {
          const lastDay = localDayKey(page[page.length - 1].sentAt)
          const firstOfLastDay = page.findIndex((email) => localDayKey(email.sentAt) === lastDay)
          if (firstOfLastDay > 0) page = page.slice(0, firstOfLastDay)
        }
        this.doneEmails = page
        this.donePageIndex = pageIndex
        this.isDoneLoaded = true
        const last = page[page.length - 1]
        this.doneHasNext = Boolean(nextCursor && last)
        this.donePageCursors[pageIndex + 1] = this.doneHasNext ? `${last.sentAt}|${last.id}` : null
      } catch (error) {
        console.error('Failed to load done emails:', error)
        this.notify('Failed to load done emails.', 'error')
      } finally {
        this.isDoneRefreshing = false
      }
    },

    nextDonePage() {
      if (!this.doneHasNext || this.isDoneRefreshing) return
      return this.loadDonePage(this.donePageIndex + 1)
    },

    prevDonePage() {
      if (this.donePageIndex === 0 || this.isDoneRefreshing) return
      return this.loadDonePage(this.donePageIndex - 1)
    },

    async loadLabels() {
      try {
        const headers = await this.authHeaders()
        const response = await fetch(`${LABELS_API_URL}/labels`, { headers })
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

    // Apply or remove a palette label on a message from the reader's tag menu.
    // The applied state is derived from the message's own labels (which carry
    // name/color/kind, not id), so the toggle direction is decided by name. The
    // server returns the message's full label set; we write it back onto the
    // email object so the reader pills and any label-filtered view stay in sync.
    async toggleMessageLabel(email, label) {
      if (!email || !label) return
      const applied = (email.labels || []).some((l) => l.name === label.name)
      const action = applied ? 'remove_label' : 'add_label'
      try {
        const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
        const response = await fetch(`${MESSAGES_API_URL}/messages`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ id: email.id, action, label_id: label.id }),
        })
        if (!response.ok) throw new Error(`POST /api/messages responded ${response.status}`)
        const { labels } = await response.json()
        email.labels = labels
      } catch (error) {
        console.error('Failed to update message labels:', error)
        this.notify('Failed to update tags.', 'error')
      }
    },

    // Returns true on success so the settings form knows to reset.
    async createLabel({ name, color, description }) {
      try {
        const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
        const response = await fetch(`${LABELS_API_URL}/labels`, {
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
        const response = await fetch(`${LABELS_API_URL}/labels`, {
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
        const response = await fetch(`${LABELS_API_URL}/labels`, {
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
        const response = await fetch(`${LABELS_API_URL}/labels`, {
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

    async loadRules() {
      try {
        const headers = await this.authHeaders()
        const response = await fetch(`${LABELS_API_URL}/labels/rules`, { headers })
        if (!response.ok) {
          throw new Error(`GET /api/labels?resource=rules responded ${response.status}`)
        }
        const { rules } = await response.json()
        this.rules = rules
      } catch (error) {
        console.error('Failed to load rules:', error)
        this.notify('Failed to load tag rules.', 'error')
      }
    },

    // Returns the created rule on success (so the settings form knows to reset), or null.
    // `newRule` uses API shape directly: { name, action, label_id, match_type, conditions }.
    async createRule(newRule) {
      try {
        const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
        const response = await fetch(`${LABELS_API_URL}/labels/rules`, {
          method: 'POST',
          headers,
          body: JSON.stringify(newRule),
        })
        if (!response.ok) {
          throw new Error(`POST /api/labels?resource=rules responded ${response.status}`)
        }
        const { rule } = await response.json()
        this.rules = [...this.rules, rule]
        this.notify('Rule created.')
        return rule
      } catch (error) {
        console.error('Failed to create rule:', error)
        this.notify('Failed to create rule.', 'error')
        return null
      }
    },

    // `changes` uses API shape directly, e.g. { enabled: false } or { conditions: [...] }.
    async updateRule(rule, changes) {
      const previous = { ...rule }
      Object.assign(rule, changes)
      try {
        const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
        const response = await fetch(`${LABELS_API_URL}/labels/rules`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ id: rule.id, ...changes }),
        })
        if (!response.ok) throw new Error(`PATCH /api/labels?resource=rules responded ${response.status}`)
        const { rule: updatedRule } = await response.json()
        Object.assign(rule, updatedRule)
        return true
      } catch (error) {
        Object.assign(rule, previous)
        console.error('Failed to update rule:', error)
        this.notify('Failed to update rule.', 'error')
        return false
      }
    },

    async deleteRule(id) {
      try {
        const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
        const response = await fetch(`${LABELS_API_URL}/labels/rules`, {
          method: 'DELETE',
          headers,
          body: JSON.stringify({ id }),
        })
        if (!response.ok) {
          throw new Error(`DELETE /api/labels?resource=rules responded ${response.status}`)
        }
        this.rules = this.rules.filter((rule) => rule.id !== id)
        this.notify('Rule deleted.')
      } catch (error) {
        console.error('Failed to delete rule:', error)
        this.notify('Failed to delete rule.', 'error')
      }
    },

    // Search results replace the inbox list until clearSearch() restores it.
    // Abort superseded requests to stop their database/embedding work where
    // the runtime supports request cancellation; listSeq remains the response
    // ordering backstop.
    async searchEmails(query, { semantic = true } = {}) {
      const q = query.trim()
      if (!q) return
      searchAbortController?.abort()
      const controller = new AbortController()
      searchAbortController = controller
      const seq = ++this.listSeq
      this.isRefreshing = true
      try {
        const headers = await this.authHeaders()
        const mode = semantic ? '' : '&mode=keyword'
        const response = await fetch(`/api/search?q=${encodeURIComponent(q)}${mode}`, {
          headers,
          signal: controller.signal,
        })
        if (!response.ok) {
          throw new Error(`GET /api/search responded ${response.status}`)
        }
        const { emails } = await response.json()
        if (seq !== this.listSeq) return
        this.activeSearchQuery = q
        this.traditionalEmails = emails.map(mapEmailRow)
      } catch (error) {
        if (seq !== this.listSeq) return
        if (error?.name === 'AbortError') return
        console.error('Search failed:', error)
        this.notify('Search failed. Please try again.', 'error')
      } finally {
        if (searchAbortController === controller) searchAbortController = null
        if (seq === this.listSeq) {
          this.isRefreshing = false
        }
      }
    },

    // Invalidates an in-flight search without changing the currently displayed
    // results. Used when the same header input is submitted to mailbox Q&A.
    cancelPendingSearch() {
      searchAbortController?.abort()
      searchAbortController = null
      this.listSeq++
      this.isRefreshing = false
    },

    // Leaves search mode and reloads the full inbox. Bumping listSeq also
    // invalidates any search or load still in flight.
    clearSearch() {
      const hadActiveSearch = Boolean(this.activeSearchQuery)
      searchAbortController?.abort()
      searchAbortController = null
      this.listSeq++
      this.activeSearchQuery = ''
      this.isRefreshing = false
      if (hadActiveSearch) return this.loadEmails()
    },

    async updateMessage(id, changes) {
      const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
      const response = await fetch(`${MESSAGES_API_URL}/messages`, {
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
      // Both openReader and the view's openEmailId watcher request the body in
      // the same tick, and the cache only fills on resolve — share the
      // in-flight request instead of fetching the heaviest payload twice.
      const pending = pendingBodyFetches.get(id)
      if (pending) return pending
      const request = this.fetchMessageBodyUncached(id).finally(() => {
        pendingBodyFetches.delete(id)
      })
      pendingBodyFetches.set(id, request)
      return request
    },

    async fetchMessageBodyUncached(id) {
      // Only flag loading for an actual fetch — cache hits return early in
      // fetchMessageBody so reopening a message never spins.
      this.bodyLoadingId = id
      // Only an HTML body ever shows the spinner (EmailBody.vue) — a text-only
      // message renders instantly from the list's own body_text, so there's
      // nothing to hold up for it.
      const willShowSpinner = this.openEmail?.hasHtml === true
      const startedAt = Date.now()
      try {
        const headers = await this.authHeaders()
        const response = await fetch(`${MESSAGES_API_URL}/messages?id=${encodeURIComponent(id)}`, { headers })
        if (!response.ok) {
          throw new Error(`GET /api/messages responded ${response.status}`)
        }
        const { body_html, body_text, unsubscribe, summary, thread, attachments } = await response.json()
        const body = {
          html: body_html ?? null,
          text: body_text ?? null,
          unsubscribe: unsubscribe ?? null,
          thread: Array.isArray(thread) ? thread : [],
          attachments: Array.isArray(attachments) ? attachments : [],
        }
        if (willShowSpinner) {
          const elapsed = Date.now() - startedAt
          if (elapsed < MIN_BODY_LOADING_MS) {
            await new Promise((resolve) => setTimeout(resolve, MIN_BODY_LOADING_MS - elapsed))
          }
        }
        cacheSet(this.messageBodies, id, body, MAX_CACHED_MESSAGE_BODIES)
        const summaryText = String(summary ?? '').trim()
        if (summaryText) {
          cacheSet(this.messageSummaries, id, summaryText, MAX_CACHED_SUMMARIES)
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

    async fetchThreadMessageBody(message) {
      if (!message || Object.hasOwn(message, 'body_text')) return message?.body_text ?? null
      try {
        const headers = await this.authHeaders()
        const response = await fetch(
          `${MESSAGES_API_URL}/messages/thread-body?id=${encodeURIComponent(message.id)}`,
          { headers },
        )
        if (!response.ok) throw new Error(`GET thread body responded ${response.status}`)
        const { body_text } = await response.json()
        message.body_text = body_text ?? ''
        return message.body_text
      } catch (error) {
        console.error('Failed to load thread message body:', error)
        message.body_text = ''
        return null
      }
    },

    async downloadAttachment(attachment) {
      if (!attachment?.id || !attachment.downloadable) return false
      try {
        const headers = await this.authHeaders()
        const response = await fetch(
          `${MESSAGES_API_URL}/messages/attachment?id=${encodeURIComponent(attachment.id)}`,
          { headers },
        )
        if (!response.ok) {
          throw new Error(`GET attachment endpoint responded ${response.status}`)
        }
        const { url: rawUrl, filename } = await response.json()
        const url = String(rawUrl ?? '')
        if (!url) throw new Error('Attachment URL is missing')

        const link = document.createElement('a')
        link.href = url
        link.download = filename || attachment.filename || 'attachment'
        link.rel = 'noopener'
        document.body.append(link)
        link.click()
        link.remove()
        return true
      } catch (error) {
        console.error('Failed to download attachment:', error)
        this.notify('Failed to download attachment.', 'error')
        return false
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
        const normalized = String(summary ?? '').trim()
        if (!normalized) {
          throw new Error('POST /api/summarize returned an invalid summary')
        }
        cacheSet(this.messageSummaries, id, normalized, MAX_CACHED_SUMMARIES)
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
        const response = await fetch(`${MESSAGES_API_URL}/messages`, {
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
          if (cached) {
            cacheSet(this.messageBodies, email.id, { ...cached, unsubscribed: true }, MAX_CACHED_MESSAGE_BODIES)
          }
          this.notify(`Unsubscribed from ${email.sender}.`)
        } else if (result.status === 'manual' && isSafeUnsubscribeUrl(result.url)) {
          window.open(result.url, '_blank', 'noopener')
          this.notify('Finish unsubscribing on the page that just opened.')
        } else if (
          result.status === 'manual' &&
          String(result.mailto ?? '').startsWith('mailto:')
        ) {
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
    // PATCHes are serialized per message (see pendingStarUpdates) so two rapid
    // toggles can't reach the server out of click order.
    toggleStar(email) {
      const nextStarred = !email.starred
      email.starred = nextStarred
      serializePerMessage(pendingStarUpdates, email.id, () =>
        this.updateMessage(email.id, { is_starred: nextStarred }).catch((error) => {
          console.error('Failed to update starred state:', error)
          // Only revert if a later toggle hasn't already moved past this one.
          if (email.starred === nextStarred) email.starred = !nextStarred
          this.notify('Failed to update starred state.', 'error')
        }),
      )
    },

    // Moves an inbox message out of sight until its scheduled time. Future
    // messages live in the Snoozed folder; the inbox API returns them again
    // once due, when the view places them in the Due Today group.
    async scheduleEmail(email, scheduledFor, label, shouldNotify = true, undoActions = null) {
      if (!email) return false
      const inboxIndex = this.traditionalEmails.indexOf(email)
      const snoozedIndex = this.snoozedEmails.indexOf(email)
      const previousScheduledFor = email.scheduledFor
      const wasUnreadInbox = inboxIndex > -1 && email.unread
      let applied = false

      const apply = () => {
        if (applied) return
        applied = true
        email.scheduledFor = scheduledFor
        if (inboxIndex > -1) {
          const currentIndex = this.traditionalEmails.indexOf(email)
          if (currentIndex > -1) this.traditionalEmails.splice(currentIndex, 1)
        }
        if (this.openEmailId === email.id) this.openEmailId = null
        if (wasUnreadInbox) this.unreadInboxCount = Math.max(0, this.unreadInboxCount - 1)
        if (this.isSnoozedLoaded && snoozedIndex === -1 && !this.snoozedEmails.includes(email)) {
          this.snoozedEmails.unshift(email)
        }
      }
      const restore = () => {
        if (!applied) return
        applied = false
        email.scheduledFor = previousScheduledFor
        if (inboxIndex > -1 && !this.traditionalEmails.includes(email)) {
          this.traditionalEmails.splice(Math.min(inboxIndex, this.traditionalEmails.length), 0, email)
        }
        if (snoozedIndex === -1) {
          const currentIndex = this.snoozedEmails.indexOf(email)
          if (currentIndex > -1) this.snoozedEmails.splice(currentIndex, 1)
        }
        if (wasUnreadInbox) this.unreadInboxCount++
      }

      const { persistence, undo } = reversibleMessageUpdate(this, {
        email,
        apply,
        restore,
        changes: { scheduled_for: scheduledFor },
        undoChanges: { scheduled_for: previousScheduledFor },
        message: `Scheduled for ${label}.`,
        errorMessage: 'Failed to schedule email.',
        shouldNotify,
      })
      const success = await persistence
      if (success && undoActions) undoActions.push(undo)
      return success
    },

    // Optimistically removes the email from the list (closing the reader if
    // it was open) and persists the archive flag.
    archiveEmail(email, shouldNotify = true, undoActions = null) {
      if (!email) return null
      const positions = captureListPositions(email, [
        this.traditionalEmails,
        this.snoozedEmails,
        this.spamEmails,
      ])
      const wasUnread = email.unread
      const wasUnreadInbox = positions[0].index > -1 && wasUnread
      const addToDone =
        this.isDoneLoaded &&
        this.donePageIndex === 0 &&
        !this.doneEmails.some((item) => item.id === email.id)
      let applied = false

      const apply = () => {
        if (applied) return
        applied = true
        removeFromCapturedLists(email, positions)
        email.unread = false
        if (this.openEmailId === email.id) this.openEmailId = null
        if (wasUnreadInbox) this.unreadInboxCount = Math.max(0, this.unreadInboxCount - 1)
        if (addToDone && !this.doneEmails.includes(email)) this.doneEmails.unshift(email)
      }
      const restore = () => {
        if (!applied) return
        applied = false
        restoreCapturedLists(email, positions)
        email.unread = wasUnread
        if (wasUnreadInbox) this.unreadInboxCount++
        if (addToDone) {
          const doneIndex = this.doneEmails.indexOf(email)
          if (doneIndex > -1) this.doneEmails.splice(doneIndex, 1)
        }
      }

      const { undo } = reversibleMessageUpdate(this, {
        email,
        apply,
        restore,
        changes: { is_archived: true, is_unread: false },
        undoChanges: { is_archived: false, is_unread: wasUnread },
        message: 'Marked done.',
        errorMessage: 'Failed to archive email.',
        shouldNotify,
      })
      if (undoActions) undoActions.push(undo)
      return undo
    },

    // Soft-deletes an email: optimistically removes it from every visible
    // list (including Done) and persists the is_deleted flag.
    deleteEmail(email, shouldNotify = true, undoActions = null) {
      if (!email) return null
      const positions = captureListPositions(email, [
        this.traditionalEmails,
        this.snoozedEmails,
        this.spamEmails,
        this.doneEmails,
        this.sentEmails,
      ])
      const wasUnreadInbox = positions[0].index > -1 && email.unread
      let applied = false

      const apply = () => {
        if (applied) return
        applied = true
        removeFromCapturedLists(email, positions)
        if (this.openEmailId === email.id) this.openEmailId = null
        if (wasUnreadInbox) this.unreadInboxCount = Math.max(0, this.unreadInboxCount - 1)
      }
      const restore = () => {
        if (!applied) return
        applied = false
        restoreCapturedLists(email, positions)
        if (wasUnreadInbox) this.unreadInboxCount++
      }

      const { undo } = reversibleMessageUpdate(this, {
        email,
        apply,
        restore,
        changes: { is_deleted: true },
        undoChanges: { is_deleted: false },
        message: 'Deleted.',
        errorMessage: 'Failed to delete email.',
        shouldNotify,
      })
      if (undoActions) undoActions.push(undo)
      return undo
    },

    // Optimistically flips read state and persists it; reverts on failure.
    // The count adjusts incrementally: with pagination (and during search)
    // the loaded list is a subset, so recounting it would be wrong. PATCHes
    // are serialized per message (see pendingUnreadUpdates) so two rapid
    // toggles can't reach the server out of click order.
    setUnread(email, unread) {
      if (email.unread === unread) return
      const countsTowardInbox = this.traditionalEmails.includes(email)
      email.unread = unread
      if (countsTowardInbox) {
        this.unreadInboxCount = Math.max(0, this.unreadInboxCount + (unread ? 1 : -1))
      }
      serializePerMessage(pendingUnreadUpdates, email.id, () =>
        this.updateMessage(email.id, { is_unread: unread }).catch((error) => {
          console.error('Failed to update read state:', error)
          // Only revert if a later toggle hasn't already moved past this one.
          if (email.unread === unread) {
            email.unread = !unread
            if (countsTowardInbox) {
              this.unreadInboxCount = Math.max(0, this.unreadInboxCount + (unread ? -1 : 1))
            }
          }
          this.notify('Failed to update read state.', 'error')
        }),
      )
    },

    notify(message, kind = 'info', action = null) {
      const id = this.nextToastId++
      const toast = { id, message, kind }
      if (action) toast.action = action
      this.toasts.push(toast)
      setTimeout(() => this.dismissToast(id), 4000)
      return id
    },

    dismissToast(id) {
      const index = this.toasts.findIndex((t) => t.id === id)
      if (index > -1) {
        this.toasts.splice(index, 1)
      }
    },

    async runToastAction(id) {
      const toast = this.toasts.find((item) => item.id === id)
      if (!toast?.action) return
      this.dismissToast(id)
      await toast.action.run()
    },

    async undoLatestAction() {
      if (this.pendingSend) {
        this.undoPendingSend()
        return true
      }
      for (let index = this.toasts.length - 1; index >= 0; index--) {
        const toast = this.toasts[index]
        if (!toast.action) continue
        await this.runToastAction(toast.id)
        return true
      }
      return false
    },

    // replyToMessageId (optional) threads the stored sent copy with the
    // message being replied to.
    async sendMail({ to, subject, text, html, replyToMessageId }) {
      const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
      const response = await fetch('/api/send', {
        method: 'POST',
        headers,
        body: JSON.stringify({ to, subject, text, html, replyToMessageId }),
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

    openComposer() {
      this.isComposerActive = true
      // Populate the "to" auto-suggest; cached after the first load.
      this.loadContacts()
      // Pre-fill a fresh compose with the saved signature (blank lines above so
      // the message goes on top). Never clobbers an in-progress draft.
      if (!this.composerHtml && this.signatureHtml) {
        this.composerHtml = `<p><br></p><p><br></p>${this.signatureHtml}`
        this.composerTextArea = htmlToText(this.composerHtml)
      }
    },

    // Saves the personal signature (from the settings WYSIWYG editor). Keeps the
    // in-memory copy identical to the sanitized value that was persisted.
    setSignature(html) {
      this.signatureHtml = saveStoredSignature(html)
    },

    setSnippets(snippets) {
      this.snippets = saveStoredSnippets(snippets)
    },

    async requestAiSnippet(instruction) {
      const prompt = instruction.trim()
      if (!prompt) return null
      try {
        const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
        const response = await fetch('/api/compose', {
          method: 'POST',
          headers,
          body: JSON.stringify({ mode: 'snippet', instruction: prompt }),
        })
        if (!response.ok) throw new Error(`POST /api/compose responded ${response.status}`)
        return (await response.json()).snippet
      } catch (error) {
        console.error('AI snippet generation failed:', error)
        this.notify('AI snippet generation failed. Please try again.', 'error')
        return null
      }
    },

    // Loads the contact list (two-way correspondents) for compose auto-suggest.
    // Best-effort and cached: a failure just leaves auto-suggest empty.
    async loadContacts() {
      if (this.contactsLoaded) return
      try {
        const headers = await this.authHeaders()
        const response = await fetch(`${MESSAGES_API_URL}/messages/contacts`, { headers })
        if (!response.ok) throw new Error(`GET contacts responded ${response.status}`)
        const { contacts } = await response.json()
        this.contacts = contacts
        this.contactsLoaded = true
      } catch (error) {
        console.error('Failed to load contacts:', error)
      }
    },

    // Loads gathered tasks for the AI dashboard. Best-effort and cached: a
    // failure just leaves the "Needs attention" list empty. AI Today's refresh
    // control passes force to re-read past the cache.
    async loadTasks({ force = false } = {}) {
      if (this.tasksLoaded && !force) return
      try {
        const headers = await this.authHeaders()
        const response = await fetch(`${TASKS_API_URL}/tasks`, { headers })
        if (!response.ok) throw new Error(`GET /api/tasks responded ${response.status}`)
        const { tasks, digest, news } = await response.json()
        this.tasks = tasks
        this.digest = digest ?? null
        this.news = news ?? null
        this.tasksLoaded = true
      } catch (error) {
        console.error('Failed to load tasks:', error)
      }
    },

    // Loads the personalisation topics. Best-effort and cached, like
    // loadTasks: a failure leaves the settings list empty rather than blocking
    // the modal.
    async loadInterests() {
      if (this.interestsLoaded) return
      try {
        const headers = await this.authHeaders()
        const response = await fetch(`${TASKS_API_URL}/tasks/interests`, { headers })
        if (!response.ok) throw new Error(`GET interests responded ${response.status}`)
        const { interests } = await response.json()
        this.interests = interests
        this.interestsLoaded = true
      } catch (error) {
        console.error('Failed to load interests:', error)
      }
    },

    // Replaces the stored personalisation topics. Throws on failure so the
    // settings pane can report it; the server's normalized list wins, so the
    // in-memory copy matches what the enricher will actually read.
    async saveInterests(interests) {
      const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
      const response = await fetch(`${TASKS_API_URL}/tasks/interests`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ interests }),
      })
      if (!response.ok) {
        throw new Error(`PUT interests responded ${response.status}`)
      }
      const saved = await response.json()
      this.interests = saved.interests
      this.interestsLoaded = true
      return this.interests
    },

    // Asks the enricher to rebuild AI Today's triage now, then re-reads it.
    // Resolves to false when the deployment has no enricher wired up (501), so
    // the caller can fall back to a plain re-read instead of showing an error.
    // Throws on a real failure.
    async rebuildDigest() {
      const headers = await this.authHeaders()
      const response = await fetch(`${TASKS_API_URL}/tasks/refresh`, { method: 'POST', headers })
      if (response.status === 501) return false
      if (!response.ok) {
        throw new Error(`POST /api/tasks?resource=refresh responded ${response.status}`)
      }
      return true
    },

    // Marks one digest item's message read (no-op if already read), updating
    // both the digest item and the inbox list in place. Goes through
    // updateMessage rather than setUnread because the digest cites messages
    // by id whether or not the inbox list has loaded them. Throws on failure
    // so a caller acting on a single item (e.g. a per-item done checkbox) can
    // roll back its optimistic UI.
    async markTopicItemRead(item) {
      if (!item?.unread) return
      await this.updateMessage(item.message_id, { is_unread: false })
      item.unread = false
      const email = this.traditionalEmails.find((e) => e.id === item.message_id)
      if (email) email.unread = false
      // If the triage item is unread, this is one fewer in the inbox badge.
      this.unreadInboxCount = Math.max(0, this.unreadInboxCount - 1)
    },

    // Marks every still-unread message in one digest topic as read, clearing
    // its dots in place. Settled per message, so one failure does not abandon
    // the rest.
    async markTopicRead(topic) {
      const unread = (topic?.items || []).filter((item) => item.unread)
      if (unread.length === 0) return 0
      const results = await Promise.allSettled(unread.map((item) => this.markTopicItemRead(item)))
      return results.filter((result) => result.status === 'fulfilled').length
    },

    // Marks a gathered task done (POST /api/tasks). Todoist tasks are closed in
    // Todoist server-side. Throws on a non-2xx so the caller can roll back its
    // optimistic UI; on success the task is dropped from the local list.
    async completeTask(id) {
      const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
      const response = await fetch(`${TASKS_API_URL}/tasks`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ id, action: 'complete' }),
      })
      if (!response.ok) {
        throw new Error(`POST /api/tasks responded ${response.status}`)
      }
      this.tasks = this.tasks.filter((t) => t.id !== id)
      return response.json()
    },

    // Reschedules a gathered task to another day (POST /api/tasks). Todoist
    // tasks are rescheduled in Todoist server-side first. Throws on a non-2xx
    // so the caller can roll back its optimistic UI; on success the task's
    // due_date is updated in place - whether it should still be visible today
    // is the caller's call, since a reschedule to later today keeps it there.
    async rescheduleTask(id, dueDate) {
      const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
      const response = await fetch(`${TASKS_API_URL}/tasks`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ id, action: 'reschedule', due_date: dueDate }),
      })
      if (!response.ok) {
        throw new Error(`POST /api/tasks responded ${response.status}`)
      }
      const task = this.tasks.find((t) => t.id === id)
      if (task) task.due_date = dueDate
      return response.json()
    },

    // Reschedules a triage item's underlying message so it drops off today's
    // digest and reappears in a later one. Goes through the same lightweight,
    // id-based updateMessage markTopicItemRead uses - digest items carry only
    // a message_id, not a full email object like scheduleEmail expects.
    // Throws on failure so the caller can roll back its optimistic UI.
    async rescheduleDigestItem(item, scheduledFor) {
      await this.updateMessage(item.message_id, { scheduled_for: scheduledFor })
    },

    closeComposer() {
      this.isComposerActive = false
      this.composerTo = ''
      this.composerSubject = ''
      this.composerTextArea = ''
      this.composerHtml = ''
      this.composerReplyToMessageId = null
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

    async requestAiDraft({ replyToMessageId = this.composerReplyToMessageId } = {}) {
      const instruction = this.composerAiInstruction.trim()
      if (!instruction || this.isAiDraftLoading) return
      this.isAiDraftActive = true
      this.isAiDraftLoading = true
      try {
        const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
        const request = {
          instruction,
          to: this.composerTo,
          subject: this.composerSubject,
          existingText: bodyWithoutSignature(this.composerTextArea, this.signatureHtml),
        }
        if (replyToMessageId) request.replyToMessageId = replyToMessageId
        const response = await fetch('/api/compose', {
          method: 'POST',
          headers,
          body: JSON.stringify(request),
        })
        if (!response.ok) throw new Error(`POST /api/compose responded ${response.status}`)
        const { draft } = await response.json()
        this.aiDraftPreview = draft.text
        if (!this.composerSubject.trim() && draft.subject) this.composerSubject = draft.subject
        return true
      } catch (error) {
        console.error('AI compose failed:', error)
        this.notify('AI compose failed. Please try again.', 'error')
        return false
      } finally {
        this.isAiDraftLoading = false
      }
    },

    insertAiDraft() {
      if (!this.aiDraftPreview) return
      const generatedHtml = plainTextToHtml(this.aiDraftPreview)
      this.composerHtml = this.signatureHtml
        ? `${generatedHtml}<p><br></p>${this.signatureHtml}`
        : generatedHtml
      this.composerTextArea = htmlToText(this.composerHtml)
      this.isAiDraftActive = false
    },

    // Generates an editable, review-before-send reply for an email-sourced
    // follow-up task. The owned message id supplies server-side context and is
    // retained so a later send stays in the original thread.
    async draftFollowUp(task) {
      if (!task?.message_id || this.followUpDraftTaskId) return false
      this.followUpDraftTaskId = task.id
      this.composerTo = task.reply_to || ''
      this.composerSubject = followUpSubject(task.message_subject)
      this.composerReplyToMessageId = task.message_id
      this.composerAiInstruction = [
        'Write a concise follow-up email for this action item.',
        task.content,
        task.description,
      ]
        .filter(Boolean)
        .join(' ')
      this.aiDraftPreview = ''
      this.isAiDraftActive = true
      this.isComposerActive = true
      this.loadContacts()

      try {
        const generated = await this.requestAiDraft({ replyToMessageId: task.message_id })
        if (!generated) return false
        this.insertAiDraft()
        return true
      } finally {
        this.followUpDraftTaskId = null
      }
    },

    // Sending is deferred behind a short, cancellable countdown so the user can
    // undo. This snapshots the draft, closes the composer, and hands off to the
    // countdown; the real request happens in commitPendingSend. The guards also
    // stop two rapid clicks from queueing a second send.
    sendEmail() {
      if (this.isSendingEmail || this.pendingSend) return
      if (!recipientsValid(this.composerTo) || !this.composerTextArea.trim()) return
      const draft = {
        to: this.composerTo,
        subject: this.composerSubject,
        text: this.composerTextArea,
        // Sanitize the rich body once, here at the send boundary.
        html: sanitizeEmailHtml(this.composerHtml),
        replyToMessageId: this.composerReplyToMessageId,
      }
      this.closeComposer()
      this.startPendingSend(draft)
    },

    // Counts down UNDO_SEND_SECONDS, then sends. Hovering the toast pauses it
    // (pause/resumePendingSend); the Undo button cancels it (undoPendingSend).
    startPendingSend(draft) {
      this.pendingSend = { ...draft, secondsLeft: UNDO_SEND_SECONDS, paused: false }
      clearInterval(sendCountdownTimer)
      sendCountdownTimer = setInterval(() => {
        if (!this.pendingSend || this.pendingSend.paused) return
        this.pendingSend.secondsLeft -= 1
        if (this.pendingSend.secondsLeft <= 0) this.commitPendingSend()
      }, 1000)
    },

    pausePendingSend() {
      if (this.pendingSend) this.pendingSend.paused = true
    },

    resumePendingSend() {
      if (this.pendingSend) this.pendingSend.paused = false
    },

    // Cancels the queued send and restores the message in the composer so the
    // user can keep editing it — nothing is sent.
    undoPendingSend() {
      if (!this.pendingSend) return
      clearInterval(sendCountdownTimer)
      const { to, subject, text, html, replyToMessageId } = this.pendingSend
      this.pendingSend = null
      this.composerTo = to
      this.composerSubject = subject
      this.composerTextArea = text
      this.composerHtml = html
      this.composerReplyToMessageId = replyToMessageId
      this.isComposerActive = true
    },

    // Fires when the countdown reaches zero: performs the real send. On failure
    // the message is restored in the composer rather than silently lost.
    async commitPendingSend() {
      if (!this.pendingSend) return
      clearInterval(sendCountdownTimer)
      const draft = this.pendingSend
      this.pendingSend = null
      this.isSendingEmail = true
      try {
        await this.sendMail({
          to: draft.to,
          subject: draft.subject,
          text: draft.text,
          html: draft.html,
          replyToMessageId: draft.replyToMessageId,
        })
        this.notify('Email sent.')
      } catch (error) {
        console.error('Failed to send email:', error)
        this.notify('Failed to send email. Please try again.', 'error')
        this.composerTo = draft.to
        this.composerSubject = draft.subject
        this.composerTextArea = draft.text
        this.composerHtml = draft.html
        this.composerReplyToMessageId = draft.replyToMessageId
        this.isComposerActive = true
      } finally {
        this.isSendingEmail = false
      }
    },

    // Composer analog of scheduleEmail (inbound snooze): queues the current
    // draft to go out later instead of now. Validation mirrors sendEmail; the
    // actual delivery happens server-side once scheduled_for is due — see
    // POST /api/send?resource=flush, called on an interval by the
    // scheduled-send-flusher Worker cron in Cookie-Worker.
    async sendEmailLater(sendAt, label) {
      if (this.isSendingEmail || this.pendingSend) return false
      if (!recipientsValid(this.composerTo) || !this.composerTextArea.trim()) return false
      const draft = {
        to: this.composerTo,
        subject: this.composerSubject,
        text: this.composerTextArea,
        html: sanitizeEmailHtml(this.composerHtml),
        replyToMessageId: this.composerReplyToMessageId,
      }
      this.closeComposer()
      try {
        const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
        const response = await fetch('/api/send', {
          method: 'POST',
          headers,
          body: JSON.stringify({ ...draft, sendAt }),
        })
        if (!response.ok) throw new Error(`POST /api/send responded ${response.status}`)
        const { scheduledSend } = await response.json()
        if (this.isScheduledSendsLoaded) this.scheduledSends.unshift(scheduledSend)
        this.notify(`Email scheduled for ${label}.`)
        return true
      } catch (error) {
        console.error('Failed to schedule email:', error)
        this.notify('Failed to schedule email. Please try again.', 'error')
        this.composerTo = draft.to
        this.composerSubject = draft.subject
        this.composerTextArea = draft.text
        this.composerHtml = draft.html
        this.composerReplyToMessageId = draft.replyToMessageId
        this.isComposerActive = true
        return false
      }
    },

    // Loads the user's pending "Send Later" queue for the Scheduled view.
    // Best-effort and cached, like loadContacts/loadTasks.
    async loadScheduledSends() {
      if (this.isScheduledSendsLoaded) return
      try {
        const headers = await this.authHeaders()
        const response = await fetch('/api/send?resource=scheduled', { headers })
        if (!response.ok) throw new Error(`GET scheduled sends responded ${response.status}`)
        const { scheduledSends } = await response.json()
        this.scheduledSends = scheduledSends
        this.isScheduledSendsLoaded = true
      } catch (error) {
        console.error('Failed to load scheduled sends:', error)
      }
    },

    // Cancels a still-pending scheduled send and reopens its content in the
    // composer for further editing — the "Send Later" equivalent of
    // undoPendingSend. Throws if it can no longer be canceled (e.g. it
    // already went out) so the caller can tell the user rather than silently
    // losing the row.
    async cancelScheduledSend(scheduledSend) {
      const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
      const response = await fetch('/api/send?resource=scheduled', {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ id: scheduledSend.id }),
      })
      if (!response.ok) {
        throw new Error(`DELETE scheduled send responded ${response.status}`)
      }
      const { scheduledSend: canceled } = await response.json()
      this.scheduledSends = this.scheduledSends.filter((item) => item.id !== scheduledSend.id)
      this.composerTo = canceled.toAddresses
      this.composerSubject = canceled.subject
      this.composerTextArea = canceled.text
      this.composerHtml = canceled.html || plainTextToHtml(canceled.text)
      this.composerReplyToMessageId = canceled.replyToMessageId
      this.isComposerActive = true
    },

    // Real RAG: /api/ask retrieves the most relevant stored emails via
    // hybrid search and answers with the sources it used.
    async askAssistant(query) {
      this.isChatDrawerActive = true
      pushCapped(this.chatHistory, { text: query, sender: 'user' }, MAX_CHAT_HISTORY)
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
        pushCapped(this.chatHistory, { text: answer, sender: 'ai', sources: sources || [] }, MAX_CHAT_HISTORY)
      } catch (error) {
        console.error('Ask failed:', error)
        pushCapped(
          this.chatHistory,
          {
            text: "Sorry, I couldn't reach the assistant. Please try again.",
            sender: 'ai',
            sources: [],
          },
          MAX_CHAT_HISTORY,
        )
      } finally {
        this.isChatLoading = false
      }
    },
  },
})
