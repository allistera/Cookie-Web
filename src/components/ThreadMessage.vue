<script setup>
import { computed, ref, watch } from 'vue'

import EmailBody from './EmailBody.vue'
import { attachmentIcon, formatFileSize } from '../lib/attachments'
import { formatEmailDate, useInboxStore } from '../stores/inbox'

// One message of the open email's conversation, other than the open email
// itself: a collapsed one-line card, or the full message once expanded.
const props = defineProps({
  // A conversation row from GET /messages: id, from_name, from_address,
  // snippet, sent_at, is_sent — no body, which is fetched on expand.
  message: { type: Object, required: true },
  expanded: { type: Boolean, default: false },
})

const emit = defineEmits(['toggle'])

const store = useInboxStore()
const sender = computed(() => props.message.from_name || props.message.from_address)
const sentAt = computed(() => formatEmailDate(props.message.sent_at))
const body = computed(() => store.messageBodyById(props.message.id))
const loadFailed = ref(false)

// Expanding fetches the full message through the same cached path the open
// email uses, so collapsing and re-expanding (or opening it later from the
// list) costs one request in total.
watch(
  () => props.expanded,
  async (expanded) => {
    if (!expanded || body.value) return
    loadFailed.value = false
    const loaded = await store.fetchMessageBody(props.message.id)
    if (!loaded) loadFailed.value = true
  },
  { immediate: true },
)
</script>

<template>
  <button
    v-if="!expanded"
    type="button"
    class="ni-thread-message"
    :aria-expanded="false"
    @click="emit('toggle')"
  >
    <div class="ni-thread-message-summary">
      <span class="ni-thread-message-sender">{{ sender }}</span>
      <span class="ni-thread-message-time">{{ sentAt }}</span>
      <span class="material-symbols-outlined ni-thread-message-chevron" aria-hidden="true">
        expand_more
      </span>
    </div>
    <p class="ni-thread-message-snippet">{{ message.snippet }}</p>
  </button>

  <article v-else class="ni-email-card ni-thread-message-open">
    <div class="ni-email-card-header">
      <div class="ni-email-meta">
        <div>
          <span class="ni-email-sender">{{ sender }}</span>
          <span class="ni-email-address">{{ message.from_address }}</span>
        </div>
      </div>
      <div class="ni-email-header-right">
        <span class="ni-email-time">{{ sentAt }}</span>
        <button
          type="button"
          class="ni-reader-btn"
          title="Collapse message"
          aria-label="Collapse message"
          :aria-expanded="true"
          @click="emit('toggle')"
        >
          <span class="material-symbols-outlined">expand_less</span>
        </button>
      </div>
    </div>

    <p v-if="loadFailed" class="ni-thread-message-status">Couldn't load this message.</p>
    <p v-else-if="!body" class="ni-thread-message-status">Loading…</p>
    <template v-else>
      <EmailBody :html="body.html" :text="body.text ?? ''" :sender="sender" body-resolved />

      <div v-if="body.attachments?.length" class="ni-attachments" aria-label="Attachments">
        <component
          :is="attachment.downloadable ? 'button' : 'div'"
          v-for="attachment in body.attachments"
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
    </template>
  </article>
</template>
