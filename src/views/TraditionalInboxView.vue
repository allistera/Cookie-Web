<script setup>
import { computed, ref, nextTick, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useInboxStore, formatEmailDate } from '../stores/inbox'
import ComposerEditor from '../components/ComposerEditor.vue'
import EmailBody from '../components/EmailBody.vue'
import EmailRow from '../components/EmailRow.vue'
import ScheduleMenu from '../components/ScheduleMenu.vue'
import { sanitizeEmailHtml } from '../lib/sanitizeEmailHtml'
import { scheduleChoices } from '../utils/schedule'
import { detectCalendarSuggestion, formatCalendarSuggestion } from '../utils/calendarSuggestion'

const store = useInboxStore()
const route = useRoute()
const router = useRouter()

// --- Filtered views (?filter=starred|snoozed|sent|done|label&label=<name>) ---
// Starred, label, Sent, Spam, Snoozed, and the hidden Done mailbox have
// server-backed lists loaded lazily when opened. The inbox still hides
// starred rows client-side so starring moves mail out of Inbox immediately.
const FILTER_META = {
  starred: { title: 'Starred', icon: 'star', emptyText: 'No starred emails.' },
  snoozed: { title: 'Snoozed', icon: 'schedule', emptyText: 'No snoozed emails yet.' },
  sent: { title: 'Sent', icon: 'send', emptyText: 'No sent emails yet.' },
  spam: { title: 'Spam', icon: 'report', emptyText: 'No spam. Nice and tidy.' },
  done: { title: 'Done', icon: 'task_alt', emptyText: 'No emails marked done.' },
  label: { title: null, icon: 'sell', emptyText: 'No emails with this label.' },
}

const activeFilter = computed(() => (FILTER_META[route.query.filter] ? route.query.filter : null))

// The sent list refreshes on every visit — cheap, and it picks up mail sent
// from other devices since the last look.
watch(
  [activeFilter, () => route.query.label],
  ([filter, label]) => {
    if (filter === 'sent') store.loadSentEmails()
    if (filter === 'spam') store.loadSpamEmails()
    if (filter === 'snoozed') store.loadSnoozedEmails()
    if (filter === 'done') store.loadDonePage(0)
    if (filter === 'starred') store.loadStarredEmails()
    if (filter === 'label') store.loadLabelEmails(label)
    if (
      !['sent', 'spam', 'snoozed', 'done', 'starred', 'label'].includes(filter) &&
      !store.isInboxLoaded &&
      store.traditionalEmails.length === 0
    ) {
      store.loadEmails()
    }
  },
  { immediate: true },
)

const filteredEmails = computed(() => {
  const emails = store.traditionalEmails
  switch (activeFilter.value) {
    case 'starred':
      return store.starredEmails
    case 'label':
      return store.labelEmails
    case 'sent':
      return store.sentEmails
    case 'spam':
      return store.spamEmails
    case 'snoozed':
      return store.snoozedEmails
    case 'done':
      return store.doneEmails
    default:
      return store.activeSearchQuery
        ? emails
        : emails.filter(
            (e) =>
              !e.starred || (e.scheduledFor && new Date(e.scheduledFor).getTime() <= Date.now()),
          )
  }
})

const headerTitle = computed(() => {
  if (!activeFilter.value) return 'Inbox'
  if (activeFilter.value === 'label') return route.query.label
  return FILTER_META[activeFilter.value].title
})

const headerIcon = computed(() =>
  activeFilter.value ? FILTER_META[activeFilter.value].icon : 'inbox',
)

const headerIconStyle = computed(() => {
  if (activeFilter.value !== 'label') return undefined
  const label = store.allLabels.find((l) => l.name === route.query.label)
  return label ? { color: label.color } : undefined
})

const emptyText = computed(() => FILTER_META[activeFilter.value]?.emptyText ?? '')

const emailHasAiSummary = (email) =>
  Boolean(email.hasAiSummary || store.messageSummaries.get(email.id))

const showInboxZero = computed(
  () =>
    !activeFilter.value &&
    !store.activeSearchQuery &&
    !filteredEmails.value.length &&
    !store.hasMoreEmails &&
    !store.isRefreshing,
)

const showLoadMore = computed(() => {
  if (store.activeSearchQuery) return false
  if (activeFilter.value === 'sent') return store.hasMoreSent
  if (activeFilter.value === 'spam') return store.hasMoreSpam
  if (activeFilter.value === 'snoozed') return store.hasMoreSnoozed
  if (activeFilter.value === 'starred') return store.hasMoreStarred
  if (activeFilter.value === 'label') return store.hasMoreLabel
  if (activeFilter.value === 'done') return false // Done uses the pager below
  return store.hasMoreEmails
})

// Done is a page-replacement archive (Newer/Older), not an append list.
const showDonePager = computed(
  () => activeFilter.value === 'done' && (store.donePageIndex > 0 || store.doneHasNext),
)

const isLoadingMore = computed(() => {
  if (activeFilter.value === 'sent') return store.isSentRefreshing
  if (activeFilter.value === 'spam') return store.isSpamRefreshing
  if (activeFilter.value === 'snoozed') return store.isSnoozedRefreshing
  if (activeFilter.value === 'starred') return store.isStarredRefreshing
  if (activeFilter.value === 'label') return store.isLabelRefreshing
  if (activeFilter.value === 'done') return store.isDoneRefreshing
  return store.isRefreshing
})

function loadMore() {
  if (activeFilter.value === 'sent') store.loadMoreSentEmails()
  else if (activeFilter.value === 'spam') store.loadMoreSpamEmails()
  else if (activeFilter.value === 'snoozed') store.loadMoreSnoozedEmails()
  else if (activeFilter.value === 'starred') store.loadMoreStarredEmails()
  else if (activeFilter.value === 'label') store.loadMoreLabelEmails()
  else store.loadMoreEmails()
}

const emailGroups = computed(() => {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const DAY = 24 * 60 * 60 * 1000
  const group = (label, emails) => ({ label, emails })

  // Search results are ranked by relevance server-side; keep them as one flat
  // group so the date bucketing below doesn't reorder them into Today/Earlier.
  if (store.activeSearchQuery) {
    return filteredEmails.value.length ? [group('Results', filteredEmails.value)] : []
  }

  if (activeFilter.value === 'snoozed') {
    const choices = scheduleChoices(now)
    const sameLocalDay = (left, right) =>
      left.getFullYear() === right.getFullYear() &&
      left.getMonth() === right.getMonth() &&
      left.getDate() === right.getDate()
    const groups = new Map()
    const byScheduledFor = [...filteredEmails.value].sort(
      (left, right) => new Date(left.scheduledFor) - new Date(right.scheduledFor),
    )

    for (const email of byScheduledFor) {
      const scheduledFor = new Date(email.scheduledFor)
      const choice = choices.find(({ date }) => sameLocalDay(date, scheduledFor))
      const label =
        choice?.label ??
        scheduledFor.toLocaleDateString('en-GB', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
        })
      if (!groups.has(label)) groups.set(label, [])
      groups.get(label).push(email)
    }

    return [...groups].map(([label, emails]) => group(label, emails))
  }

  // The Done archive groups by calendar day; the store's pager guarantees a
  // day never spans two pages, so each group is always complete.
  if (activeFilter.value === 'done') {
    const groups = new Map()
    for (const email of filteredEmails.value) {
      const sentAt = new Date(email.sentAt)
      const label =
        sentAt.getTime() >= startOfToday
          ? 'Today'
          : sentAt.getTime() >= startOfToday - DAY
            ? 'Yesterday'
            : sentAt.toLocaleDateString('en-GB', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                ...(sentAt.getFullYear() !== now.getFullYear() && { year: 'numeric' }),
              })
      if (!groups.has(label)) groups.set(label, [])
      groups.get(label).push(email)
    }
    return [...groups].map(([label, emails]) => group(label, emails))
  }

  const today = []
  const dueToday = []
  const yesterday = []
  const lastSevenDays = []
  const earlier = []
  for (const email of filteredEmails.value) {
    const scheduledFor = email.scheduledFor ? new Date(email.scheduledFor).getTime() : null
    if (
      !activeFilter.value &&
      !store.activeSearchQuery &&
      ((scheduledFor && scheduledFor <= now) || email.followUpAt)
    ) {
      dueToday.push(email)
      continue
    }
    const sentAt = new Date(email.sentAt).getTime()
    if (sentAt >= startOfToday) today.push(email)
    else if (sentAt >= startOfToday - DAY) yesterday.push(email)
    else if (sentAt >= startOfToday - 7 * DAY) lastSevenDays.push(email)
    else earlier.push(email)
  }
  const groups = []
  if (dueToday.length) groups.push(group('Due Today', dueToday))
  if (today.length) groups.push(group('Today', today))
  if (yesterday.length) groups.push(group('Yesterday', yesterday))
  if (lastSevenDays.length) groups.push(group('Last seven days', lastSevenDays))
  if (earlier.length) groups.push(group('Earlier', earlier))
  return groups
})

const flatEmails = computed(() => emailGroups.value.flatMap((g) => g.emails))

// Separated from emailGroups so a single email's unread toggle only
// recomputes these counts, not the entire grouping cascade (flatEmails,
// selectedEmails, openIndex).
const groupUnreadCounts = computed(() => {
  const counts = {}
  for (const g of emailGroups.value) {
    counts[g.label] = g.emails.filter((e) => e.unread).length
  }
  return counts
})

// Due Today and Today start open; every older day group starts closed.
const openGroups = ref(new Set(['Due Today', 'Today']))

function isGroupOpen(label) {
  // Search results and filtered views always show expanded; the accordion
  // applies to browsing the full inbox.
  if (store.activeSearchQuery || activeFilter.value) return true
  return openGroups.value.has(label)
}

function toggleGroup(label) {
  const next = new Set(openGroups.value)
  if (next.has(label)) next.delete(label)
  else next.add(label)
  openGroups.value = next
}

function toggleStar(email) {
  store.toggleStar(email)
}

function toggleUnread(email) {
  store.setUnread(email, !email.unread)
}

// Marks every unread email of one day group as read (each persists via the
// store's optimistic per-email setUnread, which reverts on failure).
function markGroupRead(group) {
  for (const email of group.emails.filter((e) => e.unread)) {
    store.setUnread(email, false)
  }
}

function removeEmail(email) {
  store.archiveEmail(email)
}

// --- Multi-select (row checkboxes) ---
// Local view state: ids picked via the row checkboxes. selectedEmails maps
// them back through the visible list, so ids that leave the list (archived,
// filtered away) drop out on their own.
const selectedIds = ref(new Set())

const selectedEmails = computed(() => flatEmails.value.filter((e) => selectedIds.value.has(e.id)))

function isSelected(email) {
  return selectedIds.value.has(email.id)
}

function toggleSelect(email) {
  const next = new Set(selectedIds.value)
  if (next.has(email.id)) next.delete(email.id)
  else next.add(email.id)
  selectedIds.value = next
}

function clearSelection() {
  selectedIds.value = new Set()
}

function markSelectedDone() {
  const emails = [...selectedEmails.value]
  const undoActions = []
  for (const email of emails) {
    store.archiveEmail(email, false, undoActions)
  }
  clearSelection()
  store.notify(
    `${emails.length} ${emails.length === 1 ? 'email' : 'emails'} marked done.`,
    'info',
    {
      label: 'Undo',
      run: () => Promise.all(undoActions.toReversed().map((undo) => undo())),
    },
  )
}

// Stars the whole selection; if every selected email is already starred the
// action unstars them instead (same flip semantics as the row star).
function starSelected() {
  const emails = selectedEmails.value
  const target = !emails.every((e) => e.starred)
  for (const email of emails) {
    if (email.starred !== target) store.toggleStar(email)
  }
  clearSelection()
}

// Marks every selected email as read.
function markSelectedRead() {
  for (const email of selectedEmails.value) {
    if (email.unread) store.setUnread(email, false)
  }
  clearSelection()
  store.notify('Marked as read.')
}

// Soft-deletes every selected email.
function deleteSelected() {
  const emails = [...selectedEmails.value]
  const undoActions = []
  for (const email of emails) {
    store.deleteEmail(email, false, undoActions)
  }
  clearSelection()
  store.notify(`${emails.length} ${emails.length === 1 ? 'email' : 'emails'} deleted.`, 'info', {
    label: 'Undo',
    run: () => Promise.all(undoActions.toReversed().map((undo) => undo())),
  })
}

// Applies a label to every selected email. Unlike toggleTag (which toggles),
// bulk-label always adds because the selection may be a mix.
const bulkLabelOpen = ref(false)

function labelSelected(label) {
  const emails = [...selectedEmails.value]
  bulkLabelOpen.value = false
  for (const email of emails) {
    const alreadyApplied = (email.labels || []).some((l) => l.name === label.name)
    if (!alreadyApplied) store.toggleMessageLabel(email, label)
  }
  clearSelection()
  store.notify(`Label "${label.name}" applied.`)
}

const bulkScheduleOpen = ref(false)
const readerScheduleOpen = ref(false)
const readerFollowUpOpen = ref(false)
const replyFollowUpOpen = ref(false)
const readerTagOpen = ref(false)
// Depends on the menus' open flags so the presets recompute from the current
// clock each time a menu opens — with no reactive deps this cached its
// "Later today"/"Tomorrow" dates once at mount for the whole session.
const scheduleOptions = computed(() =>
  bulkScheduleOpen.value ||
  readerScheduleOpen.value ||
  readerFollowUpOpen.value ||
  replyFollowUpOpen.value
    ? scheduleChoices()
    : [],
)

// Reader tag menu: whether a palette label is already on the open email (matched
// by name, since the email's labels carry name/color/kind but not id).
function isLabelApplied(label) {
  return openEmail.value?.labels?.some((l) => l.name === label.name) ?? false
}

function toggleTag(label) {
  store.toggleMessageLabel(openEmail.value, label)
}

async function scheduleSelected(choice) {
  const emails = [...selectedEmails.value]
  const undoActions = []
  bulkScheduleOpen.value = false
  clearSelection()
  const results = await Promise.all(
    emails.map((email) =>
      store.scheduleEmail(email, choice.date.toISOString(), choice.label, false, undoActions),
    ),
  )
  const scheduledCount = results.filter(Boolean).length
  if (scheduledCount) {
    store.notify(
      `${scheduledCount} ${scheduledCount === 1 ? 'email' : 'emails'} scheduled for ${choice.label}.`,
      'info',
      {
        label: 'Undo',
        run: () => Promise.all(undoActions.toReversed().map((undo) => undo())),
      },
    )
  }
}

// --- Reading panel (open-email state lives in the store so the command
// palette can act on it globally) ---
const openEmail = computed(() => store.openEmail)

// The AI Inbox's triage rows link here as /inbox?open=<message id>. The list
// is usually still in flight when the route lands, so this waits for the email
// to arrive rather than giving up on the first miss. Each id opens once, so
// closing the reader does not immediately reopen it.
const requestedEmailId = computed(() => (route.query.open ? String(route.query.open) : ''))
let openedFromRoute = ''

watch(
  [requestedEmailId, () => store.emailById(requestedEmailId.value)],
  ([id, email]) => {
    if (!id) {
      openedFromRoute = ''
      return
    }
    if (!email || openedFromRoute === id) return
    openedFromRoute = id
    store.openReader(email)
  },
  { immediate: true },
)
const openEmailCalendarSuggestion = computed(() =>
  detectCalendarSuggestion(
    openEmail.value ? { ...openEmail.value, body: store.openEmailText } : null,
  ),
)
const openEmailCalendarSuggestionLabel = computed(() =>
  formatCalendarSuggestion(openEmailCalendarSuggestion.value),
)
// Sanitized-and-sandboxed HTML rendering is driven by the on-demand body
// fetch; null until it lands (reader shows body_text meanwhile) or when the
// message has no HTML body (permanent text fallback).
const openEmailHtml = computed(() => store.openEmailHtml)
// Earlier messages in the open email's conversation, shown as collapsed
// cards above it (expand-in-place to plain text) — a lightweight threaded
// view. Reset per open so a previous email's expanded state never leaks.
const threadHistory = computed(() => store.openEmailThread)
const expandedThreadIds = ref(new Set())
watch(
  () => store.openEmailId,
  () => {
    expandedThreadIds.value = new Set()
  },
)
function toggleThreadMessage(message) {
  const { id } = message
  const next = new Set(expandedThreadIds.value)
  if (next.has(id)) next.delete(id)
  else {
    next.add(id)
    store.fetchThreadMessageBody(message)
  }
  expandedThreadIds.value = next
}

// The open email's attachments. Private Blob URLs stay server-side; legacy
// metadata-only rows remain inert while stored attachments become buttons.
const openEmailAttachments = computed(() => store.openEmailAttachments)

function attachmentIcon(contentType) {
  if (!contentType) return 'attach_file'
  if (contentType.startsWith('image/')) return 'image'
  if (contentType.startsWith('video/')) return 'movie'
  if (contentType.startsWith('audio/')) return 'audiotrack'
  if (contentType === 'application/pdf') return 'picture_as_pdf'
  if (contentType.includes('zip') || contentType.includes('compressed')) return 'folder_zip'
  return 'draft'
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes)) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
// RFC header metadata wins. When it is confirmed absent, EmailBody may supply
// a validated manual link discovered in the rendered message content.
const contentUnsubscribe = ref(null)
const openEmailUnsubscribe = computed(
  () => store.openEmailUnsubscribe ?? (store.isOpenBodyResolved ? contentUnsubscribe.value : null),
)
const isUnsubscribed = computed(() => store.openEmailUnsubscribed)
const isUnsubscribing = computed(() => store.unsubscribingId === store.openEmailId)
const openEmailSummary = computed(() => store.openEmailSummary)
const isSummarizing = computed(() => store.isOpenSummaryLoading)
const summarizeLabel = computed(() => {
  if (isSummarizing.value) return 'Summarizing…'
  return openEmailSummary.value ? 'Regenerate Summary' : 'Summarize'
})
const isReplyOpen = ref(false)
// The reply uses the same rich editor as compose: html is what gets sent
// (sanitized at the send boundary), the plain text mirrors it for validation
// and the text/plain part.
const replyHtml = ref('')
const replyTextPlain = ref('')
const replyFollowUpAt = ref(null)
const isSendingReply = ref(false)
const replyEditorRef = ref(null)
const FOLLOW_UP_FMT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})
const replyFollowUpLabel = computed(() =>
  replyFollowUpAt.value ? FOLLOW_UP_FMT.format(new Date(replyFollowUpAt.value)) : 'Remind me',
)

function openReader(email) {
  // Opening a message takes over from any text field it was launched from
  // (e.g. the search bar — result rows aren't focusable, so a click leaves
  // focus in the input). Release that focus so single-key shortcuts like 'd'
  // aren't swallowed as typing while the reader is open.
  const active = document.activeElement
  if (active?.closest?.('input, textarea, select, [contenteditable="true"]')) {
    active.blur()
  }

  // Auto-advance can cross from an expanded day into a collapsed one. Open
  // the destination group as well so the row behind the reader stays visible.
  if (!store.activeSearchQuery && !activeFilter.value) {
    const group = emailGroups.value.find(({ emails }) =>
      emails.some((candidate) => candidate.id === email.id),
    )
    if (group && !openGroups.value.has(group.label)) {
      openGroups.value = new Set(openGroups.value).add(group.label)
    }
  }
  store.openReader(email)
}

function closeReader() {
  readerTagOpen.value = false
  store.closeReader()
}

// Reset reply state whenever the open email changes or closes, including
// changes made from outside this view (e.g. the command palette).
watch(
  () => store.openEmailId,
  (id) => {
    isReplyOpen.value = false
    replyHtml.value = ''
    replyTextPlain.value = ''
    replyFollowUpAt.value = null
    replyFollowUpOpen.value = false
    readerFollowUpOpen.value = false
    readerTagOpen.value = false
    contentUnsubscribe.value = null
    // Fetch the full body on demand (cached) for any open path, including the
    // command palette.
    if (id) store.fetchMessageBody(id)
  },
)

watch(filteredEmails, (emails) => {
  if (openEmail.value && !emails.some((email) => email.id === openEmail.value.id)) {
    closeReader()
  }
})

const openIndex = computed(() => flatEmails.value.indexOf(openEmail.value))

// Archives the open email and auto-advances the reader to the email that
// followed it (or the new last one when the archived email was last); the
// reader only closes when the list is now empty.
function archiveOpenEmail() {
  if (!openEmail.value) return
  const index = openIndex.value
  removeEmail(openEmail.value)
  const remaining = flatEmails.value
  const next = remaining[index] ?? remaining[remaining.length - 1]
  if (next) {
    openReader(next)
  }
}

function unsubscribeOpenEmail() {
  const email = openEmail.value
  if (!email) return
  store.unsubscribeEmail(email)
  store.archiveEmail(email)
}

function unsubscribeFromContent() {
  if (openEmail.value) store.archiveEmail(openEmail.value)
}

function setContentUnsubscribe(target) {
  contentUnsubscribe.value = target
}

function summarizeOpenEmail() {
  store.summarizeEmail(openEmail.value)
}

function addOpenEmailToCalendar() {
  if (!openEmailCalendarSuggestion.value) return
  store.requestCalendarNewEvent(openEmailCalendarSuggestion.value)
  router.push({ name: 'calendar' })
}

function starOpenEmail() {
  if (!openEmail.value) return
  toggleStar(openEmail.value)
}

async function scheduleOpenEmail(choice) {
  if (!openEmail.value) return
  const email = openEmail.value
  const index = openIndex.value
  readerScheduleOpen.value = false
  const scheduled = await store.scheduleEmail(email, choice.date.toISOString(), choice.label)
  if (!scheduled) return
  const remaining = flatEmails.value
  const next = remaining[index] ?? remaining[remaining.length - 1]
  if (next) openReader(next)
}

async function setOpenEmailFollowUp(choice) {
  if (!openEmail.value) return
  readerFollowUpOpen.value = false
  try {
    await store.setMessageFollowUp(openEmail.value, choice.date.toISOString())
    store.notify(`Reminder set for ${choice.label}.`)
  } catch (error) {
    console.error('Failed to set follow-up reminder:', error)
    store.notify('Failed to set reminder. The thread may already have a reply.', 'error')
  }
}

async function clearOpenEmailFollowUp() {
  if (!openEmail.value) return
  readerFollowUpOpen.value = false
  try {
    await store.setMessageFollowUp(openEmail.value, null)
    store.notify('Reminder cleared.')
  } catch (error) {
    console.error('Failed to clear follow-up reminder:', error)
    store.notify('Failed to clear reminder.', 'error')
  }
}

function replyToOpenEmail() {
  isReplyOpen.value = true
  nextTick(() => replyEditorRef.value?.focus())
}

function discardReply() {
  isReplyOpen.value = false
  replyHtml.value = ''
  replyTextPlain.value = ''
  replyFollowUpAt.value = null
  replyFollowUpOpen.value = false
}

function selectReplyFollowUp(choice) {
  replyFollowUpAt.value = choice.date.toISOString()
  replyFollowUpOpen.value = false
}

function clearReplyFollowUp() {
  replyFollowUpAt.value = null
  replyFollowUpOpen.value = false
}

// The "/generate" command escalates to the composer window prefilled as a
// reply — the AI draft review sidebar lives there, so the reply gains the
// full compose flow (draft preview, schedule send, undo) instead of a
// duplicated one.
function generateReplyDraft() {
  const email = openEmail.value
  if (!email) return
  store.composerTo = email.address
  store.composerSubject = `Re: ${email.subject}`
  store.composerReplyToMessageId = email.id
  store.composerHtml = replyHtml.value
  store.composerTextArea = replyTextPlain.value
  store.composerFollowUpAt = replyFollowUpAt.value
  discardReply()
  store.openComposer()
  store.openAiDraft()
}

async function sendReply() {
  if (isSendingReply.value) return
  const email = openEmail.value
  isSendingReply.value = true
  try {
    const result = await store.sendMail({
      to: email.address,
      subject: `Re: ${email.subject}`,
      text: replyTextPlain.value,
      // Sanitize the rich body once, here at the send boundary (same as the
      // composer's send path).
      html: sanitizeEmailHtml(replyHtml.value),
      replyToMessageId: email.id,
      followUpAt: replyFollowUpAt.value,
    })
    discardReply()
    store.notify(
      result?.followUpScheduled === false
        ? 'Reply sent, but the reminder could not be saved.'
        : 'Reply sent.',
      result?.followUpScheduled === false ? 'error' : 'info',
    )
  } catch (error) {
    console.error('Failed to send reply:', error)
    store.notify('Failed to send reply. Please try again.', 'error')
  } finally {
    isSendingReply.value = false
  }
}

// Outbound rows (Sent view, and sent copies surfaced by search) show who the
// mail went to; inbound rows show who it came from.
function rowSender(email) {
  return email.isSent ? `To: ${email.to ?? email.address}` : email.sender
}

// Hoisted once — toLocaleString with options constructs a DateTimeFormat
// internally on every call, which is expensive when rendering N Sent rows.
const READ_RECEIPT_FMT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

function readReceiptTitle(email) {
  if (!email.readAt) return 'Sent — not opened yet'
  return `Opened ${READ_RECEIPT_FMT.format(new Date(email.readAt))}`
}

// Keyboard shortcuts must not fire while the user is typing (reply textarea,
// search bar, composer, command palette input, ...).
function isTypingTarget(target) {
  return Boolean(target?.closest?.('input, textarea, select, [contenteditable="true"]'))
}

function onKeydown(e) {
  // The command palette owns Escape while it is open. Otherwise Escape
  // unchecks the multi-select first; a second press closes the reader.
  if (e.key === 'Escape' && !store.isCommandPaletteOpen) {
    if (selectedIds.value.size) {
      clearSelection()
    } else if (openEmail.value) {
      closeReader()
    }
  }

  // Bulk-action shortcuts fire when items are multi-selected.
  // e → archive/done, Shift+I → mark read, # → delete, l → label menu.
  if (
    selectedIds.value.size &&
    !e.repeat &&
    !e.metaKey &&
    !e.ctrlKey &&
    !e.altKey &&
    !store.isCommandPaletteOpen &&
    !isTypingTarget(e.target)
  ) {
    if (e.key === 'e') {
      e.preventDefault()
      markSelectedDone()
      return
    }
    if (e.key === 'I' && e.shiftKey) {
      e.preventDefault()
      markSelectedRead()
      return
    }
    if (e.key === '#') {
      e.preventDefault()
      deleteSelected()
      return
    }
    if (e.key === 'l') {
      e.preventDefault()
      bulkLabelOpen.value = !bulkLabelOpen.value
      return
    }
  }

  // 'd' archives the email open in the reader. Plain keypress only — modified
  // combos (Cmd+D bookmark, etc.) stay with the browser. e.repeat is ignored:
  // with auto-advance, a held key would chain-archive emails the user never
  // saw (one press, one archive).
  if (
    e.key === 'd' &&
    !e.repeat &&
    !e.metaKey &&
    !e.ctrlKey &&
    !e.altKey &&
    openEmail.value &&
    !store.isCommandPaletteOpen &&
    !isTypingTarget(e.target)
  ) {
    e.preventDefault()
    archiveOpenEmail()
  }
}

// Re-enter the normal document-level shortcut pipeline for key presses that
// originated inside the isolated HTML-email frame. This lets the reader and
// other global shortcut owners apply their existing guards in one place.
function forwardEmailKeydown(event) {
  document.dispatchEvent(event)
}

function onDocumentClick(e) {
  const clickedReader = e.composedPath().some((node) => node?.classList?.contains('ni-reader'))
  if (!e.target.closest('.ni-schedule-wrap')) {
    bulkScheduleOpen.value = false
    bulkLabelOpen.value = false
    readerScheduleOpen.value = false
    readerFollowUpOpen.value = false
    replyFollowUpOpen.value = false
  }
  if (!e.target.closest('.ni-tag-wrap')) {
    readerTagOpen.value = false
  }
  // Clicks inside the command palette must not close the reader — its
  // email commands read the open email as they run.
  if (!openEmail.value || store.isCommandPaletteOpen) return
  // Clicks inside the panel keep it open; clicks on rows are handled by
  // openReader; the bulk bar acts on the list without dismissing the reader.
  if (
    clickedReader ||
    e.target.closest('.ni-reader') ||
    e.target.closest('.ni-row') ||
    e.target.closest('.ni-bulk-bar')
  ) {
    return
  }
  closeReader()
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  document.addEventListener('click', onDocumentClick)
})
onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
  document.removeEventListener('click', onDocumentClick)
})
</script>

<template>
  <div class="view-panel active" id="traditionalInboxView">
    <!-- Header -->
    <div class="ni-header">
      <div class="ni-title">
        <span class="material-symbols-outlined ni-title-icon" :style="headerIconStyle">{{
          headerIcon
        }}</span>
        <h1>{{ headerTitle }}</h1>
      </div>
    </div>

    <!-- Email list -->
    <div class="ni-list">
      <template v-for="group in emailGroups" :key="group.label">
        <button
          class="ni-group-header"
          :class="{ collapsed: !isGroupOpen(group.label) }"
          :aria-expanded="isGroupOpen(group.label)"
          @click="toggleGroup(group.label)"
        >
          <span class="material-symbols-outlined ni-group-chevron">expand_more</span>
          <span>{{ group.label }}</span>
          <!-- Hovering (or focusing) the badge reveals a tooltip button that
               marks the whole day read. role=button spans: a real <button>
               may not nest inside the group-header button. -->
          <span class="ni-group-count-wrap" v-if="groupUnreadCounts[group.label]">
            <span class="ni-group-count">{{ groupUnreadCounts[group.label] }}</span>
            <span
              class="ni-group-mark-read"
              role="button"
              tabindex="0"
              :aria-label="`Mark ${group.label} emails as read`"
              @click.stop="markGroupRead(group)"
              @keydown.enter.stop.prevent="markGroupRead(group)"
            >
              <span class="material-symbols-outlined">mark_email_read</span>
              Mark Read
            </span>
          </span>
        </button>
        <!-- Handlers are stable function references on purpose: inline
             arrows would get a new identity on every parent render and
             defeat EmailRow's props-equality re-render skip. -->
        <EmailRow
          v-for="email in isGroupOpen(group.label) ? group.emails : []"
          :key="email.id"
          :email="email"
          :sender="rowSender(email)"
          :read-receipt-title="email.isSent ? readReceiptTitle(email) : ''"
          :checked="isSelected(email)"
          :open="openEmail === email"
          :has-ai-summary="emailHasAiSummary(email)"
          :show-done="activeFilter !== 'done'"
          @open="openReader"
          @toggle-select="toggleSelect"
          @toggle-star="toggleStar"
          @done="removeEmail"
          @toggle-unread="toggleUnread"
        />
      </template>
      <div class="ni-empty" v-if="activeFilter && !filteredEmails.length">
        {{ emptyText }}
      </div>
      <div class="ni-inbox-zero" v-if="showInboxZero" role="status" aria-live="polite">
        <span class="material-symbols-outlined ni-inbox-zero-icon" aria-hidden="true"
          >task_alt</span
        >
        <h2>Welcome to Inbox Zero</h2>
      </div>
      <button v-if="showLoadMore" class="ni-load-more" :disabled="isLoadingMore" @click="loadMore">
        {{ isLoadingMore ? 'Loading…' : 'Load more' }}
      </button>
      <div v-if="showDonePager" class="ni-pager">
        <button
          class="ni-load-more ni-pager-btn"
          :disabled="store.donePageIndex === 0 || store.isDoneRefreshing"
          @click="store.prevDonePage()"
        >
          ‹ Newer
        </button>
        <span class="ni-pager-page">Page {{ store.donePageIndex + 1 }}</span>
        <button
          class="ni-load-more ni-pager-btn"
          :disabled="!store.doneHasNext || store.isDoneRefreshing"
          @click="store.nextDonePage()"
        >
          Older ›
        </button>
      </div>
    </div>

    <!-- Bulk action bar: floats over the list while any row is checked -->
    <Transition name="ni-bulk">
      <div class="ni-bulk-bar" v-if="selectedEmails.length">
        <span class="ni-bulk-count">{{ selectedEmails.length }} selected</span>
        <button class="ni-bulk-pill" @click="starSelected">
          <span class="material-symbols-outlined">star</span>
          <span>Star</span>
        </button>
        <button v-if="activeFilter !== 'done'" class="ni-bulk-pill" @click="markSelectedDone">
          <span class="material-symbols-outlined">check_box</span>
          <span>Done</span>
        </button>
        <div v-if="activeFilter !== 'done'" class="ni-schedule-wrap ni-schedule-wrap-bulk">
          <button
            class="ni-bulk-pill"
            aria-haspopup="menu"
            :aria-expanded="bulkScheduleOpen"
            @click="bulkScheduleOpen = !bulkScheduleOpen"
          >
            <span class="material-symbols-outlined">schedule</span>
            <span>Reschedule</span>
          </button>
          <ScheduleMenu
            v-if="bulkScheduleOpen"
            :choices="scheduleOptions"
            @select="scheduleSelected"
          />
        </div>
        <button class="ni-bulk-pill" @click="markSelectedRead">
          <span class="material-symbols-outlined">mark_email_read</span>
          <span>Mark Read</span>
        </button>
        <div class="ni-schedule-wrap ni-schedule-wrap-bulk">
          <button
            class="ni-bulk-pill"
            aria-haspopup="menu"
            :aria-expanded="bulkLabelOpen"
            @click="bulkLabelOpen = !bulkLabelOpen"
          >
            <span class="material-symbols-outlined">sell</span>
            <span>Label</span>
          </button>
          <div v-if="bulkLabelOpen" class="ni-schedule-menu" role="menu">
            <button
              v-for="label in store.allLabels"
              :key="label.id"
              role="menuitem"
              @click="labelSelected(label)"
            >
              <span class="ni-label-dot" :style="{ background: label.color }"></span>
              <span>{{ label.name }}</span>
            </button>
            <span v-if="!store.allLabels.length" class="ni-schedule-menu-empty">No labels yet</span>
          </div>
        </div>
        <button class="ni-bulk-pill ni-bulk-pill--danger" @click="deleteSelected">
          <span class="material-symbols-outlined">delete</span>
          <span>Delete</span>
        </button>
      </div>
    </Transition>

    <!-- Reading panel -->
    <Transition name="ni-slide">
      <div class="ni-reader" v-if="openEmail">
        <div class="ni-reader-topbar">
          <div class="ni-reader-nav">
            <button
              class="ni-summarize-btn"
              :title="summarizeLabel"
              :disabled="isSummarizing"
              :aria-busy="isSummarizing"
              @click="summarizeOpenEmail"
            >
              <span v-if="isSummarizing" class="ni-summary-spinner" aria-hidden="true"></span>
              <span v-else class="material-symbols-outlined">auto_awesome</span>
              <span>{{ summarizeLabel }}</span>
            </button>
          </div>
          <div class="ni-reader-nav">
            <button
              class="ni-reader-btn"
              :class="{ starred: openEmail.starred }"
              :title="openEmail.starred ? 'Unstar' : 'Star'"
              :aria-label="openEmail.starred ? 'Unstar' : 'Star'"
              :aria-pressed="openEmail.starred"
              @click="starOpenEmail"
            >
              <span class="material-symbols-outlined">{{
                openEmail.starred ? 'star' : 'star_border'
              }}</span>
            </button>
            <button
              v-if="activeFilter !== 'done'"
              class="ni-reader-btn"
              title="Done"
              @click="archiveOpenEmail"
            >
              <span class="material-symbols-outlined">check_box</span>
            </button>
            <div v-if="openEmail.isSent" class="ni-schedule-wrap">
              <button
                class="ni-reader-btn"
                :class="{ active: openEmail.followUpAt }"
                :title="
                  openEmail.followUpAt
                    ? `Follow-up reminder: ${FOLLOW_UP_FMT.format(new Date(openEmail.followUpAt))}`
                    : 'Remind me if no reply'
                "
                aria-haspopup="menu"
                :aria-expanded="readerFollowUpOpen"
                @click="readerFollowUpOpen = !readerFollowUpOpen"
              >
                <span class="material-symbols-outlined">{{
                  openEmail.followUpAt ? 'notifications_active' : 'notification_add'
                }}</span>
              </button>
              <ScheduleMenu
                v-if="readerFollowUpOpen"
                :choices="scheduleOptions"
                submit-label="Remind me"
                custom-label="Custom follow-up time"
                :clear-label="openEmail.followUpAt ? 'Clear reminder' : ''"
                @select="setOpenEmailFollowUp"
                @clear="clearOpenEmailFollowUp"
              />
            </div>
            <div v-else-if="activeFilter !== 'done'" class="ni-schedule-wrap">
              <button
                class="ni-reader-btn"
                title="Reschedule"
                aria-haspopup="menu"
                :aria-expanded="readerScheduleOpen"
                @click="readerScheduleOpen = !readerScheduleOpen"
              >
                <span class="material-symbols-outlined">schedule</span>
              </button>
              <ScheduleMenu
                v-if="readerScheduleOpen"
                :choices="scheduleOptions"
                @select="scheduleOpenEmail"
              />
            </div>
            <div class="ni-tag-wrap">
              <button
                class="ni-reader-btn"
                title="Tag"
                aria-label="Add tags"
                aria-haspopup="menu"
                :aria-expanded="readerTagOpen"
                @click="readerTagOpen = !readerTagOpen"
              >
                <span class="material-symbols-outlined">sell</span>
              </button>
              <div v-if="readerTagOpen" class="ni-tag-menu" role="menu">
                <button
                  v-for="label in store.allLabels"
                  :key="label.id"
                  role="menuitemcheckbox"
                  :aria-checked="isLabelApplied(label)"
                  class="ni-tag-item"
                  :class="{ applied: isLabelApplied(label) }"
                  @click="toggleTag(label)"
                >
                  <span class="ni-tag-dot" :style="{ backgroundColor: label.color }"></span>
                  <span class="ni-tag-name">{{ label.name }}</span>
                  <span
                    v-if="isLabelApplied(label)"
                    class="material-symbols-outlined ni-tag-check"
                    aria-hidden="true"
                    >check</span
                  >
                </button>
                <p v-if="!store.allLabels.length" class="ni-tag-empty">
                  No labels yet. Create them in Settings → Labels.
                </p>
              </div>
            </div>
            <a
              v-if="openEmailUnsubscribe?.source === 'content'"
              class="ni-unsub-btn"
              title="Unsubscribe"
              :href="openEmailUnsubscribe.href"
              target="_blank"
              rel="noopener noreferrer"
              @click="unsubscribeFromContent"
            >
              <span class="material-symbols-outlined">unsubscribe</span>
              <span>Unsubscribe</span>
            </a>
            <button
              v-else-if="openEmailUnsubscribe"
              class="ni-unsub-btn"
              title="Unsubscribe"
              :disabled="isUnsubscribing || isUnsubscribed"
              @click="unsubscribeOpenEmail"
            >
              <span class="material-symbols-outlined">unsubscribe</span>
              <span>{{ isUnsubscribed ? 'Unsubscribed' : 'Unsubscribe' }}</span>
            </button>
          </div>
        </div>

        <h2 class="ni-reader-subject">
          <span
            v-if="emailHasAiSummary(openEmail)"
            class="material-symbols-outlined ni-ai-generated-icon"
            aria-hidden="true"
            >auto_awesome</span
          >
          <span class="ni-reader-subject-text">{{ openEmail.subject }}</span>
        </h2>

        <div
          class="ni-reader-labels"
          :class="{ 'ni-reader-labels-summary': openEmailSummary }"
          v-if="openEmail.labels?.length"
        >
          <span
            v-for="label in openEmail.labels"
            :key="label.name"
            class="ni-label-pill"
            :style="{ color: label.color, backgroundColor: label.color + '1f' }"
          >
            {{ label.name }}
          </span>
        </div>

        <section
          v-if="openEmailCalendarSuggestion"
          class="ni-calendar-suggestion"
          aria-label="Calendar suggestion"
        >
          <span class="material-symbols-outlined ni-calendar-suggestion-icon" aria-hidden="true">
            event_available
          </span>
          <div class="ni-calendar-suggestion-copy">
            <strong>Event detected</strong>
            <span>{{ openEmailCalendarSuggestionLabel }}</span>
          </div>
          <button
            type="button"
            class="ni-calendar-suggestion-action"
            @click="addOpenEmailToCalendar"
          >
            Add to calendar
          </button>
        </section>

        <div v-if="openEmailSummary" class="ni-summary-box" role="status" aria-live="polite">
          <div class="ni-summary-heading">
            <span class="material-symbols-outlined" aria-hidden="true">auto_awesome</span>
            <span>AI summary</span>
          </div>
          <p>{{ openEmailSummary }}</p>
        </div>

        <div v-if="threadHistory.length" class="ni-thread-history" aria-label="Earlier messages">
          <button
            v-for="message in threadHistory"
            :key="message.id"
            type="button"
            class="ni-thread-message"
            :class="{ expanded: expandedThreadIds.has(message.id) }"
            :aria-expanded="expandedThreadIds.has(message.id)"
            @click="toggleThreadMessage(message)"
          >
            <div class="ni-thread-message-summary">
              <span class="ni-thread-message-sender">{{
                message.from_name || message.from_address
              }}</span>
              <span class="ni-thread-message-time">{{ formatEmailDate(message.sent_at) }}</span>
              <span class="material-symbols-outlined ni-thread-message-chevron" aria-hidden="true">
                {{ expandedThreadIds.has(message.id) ? 'expand_less' : 'expand_more' }}
              </span>
            </div>
            <p v-if="!expandedThreadIds.has(message.id)" class="ni-thread-message-snippet">
              {{ message.snippet }}
            </p>
            <p v-else class="ni-thread-message-body">{{ message.body_text ?? 'Loading…' }}</p>
          </button>
        </div>

        <div class="ni-email-card">
          <div class="ni-email-card-header">
            <div class="ni-email-meta">
              <div>
                <span class="ni-email-sender">{{ openEmail.sender }}</span>
                <span class="ni-email-address">{{ openEmail.address }}</span>
              </div>
              <div class="ni-email-to">
                {{ openEmail.isSent ? `To ${openEmail.to ?? openEmail.address}` : 'To me' }}
                <span class="material-symbols-outlined">unfold_more</span>
              </div>
            </div>
            <div class="ni-email-header-right">
              <button class="ni-reader-btn" title="Reply" @click="replyToOpenEmail">
                <span class="material-symbols-outlined">reply</span>
              </button>
              <span class="ni-email-time">{{ openEmail.date }}</span>
              <span
                v-if="openEmail.isSent"
                class="ni-read-status ni-read-status-reader"
                :class="{ opened: openEmail.readAt }"
                :title="readReceiptTitle(openEmail)"
              >
                <span class="material-symbols-outlined" aria-hidden="true">{{
                  openEmail.readAt ? 'done_all' : 'check'
                }}</span>
                {{ openEmail.readAt ? readReceiptTitle(openEmail) : 'Not opened' }}
              </span>
            </div>
          </div>
          <EmailBody
            :key="openEmail.id"
            :html="openEmailHtml"
            :text="store.openEmailText"
            :sender="openEmail.sender"
            :has-html-body="openEmail.hasHtml"
            :loading="store.isOpenBodyLoading"
            :body-resolved="store.isOpenBodyResolved"
            @keydown="forwardEmailKeydown"
            @unsubscribe-link="setContentUnsubscribe"
          />

          <div v-if="openEmailAttachments.length" class="ni-attachments" aria-label="Attachments">
            <component
              :is="attachment.downloadable ? 'button' : 'div'"
              v-for="attachment in openEmailAttachments"
              :key="attachment.id"
              class="ni-attachment"
              :type="attachment.downloadable ? 'button' : undefined"
              :title="
                attachment.downloadable
                  ? `Download ${attachment.filename}`
                  : `${attachment.filename} (download not yet available)`
              "
              @click="attachment.downloadable && store.downloadAttachment(attachment)"
            >
              <span class="material-symbols-outlined ni-attachment-icon" aria-hidden="true">
                {{ attachmentIcon(attachment.content_type) }}
              </span>
              <span class="ni-attachment-name">{{ attachment.filename || 'Attachment' }}</span>
              <span v-if="attachment.size_bytes != null" class="ni-attachment-size">{{
                formatFileSize(attachment.size_bytes)
              }}</span>
            </component>
          </div>
        </div>

        <!-- Inline reply box -->
        <Transition name="ni-reply">
          <div class="ni-reply-box" v-if="isReplyOpen">
            <div class="ni-reply-header">
              <span class="material-symbols-outlined">reply</span>
              <span>Reply to {{ openEmail.sender }}</span>
            </div>
            <ComposerEditor
              ref="replyEditorRef"
              v-model="replyHtml"
              placeholder="Write your reply, or type “/” for commands…"
              :snippets="store.snippets"
              @update:text="replyTextPlain = $event"
              @generate="generateReplyDraft"
            />
            <div class="ni-reply-footer">
              <button
                class="btn btn-primary"
                :disabled="isSendingReply || !replyTextPlain.trim()"
                :aria-busy="isSendingReply"
                @click="sendReply"
              >
                {{ isSendingReply ? 'Sending…' : 'Send' }}
              </button>
              <div class="ni-schedule-wrap ni-schedule-wrap-upward">
                <button
                  type="button"
                  class="btn btn-text ni-follow-up-btn"
                  :class="{ active: replyFollowUpAt }"
                  :disabled="isSendingReply"
                  aria-haspopup="menu"
                  :aria-expanded="replyFollowUpOpen"
                  @click="replyFollowUpOpen = !replyFollowUpOpen"
                >
                  <span class="material-symbols-outlined">notification_add</span>
                  <span>{{ replyFollowUpLabel }}</span>
                </button>
                <ScheduleMenu
                  v-if="replyFollowUpOpen"
                  :choices="scheduleOptions"
                  submit-label="Remind me"
                  custom-label="Custom follow-up time"
                  :clear-label="replyFollowUpAt ? 'Clear reminder' : ''"
                  @select="selectReplyFollowUp"
                  @clear="clearReplyFollowUp"
                />
              </div>
              <button class="btn btn-text" @click="discardReply">Discard</button>
            </div>
          </div>
        </Transition>

        <div class="ni-reader-footer">
          <button class="ni-pill-btn" @click="replyToOpenEmail">
            <span class="material-symbols-outlined">reply</span>
            <span>Reply</span>
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>
