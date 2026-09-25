<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useAuth } from '../composables/useAuth'
import { useInboxStore } from '../stores/inbox'
import ScheduleMenu from '../components/ScheduleMenu.vue'
import { scheduleChoices } from '../utils/schedule'

const store = useInboxStore()
const { user } = useAuth()

// "AI Today" shows what the data-enricher Worker gathered overnight: tasks
// (built-in Tasks-app items due today or overdue plus action items extracted
// from important mail) and a three-tier triage of the last 24 hours of inbox
// mail. Reply Needed and Review are shown as priority groups; Noise is
// summarized rather than listed.
// Completing a task hides it immediately, then persists via the store (which
// completes it in the Tasks app); a failure rolls the row back.
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
// The triage card is worth showing for any of the three things it can hold —
// the overview line, the priority groups, or the noise summary.
const hasTriage = computed(
  () => priorityGroups.value.length > 0 || noiseCount.value > 0 || Boolean(store.digest?.overview),
)
const noiseSummary = computed(() =>
  (store.digest?.noise?.categories ?? [])
    .map((item) => `${item.count} ${item.category}`)
    .join(' · '),
)
const newsSections = computed(() => store.news?.sections ?? [])
const newsCollapsedKey = 'cookie-world-today-collapsed'
// Storage can be blocked (SecurityError); the toggle then just isn't remembered.
function readNewsCollapsed() {
  try {
    return localStorage.getItem(newsCollapsedKey) === 'true'
  } catch {
    return false
  }
}
const newsCollapsed = ref(readNewsCollapsed())

function toggleNews() {
  newsCollapsed.value = !newsCollapsed.value
  try {
    localStorage.setItem(newsCollapsedKey, String(newsCollapsed.value))
  } catch {
    // Storage disabled; keep the in-memory state.
  }
}

const completingTaskIds = ref(new Set())
// The API already orders these most-pressing first (soonest due, then highest
// priority), so render them in the order they arrive rather than by source.
const tasks = computed(() => store.tasks.filter((t) => !completingTaskIds.value.has(t.id)))
const activeCount = computed(() => tasks.value.length)

// Auth0 fills `name` with the email address when the identity provider has no
// real name for the account, and "Hi allisteraall@gmail.com" reads like a form
// letter. Prefer the claims that carry an actual name, and greet without one
// rather than print an address.
const greetingName = computed(() => {
  const claims = user.value ?? {}
  const named = [claims.given_name, claims.nickname, claims.name]
    .map((claim) => String(claim ?? '').trim())
    .find((claim) => claim && !claim.includes('@'))
  return named ? named.split(/\s+/)[0] : ''
})

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
    await store.completeTopicItem(item)
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

// External links (news from GitHub / Product Hunt / RSS feeds) are untrusted:
// only ever render a real web link as an href, so an unexpected value can't
// become a javascript:/data: navigation.
function safeHref(url) {
  try {
    const { protocol } = new URL(url)
    return protocol === 'https:' || protocol === 'http:' ? url : null
  } catch {
    return null
  }
}

function newsLink(item) {
  return safeHref(item.url)
}

onMounted(async () => {
  document.addEventListener('click', onDocumentClick)
  await store.loadTasks()
})

onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick)
})
</script>

<template>
  <div class="view-panel active ai-today-view" aria-labelledby="ai-today-title">
    <div class="ai-header">
      <div class="beta-badge">Beta</div>
      <!-- A count of zero is not news: drop each counter that has nothing in
         it, and the whole sentence when both are empty. -->
      <h1 id="ai-today-title" class="ai-greeting">
        Hi{{ greetingName ? ` ${greetingName}` : '' }}! 👋
        <template v-if="activeCount || priorityGroupCount">
          You have
          <span v-if="activeCount" class="counter-text">{{ activeCount }} to-dos</span>
          <template v-if="activeCount && priorityGroupCount"> and </template>
          <span v-if="priorityGroupCount" class="counter-text"
            >{{ priorityGroupCount }} {{ priorityGroupLabel }}</span
          >
          to work through.
        </template>
      </h1>
    </div>

    <div class="ai-cards-container">
      <!-- The greeting alone looks like "nothing to do", so say when the day
           is still loading or could not be prepared. -->
      <div
        v-if="store.isTasksLoading && !store.tasksLoaded"
        class="ai-state ai-state-loading"
        data-testid="today-loading"
        role="status"
        aria-label="Preparing your day"
      >
        <div class="spinner"></div>
      </div>

      <div
        v-else-if="store.tasksError && !store.tasksLoaded"
        class="ai-state ai-state-error"
        data-testid="today-error"
        role="alert"
      >
        <p>{{ store.tasksError }}</p>
        <button type="button" class="btn btn-secondary" @click="store.loadTasks({ force: true })">
          Try again
        </button>
      </div>

      <!-- SUGGESTED TO-DOS -->
      <section v-if="tasks.length" class="ai-card todo-card" data-testid="todo-card">
        <div class="card-header">
          <h2>Suggested to-dos</h2>
        </div>

        <TransitionGroup name="todo-list" tag="div" class="todo-rows" data-testid="task-rows">
          <div v-for="task in tasks" :key="task.id" class="todo-row">
            <div class="todo-checkbox-container">
              <button
                class="todo-check-btn"
                title="Mark done"
                :aria-label="`Mark done: ${task.content}`"
                @click="completeTask(task)"
              >
                <span class="material-symbols-outlined">circle</span>
              </button>
            </div>

            <div class="todo-text">
              <strong>{{ task.content }}</strong
              ><template v-if="task.description"> – {{ task.description }}</template>
              <span class="from-links-container">
                From:
                <span class="email-link">{{ task.source === 'task' ? 'Tasks' : 'Email' }}</span>
              </span>
            </div>

            <div class="todo-actions">
              <RouterLink
                v-if="task.source === 'task'"
                class="action-pill-btn"
                :to="{ path: '/tasks', query: { project: 'today', task: task.id } }"
              >
                <span class="material-symbols-outlined">open_in_new</span>
                <span>Open</span>
              </RouterLink>
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
      </section>

      <!-- EMAIL TRIAGE -->
      <section v-if="hasTriage" class="ai-card topics-card" data-testid="triage-card">
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
                  <button
                    class="todo-check-btn"
                    title="Mark done"
                    :aria-label="`Mark done: ${item.headline}`"
                    @click="completeTopicItem(item)"
                  >
                    <span class="material-symbols-outlined">circle</span>
                  </button>
                </div>
                <p>
                  <strong>{{ item.headline }}</strong> – {{ item.note }} From:
                  <RouterLink
                    class="email-link"
                    :to="{ path: '/inbox', query: { open: item.message_id } }"
                    :title="`Open: ${item.headline}`"
                    >Email</RouterLink
                  >
                  <span v-if="item.unread" class="unread-dot"></span>
                </p>
                <div class="ni-schedule-wrap">
                  <button
                    class="todo-check-btn"
                    title="Reschedule"
                    :aria-label="`Reschedule: ${item.headline}`"
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
      </section>

      <!-- THE WORLD TODAY -->
      <section class="ai-card topics-card">
        <div class="card-header world-today-header">
          <button
            class="world-today-toggle"
            type="button"
            data-testid="world-today-toggle"
            :aria-expanded="!newsCollapsed"
            aria-controls="world-today-content"
            :aria-label="`${newsCollapsed ? 'Expand' : 'Collapse'} The World Today`"
            @click="toggleNews"
          >
            <h2>The World Today</h2>
            <span class="material-symbols-outlined world-today-chevron" aria-hidden="true">
              expand_more
            </span>
          </button>
        </div>

        <div
          v-if="!newsCollapsed && newsSections.length"
          id="world-today-content"
          class="topics-container"
          data-testid="news-sections"
        >
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

        <p
          v-else-if="!newsCollapsed"
          id="world-today-content"
          class="topic-empty"
          data-testid="news-empty"
        >
          No news yet. The scheduled run gathers GitHub, Product Hunt and UK headlines — add topics
          under Settings → Personalisation to personalise Product Hunt and optionally GitHub.
        </p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.world-today-header {
  padding: 0;
}

.world-today-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 16px 24px;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.world-today-chevron {
  color: var(--text-secondary);
  transition: transform var(--transition-fast);
}

.world-today-toggle[aria-expanded='false'] .world-today-chevron {
  transform: rotate(-90deg);
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

.ai-state {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 24px 0;
  color: var(--text-secondary);
}

.ai-state-loading {
  justify-content: center;
}

.ai-state p {
  margin: 0;
}
</style>
