<script setup>
import { computed, ref, nextTick, onMounted, onUnmounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useInboxStore } from '../stores/inbox'
import EmailBody from '../components/EmailBody.vue'

const store = useInboxStore()
const route = useRoute()

// --- Filtered views (?filter=starred|snoozed|sent|drafts|label&label=<name>) ---
// Starred and label views filter the loaded list client-side (rows already
// carry starred + labels; covers loaded pages only). Snoozed/Sent/Drafts have
// no backing data yet and render an honest empty state.
const FILTER_META = {
  starred: { title: 'Starred', icon: 'star', emptyText: 'No starred emails.' },
  snoozed: { title: 'Snoozed', icon: 'schedule', emptyText: 'No snoozed emails yet.' },
  sent: { title: 'Sent', icon: 'send', emptyText: 'Sent view is coming soon.' },
  drafts: { title: 'Drafts', icon: 'description', emptyText: 'No drafts yet.' },
  label: { title: null, icon: 'sell', emptyText: 'No emails with this label.' },
}
const EMPTY_ONLY_FILTERS = new Set(['snoozed', 'sent', 'drafts'])

const activeFilter = computed(() => (FILTER_META[route.query.filter] ? route.query.filter : null))

const filteredEmails = computed(() => {
  const emails = store.traditionalEmails
  switch (activeFilter.value) {
    case 'starred':
      return emails.filter((e) => e.starred)
    case 'label':
      return emails.filter((e) => e.labels?.some((l) => l.name === route.query.label))
    case 'snoozed':
    case 'sent':
    case 'drafts':
      return []
    default:
      return emails
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

const showLoadMore = computed(
  () =>
    store.hasMoreEmails &&
    !store.activeSearchQuery &&
    !EMPTY_ONLY_FILTERS.has(activeFilter.value),
)

const emailGroups = computed(() => {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const DAY = 24 * 60 * 60 * 1000
  const today = []
  const yesterday = []
  const lastSevenDays = []
  const earlier = []
  for (const email of filteredEmails.value) {
    const sentAt = new Date(email.sentAt).getTime()
    if (sentAt >= startOfToday) today.push(email)
    else if (sentAt >= startOfToday - DAY) yesterday.push(email)
    else if (sentAt >= startOfToday - 7 * DAY) lastSevenDays.push(email)
    else earlier.push(email)
  }
  const groups = []
  const group = (label, emails) => ({
    label,
    emails,
    unreadCount: emails.filter((e) => e.unread).length,
  })
  if (today.length) groups.push(group('Today', today))
  if (yesterday.length) groups.push(group('Yesterday', yesterday))
  if (lastSevenDays.length) groups.push(group('Last seven days', lastSevenDays))
  if (earlier.length) groups.push(group('Earlier', earlier))
  return groups
})

const flatEmails = computed(() => emailGroups.value.flatMap((g) => g.emails))

// Accordion state: Today starts open, every other day group starts closed.
const openGroups = ref(new Set(['Today']))

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

function removeEmail(email) {
  store.archiveEmail(email)
}

// --- Reading panel (open-email state lives in the store so the command
// palette can act on it globally) ---
const openEmail = computed(() => store.openEmail)
// Sanitized-and-sandboxed HTML rendering is driven by the on-demand body
// fetch; null until it lands (reader shows body_text meanwhile) or when the
// message has no HTML body (permanent text fallback).
const openEmailHtml = computed(() => store.openEmailHtml)
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
    // command palette and prev/next navigation.
    if (id) store.fetchMessageBody(id)
  },
)

const openIndex = computed(() => flatEmails.value.indexOf(openEmail.value))

function prevEmail() {
  if (openIndex.value > 0) {
    openReader(flatEmails.value[openIndex.value - 1])
  }
}

function nextEmail() {
  if (openIndex.value > -1 && openIndex.value < flatEmails.value.length - 1) {
    openReader(flatEmails.value[openIndex.value + 1])
  }
}

function archiveOpenEmail() {
  if (openEmail.value) {
    removeEmail(openEmail.value)
  }
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

function onKeydown(e) {
  // The command palette owns Escape while it is open.
  if (e.key === 'Escape' && openEmail.value && !store.isCommandPaletteOpen) {
    closeReader()
  }
}

function onDocumentClick(e) {
  // Clicks inside the command palette must not close the reader — its
  // email commands read the open email as they run.
  if (!openEmail.value || store.isCommandPaletteOpen) return
  // Clicks inside the panel keep it open; clicks on rows are handled by openReader
  if (e.target.closest('.ni-reader') || e.target.closest('.ni-row')) return
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
          <span class="ni-group-count" v-if="group.unreadCount">{{ group.unreadCount }}</span>
        </button>
        <div
          v-for="email in isGroupOpen(group.label) ? group.emails : []"
          :key="email.id"
          class="ni-row"
          :class="{ unread: email.unread, selected: openEmail === email }"
          @click="openReader(email)"
        >
          <div class="ni-lead">
            <span class="material-symbols-outlined ni-checkbox">check_box_outline_blank</span>
            <span class="ni-dot" v-if="email.unread"></span>
          </div>
          <div class="ni-sender">{{ email.sender }}</div>
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
            <button class="ni-action-btn" title="Archive" @click="removeEmail(email)">
              <span class="material-symbols-outlined">archive</span>
            </button>
            <button class="ni-action-btn" title="Delete" @click="removeEmail(email)">
              <span class="material-symbols-outlined">delete</span>
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
            <button class="ni-action-btn" title="Snooze">
              <span class="material-symbols-outlined">schedule</span>
            </button>
          </div>
        </div>
      </template>
      <div class="ni-empty" v-if="activeFilter && !filteredEmails.length">
        {{ emptyText }}
      </div>
      <button
        v-if="showLoadMore"
        class="ni-load-more"
        :disabled="store.isRefreshing"
        @click="store.loadMoreEmails()"
      >
        {{ store.isRefreshing ? 'Loading…' : 'Load more' }}
      </button>
    </div>

    <!-- Reading panel -->
    <Transition name="ni-slide">
      <div class="ni-reader" v-if="openEmail">
        <div class="ni-reader-topbar">
          <div class="ni-reader-nav">
            <button class="ni-reader-btn ni-reader-close" title="Close" @click="closeReader">
              <span class="material-symbols-outlined">keyboard_double_arrow_right</span>
            </button>
            <button
              class="ni-reader-btn"
              title="Previous"
              :disabled="openIndex <= 0"
              @click="prevEmail"
            >
              <span class="material-symbols-outlined">keyboard_arrow_up</span>
            </button>
            <button
              class="ni-reader-btn"
              title="Next"
              :disabled="openIndex >= flatEmails.length - 1"
              @click="nextEmail"
            >
              <span class="material-symbols-outlined">keyboard_arrow_down</span>
            </button>
          </div>
          <div class="ni-reader-nav">
            <button class="ni-reader-btn" title="Snooze">
              <span class="material-symbols-outlined">schedule</span>
            </button>
            <button class="ni-reader-btn" title="Archive" @click="archiveOpenEmail">
              <span class="material-symbols-outlined">archive</span>
            </button>
            <button class="ni-reader-btn" title="Delete" @click="archiveOpenEmail">
              <span class="material-symbols-outlined">delete</span>
            </button>
            <button class="ni-reader-btn" title="More">
              <span class="material-symbols-outlined">more_horiz</span>
            </button>
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
                To me
                <span class="material-symbols-outlined">unfold_more</span>
              </div>
            </div>
            <div class="ni-email-header-right">
              <button class="ni-reader-btn" title="Reply" @click="replyToOpenEmail">
                <span class="material-symbols-outlined">reply</span>
              </button>
              <button class="ni-reader-btn" title="Forward">
                <span class="material-symbols-outlined">forward</span>
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
          <button class="ni-pill-btn">
            <span class="material-symbols-outlined">forward</span>
            <span>Forward</span>
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>
