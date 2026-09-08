<script setup>
// One inbox list row, extracted from TraditionalInboxView so Vue can skip
// re-rendering untouched rows: rendered inline, any one email changing
// (star, read toggle, selection, a realtime refresh) re-diffed every loaded
// row — noticeable after a few Load More pages. As a component boundary, a
// row re-renders only when its own props change or a field of its own email
// mutates. The parent must bind stable handler references (not inline
// arrows, which get a new identity per parent render and would defeat the
// props-equality skip); the row emits its email as the payload instead.
defineProps({
  email: { type: Object, required: true },
  sender: { type: String, required: true },
  readReceiptTitle: { type: String, default: '' },
  checked: { type: Boolean, default: false },
  open: { type: Boolean, default: false },
  hasAiSummary: { type: Boolean, default: false },
  showDone: { type: Boolean, default: true },
})

defineEmits(['open', 'toggle-select', 'toggle-star', 'done', 'toggle-unread'])

function followUpTitle(followUpAt) {
  return `Follow up ${new Date(followUpAt).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })}`
}
</script>

<template>
  <div
    class="ni-row"
    :class="{ unread: email.unread, selected: open, checked }"
    @click="$emit('open', email)"
  >
    <div class="ni-lead">
      <span
        class="material-symbols-outlined ni-checkbox"
        :class="{ checked }"
        role="checkbox"
        tabindex="0"
        :aria-checked="checked ? 'true' : 'false'"
        :aria-label="`Select ${email.subject}`"
        @click.stop="$emit('toggle-select', email)"
        @keydown.enter.stop.prevent="$emit('toggle-select', email)"
        @keydown.space.stop.prevent="$emit('toggle-select', email)"
        >{{ checked ? 'check_box' : 'check_box_outline_blank' }}</span
      >
      <span class="ni-dot" v-if="email.unread"></span>
    </div>
    <div class="ni-sender">{{ sender }}</div>
    <div class="ni-subject">
      <span
        v-if="hasAiSummary"
        class="material-symbols-outlined ni-ai-generated-icon"
        aria-hidden="true"
        >auto_awesome</span
      >
      <span class="ni-subject-text">{{ email.subject }}</span>
    </div>
    <div class="ni-row-labels">
      <span
        v-if="email.category"
        class="ni-category-pill ni-category-pill-sm"
        :style="{ color: email.category.color, backgroundColor: email.category.color + '1f' }"
      >
        {{ email.category.name }}
      </span>
      <span
        v-for="label in email.labels"
        :key="label.name"
        class="ni-label-pill ni-label-pill-sm"
        :style="{ color: label.color, backgroundColor: label.color + '1f' }"
      >
        {{ label.name }}
      </span>
    </div>
    <div class="ni-date">
      <span
        v-if="email.followUpAt"
        class="ni-follow-up-status"
        :title="followUpTitle(email.followUpAt)"
      >
        <span class="material-symbols-outlined" aria-hidden="true">notifications_active</span>
        Follow up
      </span>
      <span
        v-if="email.isSent"
        class="ni-read-status"
        :class="{ opened: email.readAt }"
        :title="readReceiptTitle"
      >
        <span class="material-symbols-outlined" aria-hidden="true">{{
          email.readAt ? 'done_all' : 'check'
        }}</span>
        {{ email.readAt ? 'Opened' : 'Sent' }}
      </span>
      <span
        v-if="email.hasAttachments"
        class="material-symbols-outlined ni-row-attachment-icon"
        title="Has attachments"
        aria-label="Has attachments"
        >attach_file</span
      >
      <span>{{ email.date }}</span>
    </div>
    <div class="ni-actions" @click.stop>
      <button
        class="ni-action-btn"
        :class="{ starred: email.starred }"
        title="Star"
        @click="$emit('toggle-star', email)"
      >
        <span class="material-symbols-outlined">{{ email.starred ? 'star' : 'star_border' }}</span>
      </button>
      <button v-if="showDone" class="ni-action-btn" title="Done" @click="$emit('done', email)">
        <span class="material-symbols-outlined">check_box</span>
      </button>
      <button
        class="ni-action-btn"
        :title="email.unread ? 'Mark as read' : 'Mark as unread'"
        @click="$emit('toggle-unread', email)"
      >
        <span class="material-symbols-outlined">{{
          email.unread ? 'mark_email_read' : 'mark_email_unread'
        }}</span>
      </button>
    </div>
  </div>
</template>
