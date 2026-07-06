<script setup>
import { computed, ref, nextTick, onMounted, onUnmounted } from 'vue'
import { useInboxStore } from '../stores/inbox'

const store = useInboxStore()

const emailGroups = computed(() => {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const DAY = 24 * 60 * 60 * 1000
  const today = []
  const yesterday = []
  const lastSevenDays = []
  const earlier = []
  for (const email of store.traditionalEmails) {
    const sentAt = new Date(email.sentAt).getTime()
    if (sentAt >= startOfToday) today.push(email)
    else if (sentAt >= startOfToday - DAY) yesterday.push(email)
    else if (sentAt >= startOfToday - 7 * DAY) lastSevenDays.push(email)
    else earlier.push(email)
  }
  const groups = []
  if (today.length) groups.push({ label: null, emails: today })
  if (yesterday.length) groups.push({ label: 'Yesterday', emails: yesterday })
  if (lastSevenDays.length) groups.push({ label: 'Last seven days', emails: lastSevenDays })
  if (earlier.length) groups.push({ label: 'Earlier', emails: earlier })
  return groups
})

const flatEmails = computed(() => emailGroups.value.flatMap((g) => g.emails))

function markRead(email) {
  if (email.unread) {
    email.unread = false
    if (store.unreadInboxCount > 0) {
      store.unreadInboxCount--
    }
  }
}

function toggleStar(email) {
  email.starred = !email.starred
}

function removeEmail(email) {
  markRead(email)
  if (openEmail.value === email) {
    openEmail.value = null
  }
  const index = store.traditionalEmails.indexOf(email)
  if (index > -1) {
    store.traditionalEmails.splice(index, 1)
  }
}

// --- Reading panel ---
const openEmail = ref(null)
const isReplyOpen = ref(false)
const replyText = ref('')
const replyTextareaRef = ref(null)

function openReader(email) {
  markRead(email)
  openEmail.value = email
  isReplyOpen.value = false
  replyText.value = ''
}

function closeReader() {
  openEmail.value = null
  isReplyOpen.value = false
  replyText.value = ''
}

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
  isReplyOpen.value = false
  replyText.value = ''
  try {
    await store.sendMail({
      to: senderAddress(email),
      subject: `Re: ${email.subject}`,
      text,
    })
  } catch (error) {
    console.error('Failed to send reply:', error)
    store.notify('Failed to send reply. Please try again.', 'error')
    return
  }
  store.notify('Reply sent.')
}

function senderAddress(email) {
  if (email.address) return email.address
  const slug = email.sender.toLowerCase().replace(/[^a-z0-9]+/g, '')
  return `no-reply@${slug}.com`
}

function bodyParagraphs(email) {
  return (email.body || email.snippet).split('\n\n')
}

function onKeydown(e) {
  if (e.key === 'Escape' && openEmail.value) {
    closeReader()
  }
}

function onDocumentClick(e) {
  if (!openEmail.value) return
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
        <span class="material-symbols-outlined ni-title-icon">inbox</span>
        <h1>Inbox</h1>
      </div>
    </div>

    <!-- Email list -->
    <div class="ni-list">
      <template v-for="group in emailGroups" :key="group.label || 'today'">
        <div v-if="group.label" class="ni-group-header">{{ group.label }}</div>
        <div
          v-for="email in group.emails"
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
            <button class="ni-action-btn" title="Mark done" @click="markRead(email)">
              <span class="material-symbols-outlined">check_box</span>
            </button>
            <button class="ni-action-btn" title="Snooze">
              <span class="material-symbols-outlined">schedule</span>
            </button>
          </div>
        </div>
      </template>
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

        <div class="ni-reader-labels">
          <span class="ni-reader-addlabel">Add label</span>
          <span class="ni-label-chip">
            Updates
            <span class="material-symbols-outlined">close</span>
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
          <div class="ni-email-body">
            <p v-for="(paragraph, i) in bodyParagraphs(openEmail)" :key="i">{{ paragraph }}</p>
            <p class="ni-email-signoff">Kind regards,<br />{{ openEmail.sender }}</p>
          </div>
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
