<script setup>
import { computed, ref, nextTick, onMounted, onUnmounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useInboxStore } from '../stores/inbox'
import EmailBody from '../components/EmailBody.vue'
import { scheduleChoices } from '../utils/schedule'

const store = useInboxStore()
const route = useRoute()

// --- Filtered views (?filter=starred|snoozed|sent|drafts|label&label=<name>) ---
// Starred and label views filter the loaded list client-side (rows already
// carry starred + labels; covers loaded pages only). Sent, Spam, and Snoozed
// have server-backed lists loaded lazily when their view opens.
const FILTER_META = {
  starred: { title: 'Starred', icon: 'star', emptyText: 'No starred emails.' },
  snoozed: { title: 'Snoozed', icon: 'schedule', emptyText: 'No snoozed emails yet.' },
  sent: { title: 'Sent', icon: 'send', emptyText: 'No sent emails yet.' },
  spam: { title: 'Spam', icon: 'report', emptyText: 'No spam. Nice and tidy.' },
  drafts: { title: 'Drafts', icon: 'description', emptyText: 'No drafts yet.' },
  label: { title: null, icon: 'sell', emptyText: 'No emails with this label.' },
}
const EMPTY_ONLY_FILTERS = new Set(['drafts'])

const activeFilter = computed(() => (FILTER_META[route.query.filter] ? route.query.filter : null))

// The sent list refreshes on every visit — cheap, and it picks up mail sent
// from other devices since the last look.
watch(
  activeFilter,
  (filter) => {
    if (filter === 'sent') store.loadSentEmails()
    if (filter === 'spam') store.loadSpamEmails()
    if (filter === 'snoozed') store.loadSnoozedEmails()
  },
  { immediate: true },
)

const filteredEmails = computed(() => {
  const emails = store.traditionalEmails
  switch (activeFilter.value) {
    case 'starred':
      return emails.filter((e) => e.starred)
    case 'label':
      return emails.filter((e) => e.labels?.some((l) => l.name === route.query.label))
    case 'sent':
      return store.sentEmails
    case 'spam':
      return store.spamEmails
    case 'snoozed':
      return store.snoozedEmails
    case 'drafts':
      return []
    default:
      return store.activeSearchQuery
        ? emails
        : emails.filter(
            (e) => !e.starred || (e.scheduledFor && new Date(e.scheduledFor).getTime() <= Date.now()),
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

const showLoadMore = computed(() => {
  if (store.activeSearchQuery) return false
  if (activeFilter.value === 'sent') return store.hasMoreSent
  if (activeFilter.value === 'spam') return store.hasMoreSpam
  if (activeFilter.value === 'snoozed') return store.hasMoreSnoozed
  if (EMPTY_ONLY_FILTERS.has(activeFilter.value)) return false
  return store.hasMoreEmails
})

const isLoadingMore = computed(() => {
  if (activeFilter.value === 'sent') return store.isSentRefreshing
  if (activeFilter.value === 'spam') return store.isSpamRefreshing
  if (activeFilter.value === 'snoozed') return store.isSnoozedRefreshing
  return store.isRefreshing
})

function loadMore() {
  if (activeFilter.value === 'sent') store.loadMoreSentEmails()
  else if (activeFilter.value === 'spam') store.loadMoreSpamEmails()
  else if (activeFilter.value === 'snoozed') store.loadMoreSnoozedEmails()
  else store.loadMoreEmails()
}

const emailGroups = computed(() => {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const DAY = 24 * 60 * 60 * 1000
  const group = (label, emails) => ({
    label,
    emails,
    unreadCount: emails.filter((e) => e.unread).length,
  })

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

  const today = []
  const dueToday = []
  const yesterday = []
  const lastSevenDays = []
  const earlier = []
  for (const email of filteredEmails.value) {
    const scheduledFor = email.scheduledFor ? new Date(email.scheduledFor).getTime() : null
    if (!activeFilter.value && !store.activeSearchQuery && scheduledFor && scheduledFor <= now) {
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
  for (const email of selectedEmails.value) {
    store.archiveEmail(email)
  }
  clearSelection()
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

const bulkScheduleOpen = ref(false)
const readerScheduleOpen = ref(false)
const scheduleOptions = computed(() => scheduleChoices())

function scheduleChoiceDetail(choice) {
  return choice.date.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

async function scheduleSelected(choice) {
  const emails = [...selectedEmails.value]
  bulkScheduleOpen.value = false
  clearSelection()
  const results = await Promise.all(
    emails.map((email) => store.scheduleEmail(email, choice.date.toISOString(), choice.label, false)),
  )
  if (results.every(Boolean)) {
    store.notify(`${emails.length} ${emails.length === 1 ? 'email' : 'emails'} scheduled for ${choice.label}.`)
  }
}

// --- Reading panel (open-email state lives in the store so the command
// palette can act on it globally) ---
const openEmail = computed(() => store.openEmail)
// Sanitized-and-sandboxed HTML rendering is driven by the on-demand body
// fetch; null until it lands (reader shows body_text meanwhile) or when the
// message has no HTML body (permanent text fallback).
const openEmailHtml = computed(() => store.openEmailHtml)
// Unsubscribe capability arrives with the on-demand body fetch (parsed
// server-side from the List-Unsubscribe header); null for non-newsletters.
const openEmailUnsubscribe = computed(() => store.openEmailUnsubscribe)
const isUnsubscribed = computed(() => store.openEmailUnsubscribed)
const isUnsubscribing = computed(() => store.unsubscribingId === store.openEmailId)
const isReplyOpen = ref(false)
const replyText = ref('')
const replyTextareaRef = ref(null)

function openReader(email) {
  store.openReader(email)
}

function closeReader() {
  store.closeReader()
}

// Reset reply state whenever the open email changes or closes, including
// changes made from outside this view (e.g. the command palette).
watch(
  () => store.openEmailId,
  (id) => {
    isReplyOpen.value = false
    replyText.value = ''
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
  store.unsubscribeEmail(openEmail.value)
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

function replyToOpenEmail() {
  isReplyOpen.value = true
  nextTick(() => replyTextareaRef.value?.focus())
}

function discardReply() {
  isReplyOpen.value = false
  replyText.value = ''
}

async function sendReply() {
  const email = openEmail.value
  const text = replyText.value
  try {
    await store.sendMail({
      to: senderAddress(email),
      subject: `Re: ${email.subject}`,
      text,
      replyToMessageId: email.id,
    })
    isReplyOpen.value = false
    replyText.value = ''
    store.notify('Reply sent.')
  } catch (error) {
    console.error('Failed to send reply:', error)
    store.notify('Failed to send reply. Please try again.', 'error')
  }
}

function senderAddress(email) {
  if (email.address) return email.address
  const slug = email.sender.toLowerCase().replace(/[^a-z0-9]+/g, '')
  return `no-reply@${slug}.com`
}

// Outbound rows (Sent view, and sent copies surfaced by search) show who the
// mail went to; inbound rows show who it came from.
function rowSender(email) {
  return email.isSent ? `To: ${email.to ?? email.address}` : email.sender
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

function onDocumentClick(e) {
  if (!e.target.closest('.ni-schedule-wrap')) {
    bulkScheduleOpen.value = false
    readerScheduleOpen.value = false
  }
  // Clicks inside the command palette must not close the reader — its
  // email commands read the open email as they run.
  if (!openEmail.value || store.isCommandPaletteOpen) return
  // Clicks inside the panel keep it open; clicks on rows are handled by
  // openReader; the bulk bar acts on the list without dismissing the reader.
  if (
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
          <span class="ni-group-count-wrap" v-if="group.unreadCount">
            <span class="ni-group-count">{{ group.unreadCount }}</span>
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
        <div
          v-for="email in isGroupOpen(group.label) ? group.emails : []"
          :key="email.id"
          class="ni-row"
          :class="{ unread: email.unread, selected: openEmail === email, checked: isSelected(email) }"
          @click="openReader(email)"
        >
          <div class="ni-lead">
            <span
              class="material-symbols-outlined ni-checkbox"
              :class="{ checked: isSelected(email) }"
              role="checkbox"
              tabindex="0"
              :aria-checked="isSelected(email) ? 'true' : 'false'"
              :aria-label="`Select ${email.subject}`"
              @click.stop="toggleSelect(email)"
              @keydown.enter.stop.prevent="toggleSelect(email)"
              @keydown.space.stop.prevent="toggleSelect(email)"
              >{{ isSelected(email) ? 'check_box' : 'check_box_outline_blank' }}</span
            >
            <span class="ni-dot" v-if="email.unread"></span>
          </div>
          <div class="ni-sender">{{ rowSender(email) }}</div>
          <div class="ni-subject">{{ email.subject }}</div>
          <div class="ni-row-labels">
            <span
              v-for="label in email.labels"
              :key="label.name"
              class="ni-label-pill ni-label-pill-sm"
              :style="{ color: label.color, backgroundColor: label.color + '1f' }"
            >
              {{ label.name }}
            </span>
          </div>
          <div class="ni-date">{{ email.date }}</div>
          <div class="ni-actions" @click.stop>
            <button
              class="ni-action-btn"
              :class="{ starred: email.starred }"
              title="Star"
              @click="toggleStar(email)"
            >
              <span class="material-symbols-outlined">{{
                email.starred ? 'star' : 'star_border'
              }}</span>
            </button>
            <button class="ni-action-btn" title="Done" @click="removeEmail(email)">
              <span class="material-symbols-outlined">check_box</span>
            </button>
            <button
              class="ni-action-btn"
              :title="email.unread ? 'Mark as read' : 'Mark as unread'"
              @click="store.setUnread(email, !email.unread)"
            >
              <span class="material-symbols-outlined">{{
                email.unread ? 'mark_email_read' : 'mark_email_unread'
              }}</span>
            </button>
          </div>
        </div>
      </template>
      <div class="ni-empty" v-if="activeFilter && !filteredEmails.length">
        {{ emptyText }}
      </div>
      <button v-if="showLoadMore" class="ni-load-more" :disabled="isLoadingMore" @click="loadMore">
        {{ isLoadingMore ? 'Loading…' : 'Load more' }}
      </button>
    </div>

    <!-- Bulk action bar: floats over the list while any row is checked -->
    <Transition name="ni-bulk">
      <div class="ni-bulk-bar" v-if="selectedEmails.length">
        <span class="ni-bulk-count">{{ selectedEmails.length }} selected</span>
        <button class="ni-bulk-pill" @click="starSelected">
          <span class="material-symbols-outlined">star</span>
          <span>Star</span>
        </button>
        <button class="ni-bulk-pill" @click="markSelectedDone">
          <span class="material-symbols-outlined">check_box</span>
          <span>Done</span>
        </button>
        <div class="ni-schedule-wrap ni-schedule-wrap-bulk">
          <button
            class="ni-bulk-pill"
            aria-haspopup="menu"
            :aria-expanded="bulkScheduleOpen"
            @click="bulkScheduleOpen = !bulkScheduleOpen"
          >
            <span class="material-symbols-outlined">schedule</span>
            <span>Reschedule</span>
          </button>
          <div v-if="bulkScheduleOpen" class="ni-schedule-menu" role="menu">
            <button
              v-for="choice in scheduleOptions"
              :key="choice.id"
              role="menuitem"
              @click="scheduleSelected(choice)"
            >
              <span>{{ choice.label }}</span>
              <span>{{ scheduleChoiceDetail(choice) }}</span>
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Reading panel -->
    <Transition name="ni-slide">
      <div class="ni-reader" v-if="openEmail">
        <div class="ni-reader-topbar">
          <div class="ni-reader-nav">
            <button
              v-if="openEmailUnsubscribe"
              class="ni-unsub-btn"
              title="Unsubscribe"
              :disabled="isUnsubscribing || isUnsubscribed"
              @click="unsubscribeOpenEmail"
            >
              <span class="material-symbols-outlined">unsubscribe</span>
              <span>{{ isUnsubscribed ? 'Unsubscribed' : 'Unsubscribe' }}</span>
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
            <button class="ni-reader-btn" title="Done" @click="archiveOpenEmail">
              <span class="material-symbols-outlined">check_box</span>
            </button>
            <div class="ni-schedule-wrap">
              <button
                class="ni-reader-btn"
                title="Reschedule"
                aria-haspopup="menu"
                :aria-expanded="readerScheduleOpen"
                @click="readerScheduleOpen = !readerScheduleOpen"
              >
                <span class="material-symbols-outlined">schedule</span>
              </button>
              <div v-if="readerScheduleOpen" class="ni-schedule-menu" role="menu">
                <button
                  v-for="choice in scheduleOptions"
                  :key="choice.id"
                  role="menuitem"
                  @click="scheduleOpenEmail(choice)"
                >
                  <span>{{ choice.label }}</span>
                  <span>{{ scheduleChoiceDetail(choice) }}</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <h2 class="ni-reader-subject">{{ openEmail.subject }}</h2>

        <div class="ni-reader-labels" v-if="openEmail.labels?.length">
          <span
            v-for="label in openEmail.labels"
            :key="label.name"
            class="ni-label-pill"
            :style="{ color: label.color, backgroundColor: label.color + '1f' }"
          >
            {{ label.name }}
          </span>
        </div>

        <div class="ni-email-card">
          <div class="ni-email-card-header">
            <div class="ni-email-meta">
              <div>
                <span class="ni-email-sender">{{ openEmail.sender }}</span>
                <span class="ni-email-address">{{ senderAddress(openEmail) }}</span>
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
            </div>
          </div>
          <EmailBody
            :html="openEmailHtml"
            :text="openEmail.body || openEmail.snippet || ''"
            :sender="openEmail.sender"
            :has-html-body="openEmail.hasHtml"
            :loading="store.isOpenBodyLoading"
          />
        </div>

        <!-- Inline reply box -->
        <Transition name="ni-reply">
          <div class="ni-reply-box" v-if="isReplyOpen">
            <div class="ni-reply-header">
              <span class="material-symbols-outlined">reply</span>
              <span>Reply to {{ openEmail.sender }}</span>
            </div>
            <textarea
              ref="replyTextareaRef"
              v-model="replyText"
              class="ni-reply-textarea"
              placeholder="Write your reply..."
            ></textarea>
            <div class="ni-reply-footer">
              <button class="btn btn-primary" :disabled="!replyText.trim()" @click="sendReply">
                Send
              </button>
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
