import { startTiming } from '../lib/performance'
import { sendMail } from '../lib/mailSending'
import { defineStore } from 'pinia'
import { parseAutoArchive } from '../lib/autoArchive'
import { defaultEnrichmentSettings, parseEnrichmentSettings } from '../lib/enrichmentSettings'

import { authHeaders as buildAuthHeaders } from '../lib/authHeaders'
import { MAX_ATTACHMENTS, uploadAttachment } from '../lib/attachmentUpload'
import {
  AI_API_URL,
  DRAFTS_API_URL,
  EMAILS_API_URL,
  SEARCH_API_URL,
  LABELS_API_URL,
  MESSAGES_API_URL,
  NOTIFICATIONS_API_URL,
  RECEIPTS_API_URL,
  TASKS_API_URL,
} from '../lib/apiWorkers'
import { localToday } from '../lib/localDate'
import { recipientsValid } from '../lib/recipients'
import { isSafeUnsubscribeUrl } from '../lib/isSafeUnsubscribeUrl'
import { parseMailto } from '../lib/unsubscribeContent'
import { sanitizeEmailHtml } from '../lib/sanitizeEmailHtml'
import { plainTextToHtml, htmlToText } from '../lib/composeHtml'

// Inbox tab ids. Important and Other are fixed; other categories get their own.
// Category ids are stable across renames and cannot collide with fixed tabs.
export const PRIORITY_TAB = 'priority'
export const OTHER_TAB = 'other'
export const inboxTabForCategory = (id) => `category:${id}`
export const isImportantCategory = (category) =>
  category?.name?.trim().toLowerCase() === 'important'
import { convertEmojiInHtml, convertEmojiToEmoticons } from '../lib/emoticons'
import { getStoredSignature, saveStoredSignature } from '../lib/signature'
import { getStoredSnippets, saveStoredSnippets } from '../lib/snippets'

// Undo-send: the message waits this many (cancellable) seconds before it is
// actually sent. sendCountdownTimer is the interval driving that countdown; it
// lives at module scope so it stays out of reactive state.
const UNDO_SEND_SECONDS = 5
let sendCountdownTimer = null
let searchAbortController = null
let askAbortController = null
let askSeq = 0

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

function normalizeOutgoingDraft(draft) {
  return {
    ...draft,
    subject: convertEmojiToEmoticons(draft.subject),
    text: convertEmojiToEmoticons(draft.text),
    html: convertEmojiInHtml(sanitizeEmailHtml(draft.html)),
  }
}

// Bounds on the in-memory caches below, so a long-lived tab reading many
// emails or asking many questions doesn't grow these without limit.
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
const pendingInviteFetches = new Map()

// Serializes toggleStar/setUnread's PATCH requests per message id so two
// rapid toggles reach the server in click order instead of racing - without
// this, a network reordering could leave the server holding the *first*
// click's value even though the UI (and the user's actual intent) reflects
// the second. Each map holds the tail of that message's update chain.
const pendingStarUpdates = new Map()
const pendingUnreadUpdates = new Map()

// Inbox rows removed optimistically (Done, Report spam, Snooze) whose PATCH
// may not have landed when an inbox page was requested. Such a page still
// lists the row, and mergeInboxPage would put it straight back (it adds any
// incoming id it does not hold), so the row would linger until a reload.
// Each removal is logged here and dropped from every page whose fetch began
// before the server confirmed it; see dropPendingRemovals.
let inboxRemovalSeq = 0
const inboxRemovals = new Map() // id -> { settledSeq: number | null }

// @param {string} id
// @param {Promise<unknown>} persistence resolves false (or rejects) when the
//   change did not land, in which case the row belongs in the list again.
function trackInboxRemoval(id, persistence) {
  inboxRemovals.set(id, { settledSeq: null })
  persistence.then(
    (ok) => {
      const entry = inboxRemovals.get(id)
      if (!entry) return
      if (ok === false) inboxRemovals.delete(id)
      else entry.settledSeq = ++inboxRemovalSeq
    },
    () => inboxRemovals.delete(id),
  )
}

// Restored rows (undo, failure) belong in the list again.
function untrackInboxRemoval(id) {
  inboxRemovals.delete(id)
}

// The value to capture with `inboxRemovalSeq` when an inbox fetch starts.
function inboxFetchSeq() {
  return inboxRemovalSeq
}

/**
 * Filters a fetched inbox page against removals the fetch could not have
 * seen: any still pending, and any confirmed after the fetch began. A row
 * whose removal settled before the fetch started is the server's word again
 * (it may have been un-archived elsewhere), so it is kept and the log entry
 * cleared. Entries settled before the fetch that the page no longer lists are
 * confirmed gone and cleared too, keeping the log bounded.
 */
export function dropPendingRemovals(rows, fetchSeq) {
  const kept = rows.filter((row) => {
    const entry = inboxRemovals.get(row.id)
    if (!entry) return true
    return entry.settledSeq !== null && entry.settledSeq <= fetchSeq
  })
  for (const [id, entry] of inboxRemovals) {
    if (entry.settledSeq !== null && entry.settledSeq <= fetchSeq) inboxRemovals.delete(id)
  }
  return kept
}
// Spam verdict PATCHes, serialized per message like stars and read state,
// and the latest setSpam action per message so a failed earlier request
// knows not to roll back a newer choice (the verdict value alone can't tell:
// spam → not spam → spam ends on the same value it started from).
const pendingSpamUpdates = new Map()
const latestSpamAction = new Map()
let spamActionSeq = 0

// @param {Map<string, Promise<unknown>>} pending
// @param {string} id
// @param {() => Promise<unknown>} run
function serializePerMessage(pending, id, run) {
  const chained = (pending.get(id) ?? Promise.resolve()).catch(() => {}).then(run)
  pending.set(id, chained)
  // The caller handles chained's own rejection; this bookkeeping branch must
  // not surface it a second time as an unhandled rejection.
  chained
    .finally(() => {
      if (pending.get(id) === chained) pending.delete(id)
    })
    .catch(() => {})
  return chained
}

// Every folder loader maps rows into its own objects, so the same message in
// Starred, a label, search results and the inbox is a different object in
// each list. Membership is therefore by id, and each list's own copy is
// what gets put back on Undo.
function captureListPositions(email, lists) {
  return lists.map((list) => {
    const index = list.findIndex((item) => item.id === email.id)
    return { list, index, item: index > -1 ? list[index] : null }
  })
}

function removeFromCapturedLists(email, positions) {
  for (const { list } of positions) {
    const index = list.findIndex((item) => item.id === email.id)
    if (index > -1) list.splice(index, 1)
  }
}

function restoreCapturedLists(email, positions) {
  for (const { list, index, item } of positions) {
    if (index > -1 && !list.some((candidate) => candidate.id === email.id)) {
      list.splice(Math.min(index, list.length), 0, item ?? email)
    }
  }
}

// Whether a due time still keeps a message in the Snoozed folder.
function isSnoozedAt(scheduledFor) {
  return Boolean(scheduledFor) && new Date(scheduledFor) > new Date()
}

function syncFolderMembership(list, email, belongs) {
  const index = list.findIndex((item) => item.id === email.id)
  if (belongs) {
    if (index === -1) list.unshift(email)
  } else if (index > -1) {
    list.splice(index, 1)
  }
}

// `persist` lets an action route its PATCHes through a per-message queue
// (see serializePerMessage) so rapid opposite actions reach the server in
// click order; it defaults to a plain updateMessage.
// `isCurrent` says whether the email still reflects this action when its
// request fails; a later action on the same message (rapid toggles) has
// already moved the state on, and rolling back would overwrite that choice.
function reversibleMessageUpdate(
  store,
  {
    email,
    apply,
    restore,
    changes,
    undoChanges,
    message,
    errorMessage,
    shouldNotify,
    persist,
    isCurrent = () => true,
  },
) {
  const send = persist ?? ((next) => store.updateMessage(email.id, next))
  let undoRequested = false
  let toastId = null
  apply()

  const persistence = send(changes)
    .then(() => true)
    .catch((error) => {
      console.error(errorMessage, error)
      if (!undoRequested && isCurrent()) {
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
      await send(undoChanges)
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

// Autosave cadence. Short enough that a crashed tab loses at most a phrase,
// long enough that ordinary typing produces one write per pause rather than
// one per keystroke. The composer and the inline reply box each get their own
// timer: both can be open at once, on different drafts.
const DRAFT_AUTOSAVE_DELAY_MS = 800
let composerDraftTimer = null
let replyDraftTimer = null
// Autosaves for one surface run one at a time. Without this, the debounce
// firing and a flush-on-close can be in flight together with no draft id yet,
// and both POST — two rows for one message — or an older PATCH can land after
// a newer one and undo it.
let composerSaveChain = Promise.resolve()
let replySaveChain = Promise.resolve()
// The id each surface's most recent save produced, and the session it was
// for. A send takes over a message the moment it starts; if the first save of
// that message is still in flight there is no id to take yet, and the row it
// goes on to create would be nobody's — a sent message left in Drafts for
// good. consumeComposerDraft/consumeReplyDraft therefore record the save that
// was pending at handoff, so the send can collect the id once it lands
// (settleComposerHandoff/settleReplyHandoff).
let lastComposerSave = { session: -1, draftId: null }
let lastReplySave = { session: -1, draftId: null }
let composerHandoff = null
let replyHandoff = null
// Saves queued or running on each chain. A handoff is only worth recording
// while one of these is non-zero.
let composerSavesPending = 0
let replySavesPending = 0

// A GET /drafts in flight while autosave or a discard changes the list would
// otherwise replace those changes with an older snapshot. Edits made during a
// load are logged and replayed over its response; a load that a newer load
// superseded is dropped.
let draftsLoadSeq = 0
const DRAFTS_FRESH_MS = 30_000
const pendingDraftsLoads = new WeakMap()
let draftEditsDuringLoad = null

// Newest-first upsert or removal, shared by the live list and the replay in
// loadDrafts. `index` places a restored entry back where it was.
function applyDraftEdit(list, edit) {
  if (edit.kind === 'drop') return list.filter((draft) => draft.id !== edit.id)
  const rest = list.filter((draft) => draft.id !== edit.entry.id)
  rest.splice(Math.min(edit.index ?? 0, rest.length), 0, edit.entry)
  return rest
}

// Once the save that was running at handoff finishes, the id it produced —
// provided it was for that session and not an earlier message's.
function lateDraftIdFor(chain, session, surface) {
  return chain.then(() => {
    const last = surface === 'composer' ? lastComposerSave : lastReplySave
    return last.session === session ? last.draftId : null
  })
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
    loaded: 'isSpamLoaded',
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
  starred: {
    list: 'starredEmails',
    cursor: 'starredCursor',
    hasMore: 'hasMoreStarred',
    loaded: 'isStarredLoaded',
    refreshing: 'isStarredRefreshing',
    label: 'starred emails',
  },
  label: {
    list: 'labelEmails',
    cursor: 'labelCursor',
    hasMore: 'hasMoreLabel',
    loaded: 'isLabelLoaded',
    refreshing: 'isLabelRefreshing',
    label: 'labeled emails',
  },
}

// The recipients column is a {to, cc, bcc} object of {name, address} entries.
// Keep the To and Cc lists (Bcc is never shared back out) so the reader can
// address a reply-all without another round trip.
function mapRecipientList(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => ({ name: entry?.name || null, address: String(entry?.address ?? '').trim() }))
    .filter((entry) => entry.address)
}

// Maps a GET /emails (or /search) row to the shape the views render. Exported
// for the combined /search results page (stores/search.js's mail rows come
// from the same backend row shape) so it doesn't duplicate this mapping.
export function mapEmailRow(message) {
  const firstRecipient = message.recipients?.to?.[0] ?? null
  return {
    id: message.id,
    sender: message.from_name || message.from_address,
    address: message.from_address,
    // Outbound rows render "To: <recipient>" instead of the sender.
    isSent: Boolean(message.is_sent),
    to: firstRecipient ? firstRecipient.name || firstRecipient.address : null,
    recipients: {
      to: mapRecipientList(message.recipients?.to),
      cc: mapRecipientList(message.recipients?.cc),
    },
    subject: message.subject,
    snippet: message.snippet,
    body: message.body_text,
    sentAt: message.sent_at,
    date: formatEmailDate(message.sent_at),
    unread: message.is_unread,
    starred: message.is_starred,
    scheduledFor: message.scheduled_for ?? null,
    followUpAt: message.follow_up_at ?? null,
    readAt: null,
    readCount: 0,
    // Whether the message has an HTML body (cheap boolean from the list
    // endpoint). Lets the reader show a spinner during the on-demand body fetch
    // instead of flashing the plain-text fallback before the iframe swaps in.
    hasHtml: Boolean(message.has_html),
    // List endpoints expose only fresh thread-summary presence, never its text.
    hasAiSummary: Boolean(message.has_ai_summary),
    hasAttachments: Boolean(message.has_attachments),
    // The AI classifier's verdict, or the user's own report (see setSpam).
    // Drives the reader's Report spam / Not spam toggle wherever the row is
    // listed (Starred, labels and search include spam; the inbox does not).
    isSpam: message.spam_verdict === 'spam',
    // The ingest classifier's low/normal/high rating, reduced to the one
    // question the inbox asks: does this belong in the Important tab?
    isPriority: message.priority === 'high',
    // Starred, label and search lists span Done, and the Spam and Snoozed
    // folders exclude it, so count adjustments need to know.
    isArchived: Boolean(message.is_archived),
    labels: message.labels || [],
    category: message.category ?? null,
  }
}

// mapEmailRow builds labels, recipients and category afresh for every row, so
// a refresh that returns identical data would still hand each existing row
// three new object references. Vue treats that as a change and re-renders
// every visible EmailRow on every Realtime ping. Compare those fields by
// value and leave the existing reference in place when nothing moved.
const COMPOSITE_FIELDS = new Set(['labels', 'recipients', 'category'])

function assignChangedFields(target, row) {
  for (const key of Object.keys(row)) {
    const next = row[key]
    if (COMPOSITE_FIELDS.has(key)) {
      if (JSON.stringify(target[key]) === JSON.stringify(next)) continue
    } else if (Object.is(target[key], next)) continue
    target[key] = next
  }
}

export function mergeInboxPage(existing, incoming, pendingStarIds, pendingUnreadIds) {
  const previousById = new Map(existing.map((email) => [email.id, email]))
  const incomingIds = new Set(incoming.map((email) => email.id))
  const page = incoming.map((row) => {
    const previous = previousById.get(row.id)
    if (!previous) return row
    const keepStarred = pendingStarIds?.has(previous.id)
    const keepUnread = pendingUnreadIds?.has(previous.id)
    const starred = previous.starred
    const unread = previous.unread
    assignChangedFields(previous, row)
    if (keepStarred) previous.starred = starred
    if (keepUnread) previous.unread = unread
    return previous
  })
  return page.concat(existing.filter((email) => !incomingIds.has(email.id)))
}

export const useInboxStore = defineStore('inbox', {
  state: () => ({
    traditionalEmails: [],
    unreadInboxCount: 0,
    userId: null, // the authenticated user's uuid, for the Realtime inbox-ping channel
    ntfySubscription: null,
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
    // Gates setSpam's move into the Spam list: nothing to insert into until
    // the folder has been fetched once.
    isSpamLoaded: false,
    isSpamRefreshing: false,
    // How many messages the Spam folder holds; the sidebar lists Spam only
    // while this is non-zero. Server-provided with every inbox bootstrap and
    // refresh (so newly classified spam surfaces the folder), and kept in
    // step locally by the actions that move mail in or out of Spam.
    spamCount: 0,
    // Same for the Snoozed folder, adjusted by snoozing and by the actions
    // that take a snoozed message out of it.
    snoozedCount: 0,
    snoozedEmails: [],
    snoozedCursor: null,
    hasMoreSnoozed: false,
    isSnoozedLoaded: false,
    isSnoozedRefreshing: false,
    starredEmails: [],
    starredCursor: null,
    hasMoreStarred: false,
    isStarredLoaded: false,
    isStarredRefreshing: false,
    labelEmails: [],
    labelCursor: null,
    hasMoreLabel: false,
    labelFolderName: null,
    isLabelLoaded: false,
    isLabelRefreshing: false,
    // Staleness guard for label loads, mirroring listSeq above.
    labelSeq: 0,
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
    categories: [], // user-defined single-value email categories
    categoryNotificationSavingIds: new Set(),
    // The inbox tab the user picked: 'priority' (high-rated and due mail),
    // 'other' (the rest with no configured category), or 'category:<id>'.
    // Null until they pick one, when the view opens on the
    // first tab holding mail. Lives here rather than in the view so the
    // choice survives a trip to another section and back.
    inboxTab: null,
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
    composerFollowUpAt: null,
    // Saved drafts, newest first, for the Drafts view.
    drafts: [],
    isDraftsLoading: false,
    // Last successful GET /drafts, for loadDrafts' freshness window.
    draftsLoadedAt: 0,
    // The row each open composing surface autosaves into. Null until the
    // first save of a session creates one.
    composerDraftId: null,
    replyDraftId: null,
    // Identifies one composing session — one message being written. Bumped
    // whenever a surface starts a new message or hands the current one off to
    // a send. Uploads and saves capture it and refuse to apply their result to
    // a session that has since moved on, which is what stops a slow upload
    // from landing on the next message the user opens.
    composerSessionId: 0,
    replySessionId: 0,
    // How many composer uploads are still in flight, so the composer can
    // disable sending until every picked file actually exists server-side.
    pendingAttachmentUploads: 0,
    // Existing owned attachments carried into a forwarded message. The
    // browser keeps metadata for removable chips; only ids cross the API.
    composerAttachments: [],

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

    // AI dashboard "Needs attention" tasks (built-in Tasks-app items due
    // today/overdue + email action items), loaded lazily when the AI view
    // opens.
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
    personaliseGithub: false,

    // Model and UK-local schedule for the server-side data enricher.
    enrichmentSettings: parseEnrichmentSettings(defaultEnrichmentSettings),
    enrichmentSettingsLoaded: false,

    // How many days spam is kept before the ingest cron deletes it. Stored
    // server-side (users.prefs) for the same reason as interests: the sweep
    // runs with no browser open. The bounds come from the server too.
    spamRetentionDays: 30,
    spamRetentionBounds: { defaultDays: 30, minDays: 1, maxDays: 365 },
    spamRetentionLoaded: false,
    autoArchive: { marketing: false, coldPitches: false, socialNoise: false },
    autoArchiveLoaded: false,

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
    mutingThreadIds: new Set(),

    // Full message bodies fetched on demand (GET /api/messages), keyed by
    // message id. body_html is untrusted, sender-controlled HTML and is kept
    // out of the list payload; it is fetched only when a reader opens and
    // cached so reopening the same message doesn't refetch.
    messageBodies: new Map(),

    // Live one-line summaries are cached by thread id. message_ai summaries
    // remain per-message enrichment and are intentionally separate.
    threadSummaries: new Map(),
    summaryLoadingId: null,

    // Id of the message with an unsubscribe request in flight (null when idle).
    unsubscribingId: null,

    // Command palette (Cmd+K)
    isCommandPaletteOpen: false,
    // Bumped by the command palette's "Create Event" command; CalendarView
    // watches it to open its New Event dialog without the two views needing
    // a direct reference to each other. The pending flag survives a route
    // change so a request made from another view opens once Calendar mounts.
    calendarNewEventRequestId: 0,
    calendarNewEventPending: false,
    calendarNewEventDraft: null,
    // Calendar view action asked for by the command palette ('today',
    // 'previous', 'next' or 'view:<mode>'); CalendarView consumes it.
    calendarActionRequest: null,
    // Reading-panel action asked for by the command palette ('reply',
    // 'reply-all', 'forward' or 'snooze' with a schedule choice).
    // TraditionalInboxView owns the reply box, the forward draft and the
    // auto-advance after a snooze, so it consumes the request and clears it.
    readerActionRequest: null,
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
    allCategories(state) {
      return [...state.categories].sort((a, b) => a.name.localeCompare(b.name))
    },
    // Drives the sidebar's Drafts folder, which only renders once there is
    // something in it. Kept current by autosave (rememberDraft) and discard
    // rather than by re-fetching, so the folder appears as soon as the first
    // save lands and goes when the last draft is sent or thrown away.
    draftCount: (state) => state.drafts.length,
    // The sidebar lists Scheduled only while a Send Later is still queued.
    scheduledSendCount: (state) => state.scheduledSends.length,
    // Finds a loaded email by id across every list the reader can open from.
    // Returns null for a blank id so an absent one never resolves to the first
    // email of a list.
    emailById: (state) => (id) => {
      if (!id) return null
      return (
        state.traditionalEmails.find((e) => e.id === id) ??
        state.starredEmails.find((e) => e.id === id) ??
        state.labelEmails.find((e) => e.id === id) ??
        state.sentEmails.find((e) => e.id === id) ??
        state.spamEmails.find((e) => e.id === id) ??
        state.snoozedEmails.find((e) => e.id === id) ??
        state.doneEmails.find((e) => e.id === id) ??
        null
      )
    },
    // The email open in the reading panel; null once it leaves the list
    // (archived, or the list was replaced by a search). Sent mail opens from
    // its own list.
    openEmail() {
      return this.emailById(this.openEmailId)
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
    // True once an AI unsubscribe attempt for the open email failed this
    // session; the reader swaps the button for a disabled failed state.
    openEmailUnsubscribeFailed(state) {
      const cached = state.openEmailId ? state.messageBodies.get(state.openEmailId) : null
      return cached?.unsubscribeFailed === true
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
      const body = state.openEmailId ? state.messageBodies.get(state.openEmailId) : null
      return body?.threadId ? (state.threadSummaries.get(body.threadId) ?? null) : null
    },
    isOpenSummaryLoading(state) {
      return state.summaryLoadingId !== null && state.summaryLoadingId === state.openEmailId
    },
    // The open email's whole conversation (oldest first, the open message
    // included) — empty until the body fetch lands, or when the message is
    // its thread's only one. Drives the reader's threaded view.
    openEmailConversation(state) {
      const cached = state.openEmailId ? state.messageBodies.get(state.openEmailId) : null
      const thread = cached?.thread ?? []
      return thread.length > 1 ? thread : []
    },
    // A fetched body for any message by id: conversation messages expand from
    // the same cache the open email fills. Null until fetchMessageBody lands.
    messageBodyById(state) {
      return (id) => state.messageBodies.get(id) ?? null
    },
    // The open email's attachment metadata. Private Blob URLs remain server-side;
    // downloadable tells the reader whether it can request a short-lived URL.
    openEmailAttachments(state) {
      const cached = state.openEmailId ? state.messageBodies.get(state.openEmailId) : null
      return cached?.attachments ?? []
    },
    // Structured calendar invite metadata parsed by the Worker for the open
    // message. Null until the full message request has populated the cache.
    openEmailCalendarInvite(state) {
      const cached = state.openEmailId ? state.messageBodies.get(state.openEmailId) : null
      return cached?.calendarInvite ?? null
    },
  },

  actions: {
    requestCalendarNewEvent(draft = null) {
      this.calendarNewEventDraft = draft
      this.calendarNewEventPending = true
      this.calendarNewEventRequestId++
    },

    requestCalendarAction(action) {
      this.calendarActionRequest = { id: (this.calendarActionRequest?.id ?? 0) + 1, action }
    },

    requestReaderAction(action, payload = null) {
      this.readerActionRequest = { id: (this.readerActionRequest?.id ?? 0) + 1, action, payload }
    },

    // Bearer-token headers for API calls; Auth0 is absent in e2e/fixture mode.
    // Delegates so a dead session is recognised in one place: it sends the
    // person to sign in rather than letting each store report a generic
    // failure against a session that will never work again.
    authHeaders(extra = {}) {
      return buildAuthHeaders(extra)
    },

    // Fetches one keyset page of a list. Throws on a non-2xx response so the
    // callers' catch blocks handle notification.
    async fetchEmailPage({ folder, before, limit = PAGE_SIZE, label } = {}) {
      const headers = await this.authHeaders()
      const params = new URLSearchParams()
      if (folder) params.set('folder', folder)
      if (folder === 'label' && label) params.set('label', label)
      params.set('limit', limit)
      if (before) params.set('before', before)
      const response = await fetch(`${EMAILS_API_URL}/emails?${params}`, { headers })
      if (!response.ok) {
        throw new Error(`GET /emails responded ${response.status}`)
      }
      return response.json()
    },

    // Folder counts ride along with every inbox bootstrap and first page;
    // a payload without one (older Worker, cursor page) leaves it as is.
    applyFolderCounts({ spamCount, snoozedCount }) {
      if (Number.isFinite(spamCount)) this.spamCount = spamCount
      if (Number.isFinite(snoozedCount)) this.snoozedCount = snoozedCount
    },

    async loadInboxState({ force = false } = {}) {
      if (this.isInboxStateLoaded && !force) return
      try {
        const headers = await this.authHeaders()
        const response = await fetch(`${EMAILS_API_URL}/emails/state`, { headers })
        if (!response.ok) throw new Error(`GET inbox state responded ${response.status}`)
        const { unreadCount, spamCount, snoozedCount, userId } = await response.json()
        this.unreadInboxCount = Number.isFinite(unreadCount) ? unreadCount : 0
        this.applyFolderCounts({ spamCount, snoozedCount })
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
      const fetchSeq = inboxFetchSeq()
      this.isRefreshing = true
      try {
        const { emails, nextCursor, unreadCount, spamCount, snoozedCount, userId } =
          await this.fetchEmailPage()
        if (seq !== this.listSeq) return
        this.traditionalEmails = dropPendingRemovals(emails.map(mapEmailRow), fetchSeq)
        this.emailsCursor = nextCursor ?? null
        this.hasMoreEmails = Boolean(nextCursor)
        this.unreadInboxCount = Number.isFinite(unreadCount)
          ? unreadCount
          : this.traditionalEmails.filter((e) => e.unread).length
        this.applyFolderCounts({ spamCount, snoozedCount })
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
      const fetchSeq = inboxFetchSeq()
      this.isRefreshing = true
      try {
        const { emails, nextCursor } = await this.fetchEmailPage({ before: this.emailsCursor })
        if (seq !== this.listSeq) return
        this.traditionalEmails.push(...dropPendingRemovals(emails.map(mapEmailRow), fetchSeq))
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
      if (this.activeSearchQuery) return
      return Promise.all([
        this.isInboxLoaded ? this.refreshInboxEmails() : this.loadInboxState({ force: true }),
        this.loadDrafts({ silent: true }),
      ])
    },

    async refreshInboxEmails() {
      if (this.activeSearchQuery) return
      const seq = this.listSeq
      const fetchSeq = inboxFetchSeq()
      try {
        const { emails, nextCursor, unreadCount, spamCount, snoozedCount, userId } =
          await this.fetchEmailPage()
        if (this.activeSearchQuery || seq !== this.listSeq) return
        const incoming = dropPendingRemovals(emails.map(mapEmailRow), fetchSeq)
        const existing = this.traditionalEmails
        this.traditionalEmails = mergeInboxPage(
          existing,
          incoming,
          pendingStarUpdates,
          pendingUnreadUpdates,
        )
        if (existing.length <= incoming.length) {
          this.emailsCursor = nextCursor ?? null
          this.hasMoreEmails = Boolean(nextCursor)
        }
        this.unreadInboxCount = Number.isFinite(unreadCount) ? unreadCount : this.unreadInboxCount
        this.applyFolderCounts({ spamCount, snoozedCount })
        if (userId) this.userId = userId
        this.isInboxStateLoaded = true
      } catch (error) {
        if (this.activeSearchQuery || seq !== this.listSeq) return
        console.error('Failed to refresh inbox:', error)
        this.notify('Failed to load inbox.', 'error')
      }
    },

    // Loads (or reloads) a server-backed folder list; see FOLDER_STATE.
    // Label loads are labelSeq-guarded like loadEmails' listSeq: switching
    // labels quickly starts concurrent fetches that share one list, and
    // without the guard whichever response resolves last would win —
    // potentially rendering label A's emails under label B's header.
    async loadFolder(folder, extra = {}) {
      const keys = FOLDER_STATE[folder]
      const seq = folder === 'label' ? ++this.labelSeq : null
      this[keys.refreshing] = true
      try {
        const { emails, nextCursor, readReceiptsAvailable } = await this.fetchEmailPage({
          folder,
          ...extra,
        })
        if (seq !== null && seq !== this.labelSeq) return
        this[keys.list] = emails.map(mapEmailRow)
        if (folder === 'sent' && readReceiptsAvailable) {
          await this.loadReadReceipts(this[keys.list])
        }
        this[keys.cursor] = nextCursor ?? null
        this[keys.hasMore] = Boolean(nextCursor)
        if (keys.loaded) this[keys.loaded] = true
        if (folder === 'spam' || folder === 'snoozed') {
          // The list is the truth once it has been fetched: a single page
          // is the whole folder, a partial one is a floor for the count.
          const countKey = folder === 'spam' ? 'spamCount' : 'snoozedCount'
          this[countKey] = nextCursor
            ? Math.max(this[countKey], this[keys.list].length)
            : this[keys.list].length
        }
      } catch (error) {
        if (seq !== null && seq !== this.labelSeq) return
        console.error(`Failed to load ${keys.label}:`, error)
        this.notify(`Failed to load ${keys.label}.`, 'error')
      } finally {
        if (seq === null || seq === this.labelSeq) this[keys.refreshing] = false
      }
    },

    // Appends the folder's next keyset page. No-op while a load is already
    // running or when there is no further page. Label appends verify the
    // active label hasn't switched mid-flight so page 2 of an abandoned
    // label can't land in the new label's list.
    async loadMoreFolder(folder, extra = {}) {
      const keys = FOLDER_STATE[folder]
      if (!this[keys.cursor] || this[keys.refreshing]) return
      const expectedLabel = folder === 'label' ? this.labelFolderName : null
      this[keys.refreshing] = true
      try {
        const { emails, nextCursor, readReceiptsAvailable } = await this.fetchEmailPage({
          folder,
          before: this[keys.cursor],
          ...extra,
        })
        if (expectedLabel !== null && this.labelFolderName !== expectedLabel) return
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
        const response = await fetch(
          `${RECEIPTS_API_URL}/read-receipts?messageIds=${encodeURIComponent(ids)}`,
          { headers },
        )
        if (!response.ok) throw new Error(`GET /read-receipts responded ${response.status}`)
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
    loadStarredEmails() {
      return this.loadFolder('starred')
    },
    loadMoreStarredEmails() {
      return this.loadMoreFolder('starred')
    },
    setInboxTab(tab) {
      this.inboxTab = tab
    },
    loadLabelEmails(name) {
      const label = String(name ?? '').trim()
      if (!label) return
      if (this.labelFolderName !== label) {
        this.labelEmails = []
        this.labelCursor = null
        this.hasMoreLabel = false
        this.isLabelLoaded = false
      }
      this.labelFolderName = label
      return this.loadFolder('label', { label })
    },
    loadMoreLabelEmails() {
      if (!this.labelFolderName) return
      return this.loadMoreFolder('label', { label: this.labelFolderName })
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

    async loadCategories() {
      try {
        const headers = await this.authHeaders()
        const response = await fetch(`${LABELS_API_URL}/categories`, { headers })
        if (!response.ok) {
          throw new Error(`GET /categories responded ${response.status}`)
        }
        const { categories } = await response.json()
        this.categories = categories
      } catch (error) {
        console.error('Failed to load categories:', error)
        this.notify('Failed to load categories.', 'error')
      }
    },

    async loadNtfySubscription() {
      const headers = await this.authHeaders()
      const response = await fetch(`${NOTIFICATIONS_API_URL}/ntfy`, { headers, cache: 'no-store' })
      if (!response.ok) throw new Error(`GET /ntfy responded ${response.status}`)
      const subscription = await response.json()
      this.ntfySubscription = subscription.enabled ? subscription : null
      return this.ntfySubscription
    },

    async createNtfySubscription() {
      const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
      const response = await fetch(`${NOTIFICATIONS_API_URL}/ntfy`, { method: 'POST', headers })
      if (!response.ok) throw new Error(`POST /ntfy responded ${response.status}`)
      this.ntfySubscription = await response.json()
      return this.ntfySubscription
    },

    async disableNtfySubscription() {
      const headers = await this.authHeaders()
      const response = await fetch(`${NOTIFICATIONS_API_URL}/ntfy`, { method: 'DELETE', headers })
      if (!response.ok) throw new Error(`DELETE /ntfy responded ${response.status}`)
      this.ntfySubscription = null
    },

    async sendNtfyTest() {
      const headers = await this.authHeaders()
      const response = await fetch(`${NOTIFICATIONS_API_URL}/ntfy/test`, {
        method: 'POST',
        headers,
      })
      if (!response.ok) {
        const details = await response.json().catch(() => ({}))
        const error = new Error(`POST /ntfy/test responded ${response.status}`)
        error.code = details.error
        error.retryAfterSeconds = details.retryAfterSeconds
        throw error
      }
      return response.json()
    },

    async setMessageCategory(email, category) {
      if (!email) return false
      const categoryId = category?.id ?? null
      if ((email.category?.id ?? null) === categoryId) return true
      try {
        const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
        const response = await fetch(`${MESSAGES_API_URL}/messages`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ id: email.id, action: 'set_category', category_id: categoryId }),
        })
        if (!response.ok) throw new Error(`POST /messages responded ${response.status}`)
        const { category: assignedCategory } = await response.json()
        for (const list of [
          this.traditionalEmails,
          this.starredEmails,
          this.labelEmails,
          this.sentEmails,
          this.spamEmails,
          this.snoozedEmails,
          this.doneEmails,
        ]) {
          const cached = list.find((item) => item.id === email.id)
          if (cached) cached.category = assignedCategory ?? null
        }
        email.category = assignedCategory ?? null
        return true
      } catch (error) {
        console.error('Failed to update message category:', error)
        this.notify('Failed to update category.', 'error')
        return false
      }
    },

    async createCategory({ name, color, description }) {
      try {
        const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
        const response = await fetch(`${LABELS_API_URL}/categories`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ name, color, description }),
        })
        if (response.status === 409) {
          this.notify('A category with that name already exists.', 'error')
          return false
        }
        if (!response.ok) throw new Error(`POST /categories responded ${response.status}`)
        const { category } = await response.json()
        this.categories = [...this.categories, category].sort((a, b) =>
          a.name.localeCompare(b.name),
        )
        this.notify('Category created.')
        return true
      } catch (error) {
        console.error('Failed to create category:', error)
        this.notify('Failed to create category.', 'error')
        return false
      }
    },

    async deleteCategory(id) {
      try {
        const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
        const response = await fetch(`${LABELS_API_URL}/categories`, {
          method: 'DELETE',
          headers,
          body: JSON.stringify({ id }),
        })
        if (!response.ok) throw new Error(`DELETE /categories responded ${response.status}`)
        this.categories = this.categories.filter((category) => category.id !== id)
        for (const list of [
          this.traditionalEmails,
          this.starredEmails,
          this.labelEmails,
          this.sentEmails,
          this.spamEmails,
          this.snoozedEmails,
          this.doneEmails,
        ]) {
          for (const email of list) {
            if (email.category?.id === id) email.category = null
          }
        }
        this.notify('Category deleted.')
        return true
      } catch (error) {
        console.error('Failed to delete category:', error)
        this.notify('Failed to delete category.', 'error')
        return false
      }
    },

    async updateCategory(category, { name, description }) {
      const nextName = name.trim()
      const nextDescription = description.trim()
      if (!nextName) return false
      if (nextName === category.name && nextDescription === (category.description || ''))
        return true
      try {
        const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
        const response = await fetch(`${LABELS_API_URL}/categories`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            id: category.id,
            name: nextName,
            description: nextDescription,
          }),
        })
        if (response.status === 409) {
          this.notify('A category with that name already exists.', 'error')
          return false
        }
        if (!response.ok) throw new Error(`PATCH /categories responded ${response.status}`)
        const { category: updatedCategory } = await response.json()
        Object.assign(category, updatedCategory)
        this.categories.sort((a, b) => a.name.localeCompare(b.name))
        for (const list of [
          this.traditionalEmails,
          this.starredEmails,
          this.labelEmails,
          this.sentEmails,
          this.spamEmails,
          this.snoozedEmails,
          this.doneEmails,
        ]) {
          for (const email of list) {
            if (email.category?.id === category.id) Object.assign(email.category, updatedCategory)
          }
        }
        this.notify('Category updated.')
        return true
      } catch (error) {
        console.error('Failed to update category:', error)
        this.notify('Failed to update category.', 'error')
        return false
      }
    },

    async setCategoryNotifications(category, enabled) {
      if (!category) return false
      if (this.categoryNotificationSavingIds.has(category.id)) return false
      this.categoryNotificationSavingIds.add(category.id)
      try {
        const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
        const response = await fetch(`${LABELS_API_URL}/categories`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            id: category.id,
            notifications_enabled: enabled,
          }),
        })
        if (!response.ok) throw new Error(`PATCH /categories responded ${response.status}`)
        const { category: updatedCategory } = await response.json()
        Object.assign(category, updatedCategory)
        this.notify(
          enabled ? 'Category notifications enabled.' : 'Category notifications disabled.',
        )
        return true
      } catch (error) {
        console.error('Failed to update category notifications:', error)
        this.notify('Failed to update category notifications.', 'error')
        return false
      } finally {
        this.categoryNotificationSavingIds.delete(category.id)
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
        if (this.isLabelLoaded && this.labelFolderName === label.name) {
          syncFolderMembership(
            this.labelEmails,
            email,
            (labels || []).some((item) => item.name === label.name),
          )
        }
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
          this.starredEmails,
          this.labelEmails,
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
        if (!response.ok)
          throw new Error(`PATCH /api/labels?resource=rules responded ${response.status}`)
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
        const response = await fetch(`${SEARCH_API_URL}/search?q=${encodeURIComponent(q)}${mode}`, {
          headers,
          signal: controller.signal,
        })
        if (!response.ok) {
          throw new Error(`GET /search responded ${response.status}`)
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

    async setThreadMuted(id, muted) {
      const body = this.messageBodies.get(id)
      if (!body?.threadId || this.mutingThreadIds.has(body.threadId)) return
      const threadId = body.threadId
      this.mutingThreadIds.add(threadId)
      try {
        const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
        const response = await fetch(`${MESSAGES_API_URL}/messages`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ id, action: muted ? 'mute_thread' : 'unmute_thread' }),
        })
        if (!response.ok) throw new Error(`Thread mute responded ${response.status}`)
        const { thread } = await response.json()
        if (thread?.id !== threadId || ![true, false].includes(thread.is_muted)) {
          throw new Error('Invalid thread mute response')
        }
        for (const cached of this.messageBodies.values()) {
          if (cached.threadId === threadId) cached.threadMuted = thread.is_muted
        }
        this.notify(thread.is_muted ? 'Thread muted. Replies will be silent.' : 'Thread unmuted.')
      } catch (error) {
        console.error('Failed to update thread mute:', error)
        this.notify('Could not change thread notifications. Please try again.', 'error')
      } finally {
        this.mutingThreadIds.delete(threadId)
      }
    },

    openReader(email) {
      this.setUnread(email, false)
      this.openEmailId = email.id
      this.fetchMessageBody(email.id).then(() => this.ensureThreadSummary(email))
    },

    // Opens an email row surfaced by the combined /search results page (see
    // views/SearchResultsView.vue). There is no per-email route — the reader
    // is keyed off traditionalEmails + openEmailId — so this mirrors clicking
    // a row in the loaded inbox: splice the row into traditionalEmails if it
    // isn't already there (TraditionalInboxView's filteredEmails-presence
    // watch would otherwise close the reader the moment the list next
    // recomputes), then open it exactly like any other row. A search result
    // that is starred, sent, or otherwise excluded from the default inbox
    // view will still open once but can be closed by an unrelated list
    // refresh — a known gap in the absence of a real per-email route.
    openEmailFromSearch(row) {
      const existing = this.traditionalEmails.find((e) => e.id === row.id)
      if (existing) {
        this.openReader(existing)
        return
      }
      const email = mapEmailRow(row)
      this.traditionalEmails.unshift(email)
      this.openReader(email)
    },

    // Fetches a message's full body on demand and caches it by id. Returns the
    // cached { html, text } (html is the raw, still-untrusted body_html — the
    // reader sanitizes it before rendering). Successful fetches are cached so
    // reopening doesn't refetch; failures are not cached so a later open can
    // retry. Never throws — the reader falls back to the list's body_text.
    async fetchMessageBody(id) {
      if (!id) return null
      if (this.messageBodies.has(id)) {
        const cached = this.messageBodies.get(id)
        if (cached.calendarInvitePending) void this.fetchCalendarInvite(id, cached)
        return cached
      }
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
      const completeTiming = startTiming('message-body')
      try {
        const headers = await this.authHeaders()
        const response = await fetch(
          `${MESSAGES_API_URL}/messages?id=${encodeURIComponent(id)}&calendar=deferred`,
          {
            headers,
          },
        )
        if (!response.ok) {
          throw new Error(`GET /api/messages responded ${response.status}`)
        }
        const payload = await response.json()
        const {
          body_html,
          body_text,
          unsubscribe,
          thread_summary,
          thread_latest_message_id,
          thread,
          attachments,
          calendar_invite,
        } = payload
        const body = {
          html: body_html ?? null,
          text: body_text ?? null,
          unsubscribe: unsubscribe ?? null,
          thread: Array.isArray(thread) ? thread : [],
          attachments: Array.isArray(attachments) ? attachments : [],
        }
        if (payload.thread_id) {
          body.threadId = payload.thread_id
          body.threadLatestMessageId = thread_latest_message_id ?? null
          if ([true, false].includes(payload.thread_muted)) {
            body.threadMuted = payload.thread_muted
          }
        }
        // Keep backwards compatibility with older API responses that omit the
        // field while preserving an explicit null from the new API.
        if (Object.prototype.hasOwnProperty.call(payload, 'calendar_invite')) {
          body.calendarInvite = calendar_invite ?? null
        }
        if (payload.calendar_invite_pending === true) body.calendarInvitePending = true
        cacheSet(this.messageBodies, id, body, MAX_CACHED_MESSAGE_BODIES)
        if (body.calendarInvitePending)
          void this.fetchCalendarInvite(id, this.messageBodies.get(id))
        const summaryText = String(thread_summary ?? '')
          .replace(/\s+/g, ' ')
          .trim()
        if (body.threadId) {
          if (summaryText) {
            cacheSet(this.threadSummaries, body.threadId, summaryText, MAX_CACHED_SUMMARIES)
          } else {
            this.threadSummaries.delete(body.threadId)
          }
        }
        return body
      } catch (error) {
        console.error('Failed to load message body:', error)
        return null
      } finally {
        completeTiming()
        // Always clear, whether the fetch succeeded or failed, but only if this
        // call is still the one in flight (a newer open may have superseded it).
        if (this.bodyLoadingId === id) this.bodyLoadingId = null
      }
    },

    async fetchCalendarInvite(id, cached) {
      if (pendingInviteFetches.has(id)) return pendingInviteFetches.get(id)
      const request = (async () => {
        try {
          const headers = await this.authHeaders()
          const response = await fetch(
            `${MESSAGES_API_URL}/messages/calendar-invite?id=${encodeURIComponent(id)}`,
            { headers },
          )
          if (!response.ok) return
          const { calendar_invite } = await response.json()
          if (this.messageBodies.get(id) !== cached) return
          cached.calendarInvite = calendar_invite ?? null
          cached.calendarInvitePending = false
        } catch {
          // Keep the body readable and retry enrichment on the next open.
        } finally {
          pendingInviteFetches.delete(id)
        }
      })()
      pendingInviteFetches.set(id, request)
      return request
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
        // The URL is server-supplied; only a real web (or local blob) link
        // may reach a synthetic click, so a compromised/misconfigured
        // response can't navigate to javascript:/data:.
        try {
          const { protocol } = new URL(url)
          if (protocol !== 'https:' && protocol !== 'http:' && protocol !== 'blob:') {
            throw new Error(`Unsupported attachment URL protocol: ${protocol}`)
          }
        } catch (error) {
          console.error('Rejected unsafe attachment URL:', error)
          this.notify('Attachment download failed.', 'error')
          return false
        }

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

    async ensureThreadSummary(email) {
      if (!email?.id) return null
      const body = this.messageBodies.get(email.id)
      if (!body?.threadId || !body.threadLatestMessageId) return null
      if (!Array.isArray(body.thread) || body.thread.length < 2) return null
      if (this.threadSummaries.has(body.threadId)) return this.threadSummaries.get(body.threadId)
      return this.summarizeEmail(email)
    },

    async summarizeEmail(email) {
      if (!email || this.summaryLoadingId) return null
      const id = email.id
      const body = this.messageBodies.get(id)
      if (!body?.threadId || !body.threadLatestMessageId) return null
      this.summaryLoadingId = id
      try {
        const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const response = await fetch(`${AI_API_URL}/summarize`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ id }),
          })
          if (response.status === 409 && attempt === 0) {
            this.messageBodies.delete(id)
            await this.fetchMessageBody(id)
            if (this.openEmailId !== id) return null
            continue
          }
          if (!response.ok) {
            throw new Error(`POST /summarize responded ${response.status}`)
          }
          const { summary, threadId, latestMessageId } = await response.json()
          const normalized = String(summary ?? '')
            .replace(/\s+/g, ' ')
            .trim()
          if (!normalized) {
            throw new Error('POST /summarize returned an invalid summary')
          }
          const currentBody = this.messageBodies.get(id)
          if (
            currentBody?.threadId !== threadId ||
            currentBody.threadLatestMessageId !== latestMessageId
          ) {
            if (attempt === 0) {
              this.messageBodies.delete(id)
              await this.fetchMessageBody(id)
              if (this.openEmailId !== id) return null
              continue
            }
            return null
          }
          cacheSet(this.threadSummaries, threadId, normalized, MAX_CACHED_SUMMARIES)
          email.hasAiSummary = true
          return normalized
        }
        return null
      } catch (error) {
        console.error('AI summarization failed:', error)
        this.notify('AI summarization failed. Please try again.', 'error')
        return null
      } finally {
        if (this.summaryLoadingId === id) this.summaryLoadingId = null
      }
    },

    async refreshOpenThread() {
      const id = this.openEmailId
      if (!id) return null
      this.messageBodies.delete(id)
      await this.fetchMessageBody(id)
      if (this.openEmailId !== id) return null
      return this.ensureThreadSummary(this.openEmail)
    },

    closeReader() {
      this.openEmailId = null
    },

    // Automated unsubscribe for newsletters (List-Unsubscribe header). The
    // server performs a one-click POST when the sender supports RFC 8058,
    // sends a mailto unsubscribe via Resend, or — for link-only senders —
    // drives the sender's unsubscribe page with AI (allow_ai). That last
    // tier can take up to three minutes, so the reader shows a spinner off
    // unsubscribingId for the duration. A confirmed unsubscribe marks the
    // email done; a failed AI attempt flags the cached body so the reader
    // shows a disabled "AI Unsubscribe Failed" state instead.
    async unsubscribeEmail(email) {
      if (!email || this.unsubscribingId) return
      this.unsubscribingId = email.id
      try {
        const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
        const response = await fetch(`${MESSAGES_API_URL}/messages`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ id: email.id, action: 'unsubscribe', allow_ai: true }),
          // Slightly longer than the server's own three-minute AI budget so
          // the server verdict, not this abort, decides the outcome.
          signal: AbortSignal.timeout(190_000),
        })
        if (!response.ok) {
          throw new Error(`POST /api/messages responded ${response.status}`)
        }
        const result = await response.json()
        if (result.status === 'unsubscribed') {
          const cached = this.messageBodies.get(email.id)
          if (cached) {
            cacheSet(
              this.messageBodies,
              email.id,
              { ...cached, unsubscribed: true },
              MAX_CACHED_MESSAGE_BODIES,
            )
          }
          this.notify(`Unsubscribed from ${email.sender}.`)
          this.archiveEmail(email)
        } else if (result.status === 'ai_failed') {
          const cached = this.messageBodies.get(email.id)
          if (cached) {
            cacheSet(
              this.messageBodies,
              email.id,
              { ...cached, unsubscribeFailed: true },
              MAX_CACHED_MESSAGE_BODIES,
            )
          }
          this.notify(`AI could not unsubscribe from ${email.sender}.`, 'error')
        } else if (result.status === 'manual' && isSafeUnsubscribeUrl(result.url)) {
          window.open(result.url, '_blank', 'noopener')
          this.notify('Finish unsubscribing on the page that just opened.')
        } else if (
          result.status === 'manual' &&
          // Same strict mailto policy as the reader bridge: single address,
          // subject-only param, no control characters — the value comes from
          // sender-controlled List-Unsubscribe headers.
          parseMailto(result.mailto)
        ) {
          window.location.href = parseMailto(result.mailto)?.href ?? ''
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
      if (this.isStarredLoaded) syncFolderMembership(this.starredEmails, email, nextStarred)
      serializePerMessage(pendingStarUpdates, email.id, () =>
        this.updateMessage(email.id, { is_starred: nextStarred }).catch((error) => {
          console.error('Failed to update starred state:', error)
          // Only revert if a later toggle hasn't already moved past this one.
          if (email.starred === nextStarred) {
            email.starred = !nextStarred
            if (this.isStarredLoaded) syncFolderMembership(this.starredEmails, email, !nextStarred)
          }
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
      // Spam never shows in Snoozed, so only non-spam moves the count.
      const snoozedDelta =
        email.isSpam || email.isArchived
          ? 0
          : Number(isSnoozedAt(scheduledFor)) - Number(isSnoozedAt(previousScheduledFor))
      let applied = false

      const apply = () => {
        if (applied) return
        applied = true
        email.scheduledFor = scheduledFor
        this.snoozedCount = Math.max(0, this.snoozedCount + snoozedDelta)
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
        untrackInboxRemoval(email.id)
        email.scheduledFor = previousScheduledFor
        this.snoozedCount = Math.max(0, this.snoozedCount - snoozedDelta)
        if (inboxIndex > -1 && !this.traditionalEmails.includes(email)) {
          this.traditionalEmails.splice(
            Math.min(inboxIndex, this.traditionalEmails.length),
            0,
            email,
          )
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
      if (inboxIndex > -1) trackInboxRemoval(email.id, persistence)
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
        this.starredEmails,
        this.labelEmails,
        this.snoozedEmails,
        this.spamEmails,
      ])
      const wasUnread = email.unread
      const wasUnreadInbox = positions[0].index > -1 && wasUnread
      // Starred and label lists include Done, where Done again is a no-op
      // for the Spam and Snoozed folders (both exclude archived mail).
      const wasArchived = Boolean(email.isArchived)
      const leavesSpam = Boolean(email.isSpam) && !wasArchived
      const leavesSnoozed = !email.isSpam && isSnoozedAt(email.scheduledFor) && !wasArchived
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
        email.isArchived = true
        if (this.openEmailId === email.id) this.openEmailId = null
        if (wasUnreadInbox) this.unreadInboxCount = Math.max(0, this.unreadInboxCount - 1)
        if (leavesSpam) this.spamCount = Math.max(0, this.spamCount - 1)
        if (leavesSnoozed) this.snoozedCount = Math.max(0, this.snoozedCount - 1)
        if (addToDone && !this.doneEmails.includes(email)) this.doneEmails.unshift(email)
      }
      const restore = () => {
        if (!applied) return
        applied = false
        untrackInboxRemoval(email.id)
        restoreCapturedLists(email, positions)
        email.unread = wasUnread
        email.isArchived = wasArchived
        if (wasUnreadInbox) this.unreadInboxCount++
        if (leavesSpam) this.spamCount++
        if (leavesSnoozed) this.snoozedCount++
        if (addToDone) {
          const doneIndex = this.doneEmails.indexOf(email)
          if (doneIndex > -1) this.doneEmails.splice(doneIndex, 1)
        }
      }

      const { persistence, undo } = reversibleMessageUpdate(this, {
        email,
        apply,
        restore,
        changes: { is_archived: true, is_unread: false },
        undoChanges: { is_archived: false, is_unread: wasUnread },
        message: 'Marked done.',
        errorMessage: 'Failed to archive email.',
        shouldNotify,
      })
      if (positions[0].index > -1) trackInboxRemoval(email.id, persistence)
      if (undoActions) undoActions.push(undo)
      return undo
    },

    // Records the user's spam verdict. Reporting moves the email out of the
    // inbox and Snoozed into Spam; clearing the report moves it back (to
    // Snoozed while its scheduled time is still ahead, otherwise the inbox).
    // Starred and label lists show spam too, so they are left alone. Read
    // state is untouched — only the inbox unread badge follows the move.
    setSpam(email, spam, shouldNotify = true, undoActions = null) {
      if (!email || email.isSpam === spam) return null
      const wasSpam = email.isSpam
      const snoozed = isSnoozedAt(email.scheduledFor)
      const seq = ++spamActionSeq
      latestSpamAction.set(email.id, seq)
      // During a search traditionalEmails holds results from every folder
      // (search includes spam), so it is neither the inbox nor a list the
      // email should leave. Archived mail is outside both Spam and Snoozed,
      // so its verdict changes no folder count.
      const searching = Boolean(this.activeSearchQuery)
      const live = !email.isArchived
      const leaving = spam
        ? searching
          ? [this.snoozedEmails]
          : [this.traditionalEmails, this.snoozedEmails]
        : [this.spamEmails]
      const positions = captureListPositions(email, leaving)
      const inboxPosition = positions.find(({ list }) => list === this.traditionalEmails)
      const wasUnreadInbox = Boolean(inboxPosition && inboxPosition.index > -1 && email.unread)
      let destination = null
      if (!live) destination = null
      else if (spam && this.isSpamLoaded) destination = this.spamEmails
      else if (!spam && snoozed && this.isSnoozedLoaded) destination = this.snoozedEmails
      else if (!spam && !snoozed && this.isInboxLoaded && !searching) {
        destination = this.traditionalEmails
      }
      const entersInbox = destination === this.traditionalEmails
      let applied = false

      const apply = () => {
        if (applied) return
        applied = true
        email.isSpam = spam
        for (const { item } of positions) if (item) item.isSpam = spam
        removeFromCapturedLists(email, positions)
        if (destination && !destination.includes(email)) destination.unshift(email)
        if (this.openEmailId === email.id) this.openEmailId = null
        if (wasUnreadInbox) this.unreadInboxCount = Math.max(0, this.unreadInboxCount - 1)
        if (entersInbox && email.unread) this.unreadInboxCount++
        if (live) {
          this.spamCount = Math.max(0, this.spamCount + (spam ? 1 : -1))
          if (snoozed) this.snoozedCount = Math.max(0, this.snoozedCount + (spam ? -1 : 1))
        }
      }
      const restore = () => {
        if (!applied) return
        applied = false
        if (spam) untrackInboxRemoval(email.id)
        email.isSpam = wasSpam
        for (const { item } of positions) if (item) item.isSpam = wasSpam
        if (destination) {
          const index = destination.indexOf(email)
          if (index > -1) destination.splice(index, 1)
        }
        restoreCapturedLists(email, positions)
        if (wasUnreadInbox) this.unreadInboxCount++
        if (entersInbox && email.unread) {
          this.unreadInboxCount = Math.max(0, this.unreadInboxCount - 1)
        }
        if (live) {
          this.spamCount = Math.max(0, this.spamCount + (spam ? -1 : 1))
          if (snoozed) this.snoozedCount = Math.max(0, this.snoozedCount + (spam ? 1 : -1))
        }
      }

      const { persistence, undo } = reversibleMessageUpdate(this, {
        email,
        apply,
        restore,
        changes: { is_spam: spam },
        undoChanges: { is_spam: wasSpam },
        message: spam ? 'Reported as spam.' : 'Marked not spam.',
        errorMessage: spam ? 'Failed to report spam.' : 'Failed to mark not spam.',
        shouldNotify,
        persist: (next) =>
          serializePerMessage(pendingSpamUpdates, email.id, () =>
            this.updateMessage(email.id, next),
          ),
        isCurrent: () => latestSpamAction.get(email.id) === seq,
      })
      if (spam && inboxPosition && inboxPosition.index > -1) {
        trackInboxRemoval(email.id, persistence)
      }
      if (undoActions) undoActions.push(undo)
      return undo
    },

    // Soft-deletes an email: optimistically removes it from every visible
    // list (including Done) and persists the is_deleted flag.
    deleteEmail(email, shouldNotify = true, undoActions = null) {
      if (!email) return null
      const positions = captureListPositions(email, [
        this.traditionalEmails,
        this.starredEmails,
        this.labelEmails,
        this.snoozedEmails,
        this.spamEmails,
        this.doneEmails,
        this.sentEmails,
      ])
      const wasUnreadInbox = positions[0].index > -1 && email.unread
      // Done hides spam and snoozed mail too, so only a live row lowers
      // either count.
      const live = !email.isArchived
      const leavesSpam = Boolean(email.isSpam) && live
      const leavesSnoozed = !email.isSpam && isSnoozedAt(email.scheduledFor) && live
      let applied = false

      const apply = () => {
        if (applied) return
        applied = true
        removeFromCapturedLists(email, positions)
        if (this.openEmailId === email.id) this.openEmailId = null
        if (wasUnreadInbox) this.unreadInboxCount = Math.max(0, this.unreadInboxCount - 1)
        if (leavesSpam) this.spamCount = Math.max(0, this.spamCount - 1)
        if (leavesSnoozed) this.snoozedCount = Math.max(0, this.snoozedCount - 1)
      }
      const restore = () => {
        if (!applied) return
        applied = false
        restoreCapturedLists(email, positions)
        if (wasUnreadInbox) this.unreadInboxCount++
        if (leavesSpam) this.spamCount++
        if (leavesSnoozed) this.snoozedCount++
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
    sendMail,

    async setMessageFollowUp(email, followUpAt) {
      const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
      const response = await fetch('/api/send?resource=follow-up', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ messageId: email.id, followUpAt }),
      })
      if (!response.ok) {
        throw new Error(`PATCH follow-up responded ${response.status}`)
      }
      const { message } = await response.json()
      for (const list of [
        this.traditionalEmails,
        this.starredEmails,
        this.labelEmails,
        this.sentEmails,
        this.spamEmails,
        this.snoozedEmails,
        this.doneEmails,
      ]) {
        for (const item of list) {
          if (item.id === email.id) item.followUpAt = message.followUpAt
        }
      }
      if (message.followUpAt === null && email.isSent) {
        const inboxIndex = this.traditionalEmails.findIndex((item) => item.id === email.id)
        if (inboxIndex > -1) this.traditionalEmails.splice(inboxIndex, 1)
      }
      return message
    },

    openComposer() {
      if (!this.isComposerActive) this.composerSessionId += 1
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

    // Returns an unsaved suggestion. Only createRule/updateRule persist rules.
    async requestAiRuleDraft(instruction) {
      const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
      const response = await fetch(`${AI_API_URL}/rule-draft`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ instruction: instruction.trim() }),
      })
      const data = await response.json()
      if (!response.ok)
        throw new Error(data.error || 'AI rule generation failed. Please try again.')
      if (
        !data.draft ||
        !['conditions', 'ai'].includes(data.draft.kind) ||
        !Array.isArray(data.draft.conditions)
      ) {
        throw new Error('AI returned an invalid rule. Please try again.')
      }
      return data.draft
    },

    async requestAiSnippet(instruction) {
      const prompt = instruction.trim()
      if (!prompt) return null
      try {
        const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
        const response = await fetch(`${AI_API_URL}/compose`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ mode: 'snippet', instruction: prompt }),
        })
        if (!response.ok) throw new Error(`POST /compose responded ${response.status}`)
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
        // cache: 'no-store' — contacts are per-account; the shared browser
        // HTTP cache must never serve them across an account switch.
        const response = await fetch(`${MESSAGES_API_URL}/messages/contacts`, {
          headers,
          cache: 'no-store',
        })
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
        const response = await fetch(`${TASKS_API_URL}/tasks?date=${localToday()}`, { headers })
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
        const { interests, personaliseGithub } = await response.json()
        this.interests = interests
        this.personaliseGithub = personaliseGithub === true
        this.interestsLoaded = true
      } catch (error) {
        console.error('Failed to load interests:', error)
      }
    },

    // Replaces the stored personalisation topics. Throws on failure so the
    // settings pane can report it; the server's normalized list wins, so the
    // in-memory copy matches what the enricher will actually read.
    async saveInterests(interests, personaliseGithub = this.personaliseGithub) {
      const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
      const response = await fetch(`${TASKS_API_URL}/tasks/interests`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ interests, personaliseGithub }),
      })
      if (!response.ok) {
        throw new Error(`PUT interests responded ${response.status}`)
      }
      const saved = await response.json()
      this.interests = saved.interests
      this.personaliseGithub = saved.personaliseGithub === true
      this.interestsLoaded = true
      return this.interests
    },

    async loadEnrichmentSettings() {
      if (this.enrichmentSettingsLoaded) return
      const headers = await this.authHeaders()
      const response = await fetch(`${TASKS_API_URL}/tasks/enrichment-settings`, { headers })
      if (!response.ok) throw new Error(`GET enrichment settings responded ${response.status}`)
      const saved = parseEnrichmentSettings(await response.json())
      if (this.enrichmentSettingsLoaded) return
      this.enrichmentSettings = saved
      this.enrichmentSettingsLoaded = true
    },

    async saveEnrichmentSettings(enrichmentSettings) {
      const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
      const response = await fetch(`${TASKS_API_URL}/tasks/enrichment-settings`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ enrichmentSettings }),
      })
      if (!response.ok) throw new Error(`PUT enrichment settings responded ${response.status}`)
      this.enrichmentSettings = parseEnrichmentSettings(await response.json())
      this.enrichmentSettingsLoaded = true
      return this.enrichmentSettings
    },

    async loadAutoArchive() {
      if (this.autoArchiveLoaded) return
      const headers = await this.authHeaders()
      const response = await fetch(`${EMAILS_API_URL}/emails/auto-archive`, { headers })
      if (!response.ok) throw new Error(`GET auto archive responded ${response.status}`)
      const saved = parseAutoArchive(await response.json())
      if (this.autoArchiveLoaded) return
      this.autoArchive = saved
      this.autoArchiveLoaded = true
    },

    async saveAutoArchive(autoArchive) {
      const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
      const response = await fetch(`${EMAILS_API_URL}/emails/auto-archive`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ autoArchive }),
      })
      if (!response.ok) throw new Error(`PUT auto archive responded ${response.status}`)
      this.autoArchive = parseAutoArchive(await response.json())
      this.autoArchiveLoaded = true
    },

    async loadSpamRetention() {
      if (this.spamRetentionLoaded) return
      try {
        const headers = await this.authHeaders()
        const response = await fetch(`${EMAILS_API_URL}/emails/spam-retention`, { headers })
        if (!response.ok) throw new Error(`GET spam retention responded ${response.status}`)
        const payload = await response.json()
        // A save that completed while this was in flight is newer than
        // whatever the server had when it answered.
        if (this.spamRetentionLoaded) return
        this.applySpamRetention(payload)
      } catch (error) {
        console.error('Failed to load spam retention:', error)
      }
    },

    // Throws on failure so the settings pane can report it; the server's
    // normalized value wins, so the pane shows what the sweep will use.
    async saveSpamRetention(days) {
      const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
      const response = await fetch(`${EMAILS_API_URL}/emails/spam-retention`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ spamRetentionDays: days }),
      })
      if (!response.ok) {
        throw new Error(`PUT spam retention responded ${response.status}`)
      }
      this.applySpamRetention(await response.json())
      return this.spamRetentionDays
    },

    applySpamRetention({ spamRetentionDays, defaultDays, minDays, maxDays }) {
      if (Number.isFinite(spamRetentionDays)) this.spamRetentionDays = spamRetentionDays
      if ([defaultDays, minDays, maxDays].every(Number.isFinite)) {
        this.spamRetentionBounds = { defaultDays, minDays, maxDays }
      }
      this.spamRetentionLoaded = true
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

    // Completes one digest item by marking its referenced email Done. The
    // persisted archive flag is what makes the Worker omit the item when the
    // stored digest is composed again after a reload. Apply local state only
    // after the PATCH succeeds so the view can restore its optimistic row on
    // failure without also repairing cached email state.
    async completeTopicItem(item) {
      const email = this.emailById(item.message_id)
      const positions = email
        ? captureListPositions(email, [
            this.traditionalEmails,
            this.starredEmails,
            this.labelEmails,
            this.snoozedEmails,
            this.spamEmails,
          ])
        : []
      const wasUnreadInbox = email ? positions[0].index > -1 && email.unread : Boolean(item?.unread)
      const addToDone =
        email &&
        this.isDoneLoaded &&
        this.donePageIndex === 0 &&
        !this.doneEmails.some((candidate) => candidate.id === email.id)
      const persistence = this.updateMessage(item.message_id, {
        is_archived: true,
        is_unread: false,
      })
      trackInboxRemoval(item.message_id, persistence)
      await persistence
      item.unread = false
      if (email) {
        removeFromCapturedLists(email, positions)
        email.unread = false
        email.isArchived = true
        if (addToDone) this.doneEmails.unshift(email)
      }
      if (wasUnreadInbox) this.unreadInboxCount = Math.max(0, this.unreadInboxCount - 1)
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

    // Marks a gathered task done (POST /api/tasks). A built-in task is marked
    // completed in the Tasks app server-side. Throws on a non-2xx so the
    // caller can roll back its optimistic UI; on success the task is dropped
    // from the local list.
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

    // Reschedules a gathered task to another day (POST /api/tasks). A
    // built-in task has its due date set in the Tasks app server-side first.
    // Throws on a non-2xx so the caller can roll back its optimistic UI; on
    // success the task's due_date is updated in place - whether it should
    // still be visible today is the caller's call, since a reschedule to
    // later today keeps it there.
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

    // save:false is for the send paths, which have already taken the draft id
    // via consumeComposerDraft() — flushing there would write a fresh row for
    // a message that is on its way out.
    closeComposer({ save = true } = {}) {
      if (save) this.flushComposerDraft()
      this.isComposerActive = false
      this.composerTo = ''
      this.composerSubject = ''
      this.composerTextArea = ''
      this.composerHtml = ''
      this.composerReplyToMessageId = null
      this.composerFollowUpAt = null
      this.composerAttachments = []
      this.composerDraftId = null
      this.isAiDraftActive = false
      this.isAiDraftLoading = false
      this.aiDraftPreview = ''
      this.composerAiInstruction = ''
    },

    // --- Drafts ---------------------------------------------------------
    // Composer contents are autosaved server-side (cookie-web-drafts), so a
    // reload, a crash, or a different device picks the message back up. Only
    // the undo-send holding state (pendingSend) stays client-side, since it
    // is a countdown rather than a document.

    // silent: the sign-in bootstrap that decides whether the sidebar shows a
    // Drafts folder at all. A failure there should not toast — the folder
    // simply stays hidden until the next save or the Drafts view loads.
    //
    // The reader asks for drafts on every open and the Realtime refresh on
    // every ping, so without a freshness window this is a full collection
    // fetch per email read. Concurrent callers share the in-flight request;
    // a successful load counts as fresh for DRAFTS_FRESH_MS unless the
    // caller passes force (the Drafts view, autosave reconciliation).
    async loadDrafts({ silent = false, force = false } = {}) {
      const pending = pendingDraftsLoads.get(this)
      if (pending) return pending
      if (!force && Date.now() - this.draftsLoadedAt < DRAFTS_FRESH_MS) return
      const request = this.loadDraftsUncached({ silent }).finally(() => {
        pendingDraftsLoads.delete(this)
      })
      pendingDraftsLoads.set(this, request)
      return request
    },

    async loadDraftsUncached({ silent }) {
      const seq = ++draftsLoadSeq
      draftEditsDuringLoad = []
      this.isDraftsLoading = true
      try {
        const headers = await this.authHeaders()
        const response = await fetch(`${DRAFTS_API_URL}/drafts?view=summary`, { headers })
        if (!response.ok) throw new Error(`GET /drafts responded ${response.status}`)
        const { drafts } = await response.json()
        if (seq !== draftsLoadSeq) return
        // The response predates whatever autosave and discard did while it
        // was on its way; replay those so a draft saved a moment ago (and the
        // sidebar folder it brought with it) is not undone by the fetch.
        let list = Array.isArray(drafts) ? drafts : []
        for (const edit of draftEditsDuringLoad) list = applyDraftEdit(list, edit)
        this.drafts = list
        this.draftsLoadedAt = Date.now()
      } catch (error) {
        console.error('Failed to load drafts:', error)
        if (!silent) this.notify('Could not load your drafts.', 'error')
      } finally {
        if (seq === draftsLoadSeq) {
          draftEditsDuringLoad = null
          this.isDraftsLoading = false
        }
      }
    },

    // Keeps the in-memory Drafts list — and so the sidebar folder — in step
    // with what autosave just wrote, without another round trip. Newest
    // first, matching GET /drafts.
    rememberDraft(draft) {
      const entry = {
        id: draft.id,
        to: draft.to ?? '',
        subject: draft.subject ?? '',
        text: draft.text ?? '',
        html: draft.html ?? null,
        replyToMessageId: draft.replyToMessageId ?? null,
        isAiGenerated:
          draft.isAiGenerated ??
          this.drafts.find((entry) => entry.id === draft.id)?.isAiGenerated ??
          false,
        followUpAt: draft.followUpAt ?? null,
        attachments: (draft.attachments ?? []).map((attachment) => ({ ...attachment })),
        updatedAt: draft.updatedAt ?? new Date().toISOString(),
      }
      this.applyDraftEdit({ kind: 'keep', entry, index: 0 })
    },

    forgetDraft(draftId) {
      if (!draftId) return
      this.applyDraftEdit({ kind: 'drop', id: draftId })
    },

    applyDraftEdit(edit) {
      draftEditsDuringLoad?.push(edit)
      this.drafts = applyDraftEdit(this.drafts, edit)
    },

    // Creates the row on first save and replaces it on every save after.
    // Returns the draft id, or null when the save left nothing worth keeping
    // (the worker deletes a draft that has been emptied out).
    async persistDraft(draftId, draft) {
      const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
      const payload = {
        to: draft.to ?? '',
        subject: draft.subject ?? '',
        text: draft.text ?? '',
        html: draft.html ?? null,
        replyToMessageId: draft.replyToMessageId ?? null,
        followUpAt: draft.followUpAt ?? null,
        attachmentIds: (draft.attachments ?? []).map(({ id }) => id),
      }
      const response = await fetch(
        draftId
          ? `${DRAFTS_API_URL}/drafts/${encodeURIComponent(draftId)}`
          : `${DRAFTS_API_URL}/drafts`,
        { method: draftId ? 'PATCH' : 'POST', headers, body: JSON.stringify(payload) },
      )
      // 204: the draft was emptied and the row is gone. 400 on a create is
      // the worker declining to store an untouched composer.
      if (response.status === 204) {
        this.forgetDraft(draftId)
        return null
      }
      if (response.status === 400 && !draftId) return null
      // A draft deleted elsewhere (another tab, the Drafts view) should start
      // a fresh row rather than resurrect a dead id.
      if (response.status === 404 && draftId) {
        this.forgetDraft(draftId)
        return this.persistDraft(null, draft)
      }
      if (!response.ok) throw new Error(`Draft save responded ${response.status}`)
      const { draft: saved } = await response.json()
      if (!saved?.id) return null
      this.rememberDraft({ ...draft, id: saved.id, updatedAt: saved.updatedAt })
      return saved.id
    },

    // Autosave is best-effort: a failed save must never interrupt typing or
    // steal focus with a toast, so it is logged and retried on the next pause.
    async writeComposerDraft(session) {
      if (session !== this.composerSessionId || !this.isComposerActive) return
      try {
        const draftId = await this.persistDraft(this.composerDraftId, {
          to: this.composerTo,
          subject: this.composerSubject,
          text: this.composerTextArea,
          html: this.composerHtml,
          replyToMessageId: this.composerReplyToMessageId,
          followUpAt: this.composerFollowUpAt,
          attachments: this.composerAttachments,
        })
        lastComposerSave = { session, draftId }
        // A send, a close-and-reopen, or another draft opening while this was
        // in flight means the id belongs to a message that is no longer the
        // one on screen. A send that took the message collects the id through
        // settleComposerHandoff; otherwise the row keeps its content in Drafts.
        if (session !== this.composerSessionId) return
        this.composerDraftId = draftId
      } catch (error) {
        console.error('Draft autosave failed:', error)
      }
    },

    saveComposerDraft(session = this.composerSessionId) {
      composerSavesPending += 1
      composerSaveChain = composerSaveChain
        .then(() => this.writeComposerDraft(session))
        .finally(() => {
          composerSavesPending -= 1
        })
      return composerSaveChain
    },

    scheduleComposerDraftSave() {
      // Captured now, not when the timer fires: by then the composer may hold
      // a different message entirely.
      const session = this.composerSessionId
      clearTimeout(composerDraftTimer)
      composerDraftTimer = setTimeout(
        () => this.saveComposerDraft(session),
        DRAFT_AUTOSAVE_DELAY_MS,
      )
    },

    // Called when the composer closes or the tab is hidden: the pending
    // debounce would otherwise never fire.
    flushComposerDraft() {
      clearTimeout(composerDraftTimer)
      return this.saveComposerDraft()
    },

    async writeReplyDraft(draft, session) {
      if (session !== this.replySessionId) return
      try {
        const draftId = await this.persistDraft(this.replyDraftId, draft)
        lastReplySave = { session, draftId }
        if (session !== this.replySessionId) return
        this.replyDraftId = draftId
      } catch (error) {
        console.error('Reply draft autosave failed:', error)
      }
    },

    saveReplyDraft(draft, session = this.replySessionId) {
      replySavesPending += 1
      replySaveChain = replySaveChain
        .then(() => this.writeReplyDraft(draft, session))
        .finally(() => {
          replySavesPending -= 1
        })
      return replySaveChain
    },

    scheduleReplyDraftSave(draft) {
      const session = this.replySessionId
      clearTimeout(replyDraftTimer)
      replyDraftTimer = setTimeout(
        () => this.saveReplyDraft(draft, session),
        DRAFT_AUTOSAVE_DELAY_MS,
      )
    },

    flushReplyDraft(draft) {
      clearTimeout(replyDraftTimer)
      return this.saveReplyDraft(draft)
    },

    // Navigation captures the departing draft before the next reader adopts
    // another row. Drain its autosaves, then persist the last edit to that row.
    async leaveReplyDraft(draft) {
      const draftId = this.consumeReplyDraft()
      const handoff = this.settleReplyHandoff()
      const saves = replySaveChain
      try {
        await saves
        const savedId = draftId || (handoff ? await handoff : null)
        await this.persistDraft(savedId, draft)
      } catch (error) {
        console.error('Reply draft autosave failed:', error)
        this.notify('Could not save your reply draft.', 'error')
      }
    },

    // Hands the draft row off to a send: cancels any queued autosave and
    // returns the id so the caller can delete it once the mail is really
    // gone (or hand it back on undo).
    consumeComposerDraft() {
      clearTimeout(composerDraftTimer)
      const session = this.composerSessionId
      this.composerSessionId += 1
      const draftId = this.composerDraftId
      this.composerDraftId = null
      // No id yet: a first save may still be in flight, and its row belongs
      // to whoever just took the message.
      composerHandoff =
        !draftId && composerSavesPending > 0
          ? lateDraftIdFor(composerSaveChain, session, 'composer')
          : null
      return draftId
    },

    // A promise of the id a still-pending save creates for the message the
    // last consumeComposerDraft() took, or null when no save was pending —
    // so the common case costs the caller no await at all.
    settleComposerHandoff() {
      const handoff = composerHandoff
      composerHandoff = null
      return handoff
    },

    consumeReplyDraft() {
      clearTimeout(replyDraftTimer)
      const session = this.replySessionId
      this.replySessionId += 1
      const draftId = this.replyDraftId
      this.replyDraftId = null
      replyHandoff =
        !draftId && replySavesPending > 0 ? lateDraftIdFor(replySaveChain, session, 'reply') : null
      return draftId
    },

    settleReplyHandoff() {
      const handoff = replyHandoff
      replyHandoff = null
      return handoff
    },

    // Gives a row that arrived late to the composer, if it still holds the
    // message that row was saved from. Nothing is ever deleted here unless
    // the composer has already made its own row for the same words.
    adoptLateComposerDraft(session, draftId) {
      if (!draftId || !this.isComposerActive || this.composerSessionId !== session) return
      if (this.composerDraftId) this.discardDraft(draftId)
      else this.composerDraftId = draftId
    },

    async discardDraft(draftId) {
      if (!draftId) return
      const index = this.drafts.findIndex((draft) => draft.id === draftId)
      const removed = index === -1 ? null : this.drafts[index]
      this.forgetDraft(draftId)
      try {
        const headers = await this.authHeaders()
        const response = await fetch(`${DRAFTS_API_URL}/drafts/${encodeURIComponent(draftId)}`, {
          method: 'DELETE',
          headers,
        })
        if (!response.ok && response.status !== 404) {
          throw new Error(`DELETE /drafts responded ${response.status}`)
        }
      } catch (error) {
        console.error('Failed to delete draft:', error)
        // The row is still on the server, so the list — and the sidebar
        // folder counting it — must say so. Back where it was.
        if (removed) this.applyDraftEdit({ kind: 'keep', entry: removed, index })
        this.notify('Could not delete the draft.', 'error')
      }
    },

    // Shared by the full composer and automatic inline replies. List entries
    // contain previews; only opening a draft needs its complete content.
    async loadDraftContent(draft) {
      if (!draft.isSummary) return draft
      try {
        const headers = await this.authHeaders()
        const response = await fetch(`${DRAFTS_API_URL}/drafts/${encodeURIComponent(draft.id)}`, {
          headers,
        })
        if (!response.ok) throw new Error(`GET draft responded ${response.status}`)
        return (await response.json()).draft
      } catch (error) {
        console.error('Failed to open draft:', error)
        this.notify('Could not open your draft. Please try again.', 'error')
        return null
      }
    },

    // Reopens a saved draft in the composer, preserving the active session
    // if another action takes over while its full content is loading.
    async openDraft(draft) {
      if (draft.isSummary) {
        const session = this.composerSessionId
        draft = await this.loadDraftContent(draft)
        if (!draft || session !== this.composerSessionId) return false
      }
      // Whatever is in the composer now is a different message: get its last
      // edits to the server before its state is overwritten, and await it so
      // the write cannot land after this draft has taken the composer over.
      if (this.isComposerActive) await this.flushComposerDraft()
      this.composerSessionId += 1
      this.composerTo = draft.to ?? ''
      this.composerSubject = draft.subject ?? ''
      this.composerTextArea = draft.text ?? ''
      this.composerHtml = draft.html ?? ''
      this.composerReplyToMessageId = draft.replyToMessageId ?? null
      this.composerFollowUpAt = draft.followUpAt ?? null
      this.composerAttachments = draft.attachments ?? []
      this.composerDraftId = draft.id
      this.isComposerActive = true
    },

    // Uploads picked files and returns the stored attachment rows. Shared by
    // the composer and the inline reply box, which keep their own draft
    // state. Each file is independent: one failure notifies and drops that
    // file alone rather than discarding a batch already waited for.
    async uploadAttachmentFiles(files, existingCount = 0) {
      const picked = Array.from(files ?? [])
      if (!picked.length) return []
      const room = MAX_ATTACHMENTS - existingCount
      if (room <= 0) {
        this.notify(`You can attach up to ${MAX_ATTACHMENTS} files.`, 'error')
        return []
      }
      if (picked.length > room) {
        this.notify(`Only the first ${room} of those files were attached.`, 'info')
      }

      const uploaded = []
      for (const file of picked.slice(0, room)) {
        this.pendingAttachmentUploads += 1
        try {
          const attachment = await uploadAttachment(file, {
            userId: this.userId,
            authHeaders: (extra) => this.authHeaders(extra),
          })
          uploaded.push({ ...attachment, source: 'upload' })
        } catch (error) {
          console.error('Attachment upload failed:', error)
          this.notify(`Could not attach ${file.name}.`, 'error')
        } finally {
          this.pendingAttachmentUploads -= 1
        }
      }
      return uploaded
    },

    // Uploads that outlived the message they were picked for have no owner:
    // reclaim them now rather than leaving bytes for the 24-hour sweep.
    discardUploads(attachments) {
      for (const attachment of attachments) {
        this.discardUploadedAttachment(attachment.id).catch(() => {})
      }
    },

    async attachComposerFiles(files) {
      const session = this.composerSessionId
      const uploaded = await this.uploadAttachmentFiles(files, this.composerAttachments.length)
      if (!uploaded.length) return
      // Closing the composer and starting another message while a large file
      // uploads would otherwise attach it to whatever is on screen when it
      // lands, which is not the message the user picked it for.
      if (!this.isComposerActive || session !== this.composerSessionId) {
        this.discardUploads(uploaded)
        return
      }
      this.composerAttachments.push(...uploaded)
    },

    // Forwarded attachments belong to the original message and are only
    // dropped from this draft; an upload exists solely for this draft, so
    // removing it should reclaim its bytes now rather than wait for the sweep.
    removeComposerAttachment(id) {
      const removed = this.composerAttachments.find((attachment) => attachment.id === id)
      this.composerAttachments = this.composerAttachments.filter(
        (attachment) => attachment.id !== id,
      )
      if (removed?.source !== 'upload') return
      this.discardUploadedAttachment(id).catch(() => {})
    },

    async discardUploadedAttachment(id) {
      const headers = await this.authHeaders()
      const response = await fetch(`/api/send?resource=attachment&id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers,
      })
      if (!response.ok && response.status !== 404) {
        throw new Error(`DELETE /api/send?resource=attachment responded ${response.status}`)
      }
    },

    openAiDraft() {
      this.isAiDraftActive = true
      if (!this.composerAiInstruction) {
        this.composerAiInstruction = this.composerTextArea.trim()
          ? 'Improve this draft while keeping its meaning.'
          : 'Write a concise, friendly email.'
      }
    },

    async requestAiReply({ replyToMessageId, to, subject, existingText }) {
      const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
      const response = await fetch(`${AI_API_URL}/compose`, {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(25_000),
        body: JSON.stringify({
          instruction:
            'Write a concise, helpful reply to this email in its language. ' +
            'Use the existing draft as guidance and preserve its meaning. ' +
            'Keep facts and commitments grounded in the supplied context; ask for missing information when needed. ' +
            'Return the reply body without a quoted original, signature, or placeholders.',
          replyToMessageId,
          to,
          subject,
          existingText,
        }),
      })
      if (!response.ok) throw new Error(`POST /compose responded ${response.status}`)
      const { draft } = await response.json()
      const text = draft.text.trim()
      if (!text || text.length > 10_000) throw new Error('AI returned an invalid reply')
      return convertEmojiToEmoticons(text)
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
        const response = await fetch(`${AI_API_URL}/compose`, {
          method: 'POST',
          headers,
          body: JSON.stringify(request),
        })
        if (!response.ok) throw new Error(`POST /compose responded ${response.status}`)
        const { draft } = await response.json()
        this.aiDraftPreview = convertEmojiToEmoticons(draft.text)
        if (!this.composerSubject.trim() && draft.subject) {
          this.composerSubject = convertEmojiToEmoticons(draft.subject)
        }
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
    async sendEmail() {
      if (this.isSendingEmail || this.pendingSend) return
      if (!recipientsValid(this.composerTo) || !this.composerTextArea.trim()) return
      const draft = normalizeOutgoingDraft({
        to: this.composerTo,
        subject: this.composerSubject,
        text: this.composerTextArea,
        html: this.composerHtml,
        replyToMessageId: this.composerReplyToMessageId,
        followUpAt: this.composerFollowUpAt,
        attachments: this.composerAttachments.map((attachment) => ({ ...attachment })),
      })
      const draftId = this.consumeComposerDraft()
      // The session an undo or a failed send restores the message into.
      const session = this.composerSessionId
      this.closeComposer({ save: false })
      this.startPendingSend({ ...draft, draftId })
      // The first save may still be in flight; its row goes with this send.
      const handoff = draftId ? null : this.settleComposerHandoff()
      if (!handoff) return
      const pending = this.pendingSend
      const lateDraftId = await handoff
      if (!lateDraftId) return
      // Counting down or sending: commit and undo read draftId from this
      // object later, so attaching it is enough.
      if (this.pendingSend === pending || pending.outcome === 'sending') {
        pending.draftId = lateDraftId
      } else if (pending.outcome === 'sent') {
        await this.discardDraft(lateDraftId)
      } else {
        // Undone or failed: the message is back in the composer.
        this.adoptLateComposerDraft(session, lateDraftId)
      }
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
      const pending = this.pendingSend
      const { to, subject, text, html, replyToMessageId, followUpAt, attachments, draftId } =
        pending
      this.pendingSend = null
      pending.outcome = 'undone'
      // Keep writing into the same row the composer was autosaving before.
      this.composerDraftId = draftId ?? null
      this.composerTo = to
      this.composerSubject = subject
      this.composerTextArea = text
      this.composerHtml = html
      this.composerReplyToMessageId = replyToMessageId
      this.composerFollowUpAt = followUpAt
      this.composerAttachments = attachments ?? []
      this.isComposerActive = true
    },

    // Fires when the countdown reaches zero: performs the real send. On failure
    // the message is restored in the composer rather than silently lost.
    async commitPendingSend() {
      if (!this.pendingSend) return
      clearInterval(sendCountdownTimer)
      const draft = this.pendingSend
      this.pendingSend = null
      draft.outcome = 'sending'
      this.isSendingEmail = true
      try {
        const result = await this.sendMail({
          to: draft.to,
          subject: draft.subject,
          text: draft.text,
          html: draft.html,
          replyToMessageId: draft.replyToMessageId,
          followUpAt: draft.followUpAt,
          attachments: draft.attachments,
        })
        this.notify(
          result?.followUpScheduled === false
            ? 'Email sent, but the reminder could not be saved.'
            : 'Email sent.',
          result?.followUpScheduled === false ? 'error' : 'info',
        )
        // Only now is the message really gone; deleting the draft any earlier
        // would lose it if the send failed.
        draft.outcome = 'sent'
        await this.discardDraft(draft.draftId)
      } catch (error) {
        draft.outcome = 'failed'
        console.error('Failed to send email:', error)
        this.notify('Failed to send email. Please try again.', 'error')
        this.composerTo = draft.to
        this.composerSubject = draft.subject
        this.composerTextArea = draft.text
        this.composerHtml = draft.html
        this.composerReplyToMessageId = draft.replyToMessageId
        this.composerFollowUpAt = draft.followUpAt
        this.composerAttachments = draft.attachments ?? []
        this.composerDraftId = draft.draftId ?? null
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
      const draft = normalizeOutgoingDraft({
        to: this.composerTo,
        subject: this.composerSubject,
        text: this.composerTextArea,
        html: this.composerHtml,
        replyToMessageId: this.composerReplyToMessageId,
        followUpAt: this.composerFollowUpAt,
        attachments: this.composerAttachments.map((attachment) => ({ ...attachment })),
      })
      let draftId = this.consumeComposerDraft()
      this.closeComposer({ save: false })
      this.isSendingEmail = true
      try {
        // A first save still in flight owns the only row for this message.
        const handoff = draftId ? null : this.settleComposerHandoff()
        if (handoff) draftId = await handoff
        const { scheduledSend } = await this.sendMail({ ...draft, sendAt })
        if (this.isScheduledSendsLoaded) this.scheduledSends.unshift(scheduledSend)
        this.notify(`Email scheduled for ${label}.`)
        // The scheduled_sends row is now the durable copy of this message.
        await this.discardDraft(draftId)
        return true
      } catch (error) {
        console.error('Failed to schedule email:', error)
        this.notify('Failed to schedule email. Please try again.', 'error')
        this.composerTo = draft.to
        this.composerSubject = draft.subject
        this.composerTextArea = draft.text
        this.composerHtml = draft.html
        this.composerReplyToMessageId = draft.replyToMessageId
        this.composerFollowUpAt = draft.followUpAt
        this.composerAttachments = draft.attachments ?? []
        this.composerDraftId = draftId ?? null
        this.isComposerActive = true
        return false
      } finally {
        this.isSendingEmail = false
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
      this.composerFollowUpAt = canceled.followUpAt
      this.composerAttachments = canceled.attachments ?? []
      this.isComposerActive = true
    },

    // Real RAG: /ask retrieves the most relevant stored emails via
    // hybrid search and answers with the sources it used.
    async askAssistant(query) {
      this.isChatDrawerActive = true
      pushCapped(this.chatHistory, { text: query, sender: 'user' }, MAX_CHAT_HISTORY)
      askAbortController?.abort()
      const controller = new AbortController()
      askAbortController = controller
      const seq = ++askSeq
      this.isChatLoading = true
      try {
        const headers = await this.authHeaders({ 'Content-Type': 'application/json' })
        const response = await fetch(`${SEARCH_API_URL}/ask`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ question: query }),
          signal: controller.signal,
        })
        if (!response.ok) {
          throw new Error(`POST /ask responded ${response.status}`)
        }
        const { answer, sources } = await response.json()
        if (seq !== askSeq) return
        pushCapped(
          this.chatHistory,
          { text: answer, sender: 'ai', sources: sources || [] },
          MAX_CHAT_HISTORY,
        )
      } catch (error) {
        if (seq !== askSeq) return
        if (error?.name === 'AbortError') return
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
        if (askAbortController === controller) askAbortController = null
        if (seq === askSeq) this.isChatLoading = false
      }
    },
  },
})
