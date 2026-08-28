<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useAuth } from '../composables/useAuth'
import { useInboxStore } from '../stores/inbox'
import ScheduleMenu from '../components/ScheduleMenu.vue'
import { scheduleChoices } from '../utils/schedule'

const store = useInboxStore()
const { user } = useAuth()

// "AI Today" shows what the data-enricher Worker gathered overnight: tasks
// (Todoist tasks due today plus action items extracted from important mail)
// and a three-tier triage of the last 24 hours of inbox mail. Reply Needed and
// Review are shown as priority groups; Noise is summarized rather than listed.
// Completing a task hides it immediately, then persists via the store (which closes it in
// Todoist); a failure rolls the row back.
// Dismissing a priority item's done checkbox hides it immediately (mirroring
// completeTask below), so groups are re-derived to drop dismissed items and
// any group left with none.
const completingItemIds = ref(new Set())
const priorityGroups = computed(() =>
  (store.digest?.topics ?? [])
    .map((topic) => ({
      ...topic,
      items: topic.items.filter((item) => !completingItemIds.value.has(item.message_id)),
    }))
    .filter((topic) => topic.items.length > 0),
)
const priorityGroupCount = computed(() => priorityGroups.value.length)
const priorityGroupLabel = computed(() =>
  priorityGroupCount.value === 1 ? 'priority group' : 'priority groups',
)
const noiseCount = computed(() => store.digest?.noise?.count ?? 0)
const noiseSummary = computed(() =>
  (store.digest?.noise?.categories ?? [])
    .map((item) => `${item.count} ${item.category}`)
    .join(' · '),
)
const newsSections = computed(() => store.news?.sections ?? [])

const completingTaskIds = ref(new Set())
// The API already orders these most-pressing first (soonest due, then highest
// priority), so render them in the order they arrive rather than by source.
const tasks = computed(() => store.tasks.filter((t) => !completingTaskIds.value.has(t.id)))
const activeCount = computed(() => tasks.value.length)

const firstName = computed(
  () =>
    String(user.value?.name || '')
      .trim()
      .split(/\s+/)[0],
)

// Presets for both reschedule menus below (Later today/Tomorrow/This
// weekend/Next week) - recomputed each time a menu opens so the dates are
// current for the clock, not cached once at mount.
const reschedulingTaskId = ref(null)
const reschedulingItemId = ref(null)
const scheduleOptions = computed(() =>
  reschedulingTaskId.value !== null || reschedulingItemId.value !== null ? scheduleChoices() : [],
)

// Clicking anywhere outside an open menu dismisses it, the same way the
// traditional inbox's schedule menus behave. Clicks inside the wrapper are
// left alone: the toggle button and the menu items own those.
function onDocumentClick(event) {
  if (event.target.closest('.ni-schedule-wrap')) return
  reschedulingTaskId.value = null
  reschedulingItemId.value = null
}

async function completeTask(task) {
  completingTaskIds.value = new Set(completingTaskIds.value).add(task.id)
  try {
    await store.completeTask(task.id)
    store.notify(`Marked "${task.content}" done.`)
  } catch {
    const next = new Set(completingTaskIds.value)
    next.delete(task.id)
    completingTaskIds.value = next
    store.notify('Failed to mark task done.', 'error')
  }
}

// Reschedules a to-do to another day. A task moved to a future day is hidden
// from today's list immediately (mirroring completeTask's optimistic removal
// via completingTaskIds); one moved to later today stays visible.
async function rescheduleTask(task, choice) {
  reschedulingTaskId.value = null
  // Compare local calendar days, not UTC date strings — toISOString() shifts
  // the date backwards in forward timezones, so "Tomorrow" at 11pm in UTC+10
  // would incorrectly appear as today.
  const now = new Date()
  const hidesToday = choice.date.toDateString() !== now.toDateString()
  // Send a local YYYY-MM-DD string so the server receives the calendar day
  // the user actually sees, not the UTC-coerced one.
  const dueDate = `${choice.date.getFullYear()}-${String(choice.date.getMonth() + 1).padStart(2, '0')}-${String(choice.date.getDate()).padStart(2, '0')}`
  if (hidesToday) completingTaskIds.value = new Set(completingTaskIds.value).add(task.id)
  try {
    await store.rescheduleTask(task.id, dueDate)
    store.notify(`Moved "${task.content}" to ${choice.label.toLowerCase()}.`)
  } catch {
    if (hidesToday) {
      const next = new Set(completingTaskIds.value)
      next.delete(task.id)
      completingTaskIds.value = next
    }
    store.notify('Failed to reschedule task.', 'error')
  }
}

const markingTopic = ref(null)

function unreadCount(topic) {
  return topic.items.filter((item) => item.unread).length
}

async function markTopicRead(topic) {
  if (markingTopic.value) return
  markingTopic.value = topic.title
  const wanted = unreadCount(topic)
  try {
    const marked = await store.markTopicRead(topic)
    if (marked < wanted) {
      // The dots still showing are the ones that failed.
      store.notify('Some emails could not be marked read.', 'error')
    } else {
      store.notify(`Marked ${marked} ${marked === 1 ? 'email' : 'emails'} read.`)
    }
  } finally {
    markingTopic.value = null
  }
}

async function completeTopicItem(item) {
  completingItemIds.value = new Set(completingItemIds.value).add(item.message_id)
  try {
    await store.markTopicItemRead(item)
    store.notify(`Marked "${item.headline}" done.`)
  } catch {
    const next = new Set(completingItemIds.value)
    next.delete(item.message_id)
    completingItemIds.value = next
    store.notify('Failed to mark email done.', 'error')
  }
}

// Reschedules a triage item's message to reappear in a later digest, hiding
// it from view immediately the same way completeTopicItem does.
async function rescheduleDigestItem(item, choice) {
  reschedulingItemId.value = null
  completingItemIds.value = new Set(completingItemIds.value).add(item.message_id)
  try {
    await store.rescheduleDigestItem(item, choice.date.toISOString())
    store.notify(`Moved "${item.headline}" to ${choice.label.toLowerCase()}.`)
  } catch {
    const next = new Set(completingItemIds.value)
    next.delete(item.message_id)
    completingItemIds.value = next
    store.notify('Failed to reschedule email.', 'error')
  }
}

async function draftFollowUp(task) {
  const generated = await store.draftFollowUp(task)
  if (generated) store.notify('Follow-up draft ready to review.')
}

// External links (tasks from Todoist via /api/tasks, news from GitHub /
// Product Hunt / RSS feeds) are untrusted: only ever render a real web link
// as an href, so an unexpected value can't become a javascript:/data: navigation.
function safeHref(url) {
  try {
    const { protocol } = new URL(url)
    return protocol === 'https:' || protocol === 'http:' ? url : null
  } catch {
    return null
  }
}

function taskLink(task) {
  return safeHref(task.url)
}

function newsLink(item) {
  return safeHref(item.url)
}

// How stale the gathered set is, from the most recent of: a task's
// gathered_at, or the digest's/news's created_at. Refresh only ever rebuilds
// the digest and news (tasks come from Todoist/email gathering, untouched by
// it), so anchoring this to tasks alone left the status text - the one
// visible sign a refresh did anything - stuck on the last overnight run even
// after a successful rebuild. `now` is only re-read on mount and on refresh;
// this is a dashboard glanced at, not a live clock.
const now = ref(Date.now())

const gatheredAt = computed(() => {
  const stamps = [
    ...store.tasks.map((t) => Date.parse(t.gathered_at)),
    Date.parse(store.digest?.created_at),
    Date.parse(store.news?.created_at),
  ].filter((ms) => Number.isFinite(ms))
  return stamps.length ? Math.max(...stamps) : null
})

const statusTime = computed(() => {
  if (gatheredAt.value === null) return 'Not gathered yet'
  const minutes = Math.floor((now.value - gatheredAt.value) / 60_000)
  if (minutes < 1) return 'Updated just now'
  if (minutes < 60) return `Updated ${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `Updated ${hours}h ago`
  return `Updated ${Math.floor(hours / 24)}d ago`
})

const isRefreshing = ref(false)

// Rebuild triage first so refreshing surfaces mail that arrived since the
// overnight run, then re-read. A deployment without the enricher wired up
// still gets the plain re-read rather than an error.
async function refresh() {
  if (isRefreshing.value) return
  isRefreshing.value = true
  try {
    await store.rebuildDigest()
  } catch {
    store.notify('Could not rebuild the digest; showing the latest stored one.', 'error')
  }
  try {
    await store.loadTasks({ force: true })
    now.value = Date.now()
    store.notify('AI Today updated.')
  } finally {
    isRefreshing.value = false
  }
}

onMounted(async () => {
  document.addEventListener('click', onDocumentClick)
  await store.loadTasks()
  now.value = Date.now()
})

onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick)
})
</script>

<template>
  <div class="view-panel active ai-today-view" aria-labelledby="ai-today-title">
    <div class="ai-header">
      <div class="beta-badge">Beta</div>
      <h1 id="ai-today-title" class="ai-greeting">
        Hi{{ firstName ? ` ${firstName}` : '' }} 👋 You have
        <span class="counter-text">{{ activeCount }} to-dos</span>
        and
        <span class="counter-text">{{ priorityGroupCount }} {{ priorityGroupLabel }}</span>
        to work through.
      </h1>
      <div
        class="ai-update-status"
        role="button"
        tabindex="0"
        @click="refresh"
        @keydown.enter="refresh"
      >
        <span class="status-time">{{ statusTime }}</span>
        <span class="material-symbols-outlined refresh-icon" :class="{ refreshing: isRefreshing }">
          sync
        </span>
      </div>
    </div>

    <div class="ai-cards-container">
      <!-- SUGGESTED TO-DOS -->
      <section class="ai-card todo-card">
        <div class="card-header">
          <h2>Suggested to-dos</h2>
        </div>

        <TransitionGroup name="todo-list" tag="div" class="todo-rows" data-testid="task-rows">
          <div v-for="task in tasks" :key="task.id" class="todo-row">
            <div class="todo-checkbox-container">
              <button class="todo-check-btn" title="Mark done" @click="completeTask(task)">
                <span class="material-symbols-outlined">circle</span>
              </button>
            </div>

            <div class="todo-text">
              <strong>{{ task.content }}</strong
              ><template v-if="task.description"> – {{ task.description }}</template>
              <span class="from-links-container">
                From:
                <span class="email-link">{{
                  task.source === 'todoist' ? 'Todoist' : 'Email'
                }}</span>
              </span>
            </div>

            <div class="todo-actions">
              <a
                v-if="taskLink(task)"
                class="action-pill-btn"
                :href="taskLink(task)"
                target="_blank"
                rel="noopener noreferrer"
              >
                <span class="material-symbols-outlined">open_in_new</span>
                <span>Open</span>
              </a>
              <button
                v-else-if="task.message_id"
                class="action-pill-btn"
                :disabled="Boolean(store.followUpDraftTaskId)"
                :aria-busy="store.followUpDraftTaskId === task.id"
                @click="draftFollowUp(task)"
              >
                <span class="material-symbols-outlined">edit</span>
                <span>{{ store.followUpDraftTaskId === task.id ? 'Drafting…' : 'Draft' }}</span>
              </button>
              <div class="ni-schedule-wrap">
                <button
                  class="action-pill-btn"
                  aria-haspopup="menu"
                  :aria-expanded="reschedulingTaskId === task.id"
                  @click="reschedulingTaskId = reschedulingTaskId === task.id ? null : task.id"
                >
                  <span class="material-symbols-outlined">schedule</span>
                  <span>Reschedule</span>
                </button>
                <ScheduleMenu
                  v-if="reschedulingTaskId === task.id"
                  :choices="scheduleOptions"
                  submit-label="Reschedule"
                  @select="(choice) => rescheduleTask(task, choice)"
                />
              </div>
            </div>
          </div>
        </TransitionGroup>

        <p v-if="!tasks.length" class="todo-empty" data-testid="tasks-empty">
          Nothing gathered for today. Todoist tasks due today and action items from important mail
          show up here after the overnight run.
        </p>
      </section>

      <!-- EMAIL TRIAGE -->
      <section class="ai-card topics-card">
        <div class="card-header">
          <h2>Email triage</h2>
        </div>

        <p v-if="store.digest?.overview" class="triage-overview">
          {{ store.digest.overview }}
        </p>

        <div v-if="priorityGroups.length" class="topics-container" data-testid="topic-sections">
          <div v-for="topic in priorityGroups" :key="topic.title" class="topic-section">
            <div class="topic-title-row">
              <h3 class="topic-title">{{ topic.emoji }} {{ topic.title }}</h3>
            </div>
            <TransitionGroup name="todo-list" tag="div" class="topic-emails">
              <div
                v-for="item in topic.items"
                :key="item.message_id"
                class="topic-email-row topic-catchup-row"
              >
                <div class="todo-checkbox-container">
                  <button class="todo-check-btn" title="Mark done" @click="completeTopicItem(item)">
                    <span class="material-symbols-outlined">circle</span>
                  </button>
                </div>
                <p>
                  <strong>{{ item.headline }}</strong> – {{ item.note }} From:
                  <span class="email-link">Email</span>
                  <span v-if="item.unread" class="unread-dot"></span>
                </p>
                <div class="ni-schedule-wrap">
                  <button
                    class="todo-check-btn"
                    title="Reschedule"
                    aria-haspopup="menu"
                    :aria-expanded="reschedulingItemId === item.message_id"
                    @click="
                      reschedulingItemId =
                        reschedulingItemId === item.message_id ? null : item.message_id
                    "
                  >
                    <span class="material-symbols-outlined">schedule</span>
                  </button>
                  <ScheduleMenu
                    v-if="reschedulingItemId === item.message_id"
                    :choices="scheduleOptions"
                    submit-label="Reschedule"
                    @select="(choice) => rescheduleDigestItem(item, choice)"
                  />
                </div>
              </div>
            </TransitionGroup>
            <div class="topic-footer">
              <div class="topic-meta">
                <span class="material-symbols-outlined font-sm">link</span>
                <span
                  >{{ topic.items.length }}
                  {{ topic.items.length === 1 ? 'source' : 'sources' }}</span
                >
              </div>
              <button
                v-if="unreadCount(topic)"
                class="topic-action-btn"
                :disabled="markingTopic === topic.title"
                @click="markTopicRead(topic)"
              >
                Mark all emails as read
              </button>
            </div>
          </div>
        </div>

        <div v-if="noiseCount" class="triage-noise" data-testid="triage-noise">
          <span class="material-symbols-outlined" aria-hidden="true">filter_alt</span>
          <div>
            <strong
              >{{ noiseCount }} {{ noiseCount === 1 ? 'email' : 'emails' }} classified as
              Noise</strong
            >
            <span v-if="noiseSummary">{{ noiseSummary }}</span>
            <span>Hidden from AI Inbox; nothing was archived or deleted.</span>
          </div>
        </div>

        <p v-if="!priorityGroups.length" class="topic-empty" data-testid="topics-empty">
          No Reply Needed or Review mail in the last 24 hours.
        </p>
      </section>

      <!-- TODAY'S NEWS -->
      <section class="ai-card topics-card">
        <div class="card-header">
          <h2>Today's news</h2>
        </div>

        <div v-if="newsSections.length" class="topics-container" data-testid="news-sections">
          <div v-for="section in newsSections" :key="section.title" class="topic-section">
            <div class="topic-title-row">
              <h3 class="topic-title">{{ section.emoji }} {{ section.title }}</h3>
            </div>
            <div class="topic-emails">
              <div v-for="item in section.items" :key="item.url" class="topic-email-row">
                <p>
                  <a
                    class="news-link"
                    :href="newsLink(item)"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {{ item.title }}
                  </a>
                  <template v-if="item.description"> – {{ item.description }}</template>
                  <span v-if="item.note" class="news-note">{{ item.note }}</span>
                  <span v-if="item.meta" class="news-meta">{{ item.meta }}</span>
                </p>
              </div>
            </div>
          </div>
        </div>

        <p v-else class="topic-empty" data-testid="news-empty">
          No news yet. The overnight run gathers GitHub, Product Hunt and UK headlines — add topics
          under Settings → Personalisation to have the first two picked for you.
        </p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.ai-update-status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  width: fit-content;
  padding: 4px 8px;
  border-radius: 4px;
  transition: background-color var(--transition-fast);
}

.ai-update-status:hover {
  background-color: var(--bg-hover);
}

.refresh-icon {
  font-size: 14px;
}

/* The fetch has no fixed duration, so spin until it resolves. */
.refreshing {
  animation: refresh-spin 0.6s linear infinite;
}

@keyframes refresh-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .refreshing {
    animation: none;
  }
}

.news-link {
  font-weight: 600;
  color: var(--text-primary);
  text-decoration: none;
}

.news-link:hover {
  text-decoration: underline;
}

/* The model's reason this item is worth the reader's time. */
.news-note {
  display: block;
  margin-top: 2px;
  color: var(--text-secondary);
  font-size: 12px;
  font-style: italic;
}

.news-meta {
  margin-left: 6px;
  color: var(--text-secondary);
  font-size: 12px;
}

.triage-overview {
  margin: 0;
  padding: 14px 16px 0;
  color: var(--text-secondary);
  font-size: 13px;
}

.triage-noise {
  display: flex;
  gap: 10px;
  margin: 12px 16px 16px;
  padding: 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  color: var(--text-secondary);
  background: var(--bg-secondary);
}

.triage-noise > .material-symbols-outlined {
  flex: 0 0 auto;
  font-size: 18px;
}

.triage-noise div,
.triage-noise span {
  display: block;
}

.triage-noise strong {
  display: block;
  margin-bottom: 2px;
  color: var(--text-primary);
  font-size: 13px;
}

.triage-noise div span {
  font-size: 12px;
}

.todo-empty,
.topic-empty {
  padding: 16px;
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary);
}

.from-links-container {
  color: var(--text-secondary);
  margin-left: 4px;
  font-size: 12px;
}

/* List transitions for the suggested to-dos */
.todo-list-enter-active,
.todo-list-leave-active {
  transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);
}

.todo-list-enter-from {
  opacity: 0;
  transform: translateY(20px);
}

.todo-list-leave-to {
  opacity: 0;
  transform: translateX(-30px);
  max-height: 0;
  padding-top: 0;
  padding-bottom: 0;
  margin: 0;
  border: none;
}
</style>
