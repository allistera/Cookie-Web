<script setup>
import { useInboxStore } from '../stores/inbox'

const store = useInboxStore()

function toggleUnread(email) {
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
</script>

<template>
  <div class="view-panel active" id="traditionalInboxView">
    <div class="inbox-controls">
      <div class="controls-left">
        <span class="material-symbols-outlined checkbox-placeholder">check_box_outline_blank</span>
        <span class="material-symbols-outlined">arrow_drop_down</span>
        <span class="material-symbols-outlined">refresh</span>
        <span class="material-symbols-outlined">more_vert</span>
      </div>
      <div class="controls-right">
        <span>1-50 of 422</span>
        <span class="material-symbols-outlined">keyboard_arrow_left</span>
        <span class="material-symbols-outlined">keyboard_arrow_right</span>
      </div>
    </div>

    <div class="inbox-tabs">
      <div class="tab active">
        <span class="material-symbols-outlined">inbox</span>
        <span class="tab-text">Primary</span>
      </div>
      <div class="tab">
        <span class="material-symbols-outlined">sell</span>
        <span class="tab-text">Promotions</span>
      </div>
      <div class="tab">
        <span class="material-symbols-outlined">group</span>
        <span class="tab-text">Social</span>
      </div>
    </div>

    <!-- MOCK EMAIL LIST -->
    <div class="email-list" id="emailListContainer">
      <div
        v-for="email in store.traditionalEmails"
        :key="email.id"
        class="email-item"
        :class="{ unread: email.unread }"
        @click="toggleUnread(email)"
      >
        <div class="email-select">
          <span class="material-symbols-outlined checkbox-placeholder"
            >check_box_outline_blank</span
          >
        </div>
        <div class="email-star" :class="{ starred: email.starred }" @click.stop="toggleStar(email)">
          <span class="material-symbols-outlined">
            {{ email.starred ? 'star' : 'star_border' }}
          </span>
        </div>
        <div class="email-sender">{{ email.sender }}</div>
        <div class="email-content-block">
          <span class="email-subject">{{ email.subject }}</span>
          <span class="email-snippet"> - {{ email.snippet }}</span>
        </div>
        <div class="email-date">{{ email.date }}</div>
      </div>
    </div>
  </div>
</template>
