<script setup>
import { computed } from 'vue'
import { useInboxStore } from '../stores/inbox'

const store = useInboxStore()

const emailGroups = computed(() => {
  const today = []
  const yesterday = []
  const earlier = []
  for (const email of store.traditionalEmails) {
    if (/am|pm/i.test(email.date)) today.push(email)
    else if (email.date === 'Yesterday') yesterday.push(email)
    else earlier.push(email)
  }
  const groups = []
  if (today.length) groups.push({ label: null, emails: today })
  if (yesterday.length) groups.push({ label: 'Yesterday', emails: yesterday })
  if (earlier.length) groups.push({ label: 'Earlier', emails: earlier })
  return groups
})

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
  const index = store.traditionalEmails.indexOf(email)
  if (index > -1) {
    store.traditionalEmails.splice(index, 1)
  }
}
</script>

<template>
  <div class="view-panel active" id="traditionalInboxView">
    <!-- Header -->
    <div class="ni-header">
      <div class="ni-title">
        <span class="material-symbols-outlined ni-title-icon">inbox</span>
        <h1>Inbox</h1>
      </div>
      <div class="ni-header-actions">
        <button class="ni-pill-btn">
          <span class="material-symbols-outlined ni-red">error</span>
          <span>Auto label</span>
        </button>
        <button class="ni-icon-btn" title="Display">
          <span class="material-symbols-outlined">filter_list</span>
        </button>
        <button class="ni-icon-btn" title="Settings">
          <span class="material-symbols-outlined">tune</span>
        </button>
        <button class="ni-icon-btn" title="Refresh" @click="store.refreshInbox">
          <span class="material-symbols-outlined">refresh</span>
        </button>
      </div>
    </div>

    <!-- Filter chips -->
    <div class="ni-chips">
      <button class="ni-chip ni-chip-active">
        <span class="material-symbols-outlined">bookmark</span>
        <span>Categories: Not Promotions, S...</span>
        <span class="material-symbols-outlined">expand_more</span>
      </button>
      <button class="ni-chip ni-chip-active">
        <span class="material-symbols-outlined">bookmark</span>
        <span>Labels: Not Newsletters/Spam</span>
        <span class="material-symbols-outlined">expand_more</span>
      </button>
      <button class="ni-chip">
        <span class="material-symbols-outlined">mark_email_unread</span>
        <span>Is unread</span>
      </button>
      <button class="ni-chip">
        <span class="material-symbols-outlined">archive</span>
        <span>Show archived</span>
      </button>
      <button class="ni-chip ni-chip-active">
        <span class="material-symbols-outlined">person</span>
        <span>From: Not "github.com"</span>
        <span class="material-symbols-outlined">expand_more</span>
      </button>
      <button class="ni-chip">
        <span class="material-symbols-outlined">add</span>
        <span>Filter</span>
      </button>
    </div>

    <!-- Email list -->
    <div class="ni-list">
      <template v-for="group in emailGroups" :key="group.label || 'today'">
        <div v-if="group.label" class="ni-group-header">{{ group.label }}</div>
        <div
          v-for="email in group.emails"
          :key="email.id"
          class="ni-row"
          :class="{ unread: email.unread }"
          @click="markRead(email)"
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
  </div>
</template>
