<script setup>
import { onBeforeUnmount, onMounted, reactive, ref, shallowReactive, watch } from 'vue'

import EmailBody from './EmailBody.vue'
import { useInboxStore } from '../stores/inbox'
import { normalizeSender, useSendersStore } from '../stores/senders'

// The Feed, read like a blog: each of today's newsletters is a post with its
// content open, newest first. A post's title opens it in the reader, which
// keeps reply, labels and unsubscribe.
const props = defineProps({
  // The Feed's list rows (see lib/theFeed.js).
  emails: { type: Array, required: true },
  // Whether an email's remote images load without asking: the reader's rule,
  // which the inbox view owns.
  showsImages: { type: Function, required: true },
})

const emit = defineEmits(['open', 'done', 'keydown'])

const store = useInboxStore()
const senders = useSendersStore()
const scroller = ref(null)

// Bodies by email id, held here as well as in the store's cache: that cache
// is bounded, and a post must keep its content once it has been shown.
const bodies = shallowReactive(new Map())
const failed = reactive(new Set())
const requested = new Set()
let observer = null

// A whole body per post is the heaviest request the mailbox has, so a post
// loads as it nears the visible part of the feed instead of all at once.
const LOAD_AHEAD = '800px'

async function load(email) {
  requested.add(email.id)
  failed.delete(email.id)
  // Accepted senders are read with their images; a decision not yet known
  // arrives here, as it does when the reader opens an email.
  if (!(normalizeSender(email.address) in senders.known)) void senders.lookup(email.address)
  const body = await store.fetchMessageBody(email.id)
  if (body) bodies.set(email.id, body)
  else failed.add(email.id)
}

function loadPost(element) {
  const email = props.emails.find((candidate) => candidate.id === element.dataset.postId)
  if (email && !requested.has(email.id)) load(email)
}

// Runs for the first posts and again whenever the list changes (Load more, a
// reload on the next visit), picking up the posts not asked for yet.
function loadNewPosts() {
  for (const element of scroller.value.querySelectorAll('[data-post-id]')) {
    if (requested.has(element.dataset.postId)) continue
    if (observer) observer.observe(element)
    else loadPost(element)
  }
}

onMounted(() => {
  if (globalThis.IntersectionObserver) {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries.filter((candidate) => candidate.isIntersecting)) {
          observer.unobserve(entry.target)
          loadPost(entry.target)
        }
      },
      { root: scroller.value, rootMargin: `${LOAD_AHEAD} 0px` },
    )
  }
  loadNewPosts()
})
watch(() => props.emails, loadNewPosts, { flush: 'post' })
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <div ref="scroller" class="feed">
    <article
      v-for="email in emails"
      :key="email.id"
      class="feed-post"
      :data-post-id="email.id"
      :aria-labelledby="`feed-post-${email.id}`"
    >
      <header class="feed-post-header">
        <div class="feed-post-heading">
          <p class="feed-post-meta">
            <span
              v-if="email.unread"
              class="feed-post-unread"
              role="img"
              aria-label="Unread"
            ></span>
            <span class="feed-post-sender">{{ email.sender }}</span>
            <span>{{ email.date }}</span>
            <span v-if="email.isArchived" class="feed-post-done">Done</span>
          </p>
          <h2 :id="`feed-post-${email.id}`" class="feed-post-title">
            <!-- feed-post-open: the inbox view keeps the reader open on it. -->
            <button
              type="button"
              class="feed-post-open"
              title="Open in the reader"
              @click="emit('open', email)"
            >
              {{ email.subject }}
            </button>
          </h2>
        </div>
        <button
          v-if="!email.isArchived"
          type="button"
          class="ni-reader-btn"
          title="Done"
          :aria-label="`Mark ${email.subject} done`"
          @click="emit('done', email)"
        >
          <span class="material-symbols-outlined">check_box</span>
        </button>
      </header>

      <p v-if="failed.has(email.id)" class="feed-post-status">
        Couldn't load this newsletter.
        <button type="button" class="btn btn-text" @click="load(email)">Try again</button>
      </p>
      <div
        v-else-if="!bodies.has(email.id)"
        class="feed-post-loading"
        role="status"
        aria-label="Loading newsletter"
      >
        <div class="spinner feed-post-spinner" aria-hidden="true"></div>
      </div>
      <EmailBody
        v-else
        :html="bodies.get(email.id).html"
        :text="bodies.get(email.id).text ?? email.body ?? email.snippet ?? ''"
        :sender="email.sender"
        body-resolved
        :show-images="showsImages(email)"
        @keydown="emit('keydown', $event)"
      />
    </article>
    <slot />
  </div>
</template>

<style scoped>
.feed {
  min-height: 0;
  overflow-y: auto;
  padding: 0 24px 24px;
}

.feed-post {
  max-width: 720px;
  margin: 0 auto;
  padding: 32px 0 40px;
}

.feed-post + .feed-post {
  border-top: 1px solid var(--border-color);
}

.feed-post-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 24px;
}

.feed-post-heading {
  min-width: 0;
}

.feed-post-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 6px;
  color: var(--text-secondary);
  font-size: 13px;
}

.feed-post-unread {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
}

.feed-post-sender {
  color: var(--text-primary);
  font-weight: 600;
}

.feed-post-done {
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--bg-input);
  font-size: 12px;
}

.feed-post-title {
  font-size: 26px;
  font-weight: 700;
  line-height: 1.25;
  letter-spacing: -0.01em;
}

.feed-post-open {
  padding: 0;
  border: 0;
  background: none;
  color: var(--text-primary);
  font: inherit;
  letter-spacing: inherit;
  text-align: left;
  overflow-wrap: anywhere;
  cursor: pointer;
}

.feed-post-open:hover {
  color: var(--accent);
}

/* Holds the place of a body still to come, so the posts below it stay out of
   the part of the feed that loads. */
.feed-post-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 240px;
}

.feed-post-spinner {
  width: 28px;
  height: 28px;
  border-width: 3px;
  margin-bottom: 0;
}

.feed-post-status {
  color: var(--text-secondary);
  font-size: 14px;
}

@media (max-width: 600px) {
  .feed {
    padding-inline: 12px;
  }

  .feed-post-title {
    font-size: 22px;
  }
}
</style>
