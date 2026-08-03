<script setup>
import { computed, onMounted, ref } from 'vue'
import { useAuth } from '../composables/useAuth'
import { useInboxStore } from '../stores/inbox'

const store = useInboxStore()
const { user } = useAuth()

// "AI Today" lists what the data-enricher Worker gathered overnight into
// public.tasks: Todoist tasks due today, plus action items it extracted from
// important mail. The "Topics to catch up on" card below is still a design
// mock. Completing a task hides it immediately, then persists via the store
// (which closes it in Todoist); a failure rolls the row back.
const topicCount = 4

const completingTaskIds = ref(new Set())
// The API already orders these most-pressing first (soonest due, then highest
// priority), so render them in the order they arrive rather than by source.
const tasks = computed(() => store.tasks.filter((t) => !completingTaskIds.value.has(t.id)))
const activeCount = computed(() => tasks.value.length)

const firstName = computed(() => String(user.value?.name || '').trim().split(/\s+/)[0])

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

async function draftFollowUp(task) {
  const generated = await store.draftFollowUp(task)
  if (generated) store.notify('Follow-up draft ready to review.')
}

// Task links come from Todoist via /api/tasks. Only ever render a real web link
// as an href, so an unexpected value can't become a javascript:/data: navigation.
function taskLink(task) {
  try {
    const { protocol } = new URL(task.url)
    return protocol === 'https:' || protocol === 'http:' ? task.url : null
  } catch {
    return null
  }
}

// How stale the gathered set is, from the most recent gathered_at the enricher
// stamped. `now` is only re-read on mount and on refresh; this is a dashboard
// glanced at, not a live clock.
const now = ref(Date.now())

const gatheredAt = computed(() => {
  const stamps = store.tasks
    .map((t) => Date.parse(t.gathered_at))
    .filter((ms) => Number.isFinite(ms))
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

async function refresh() {
  if (isRefreshing.value) return
  isRefreshing.value = true
  try {
    await store.loadTasks({ force: true })
    now.value = Date.now()
  } finally {
    isRefreshing.value = false
  }
}

onMounted(async () => {
  await store.loadTasks()
  now.value = Date.now()
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
        <span class="counter-text">{{ topicCount }} topics</span>
        to catch up on.
      </h1>
      <div class="ai-update-status" role="button" tabindex="0" @click="refresh" @keydown.enter="refresh">
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
                <span class="email-link">{{ task.source === 'todoist' ? 'Todoist' : 'Email' }}</span>
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
              <button class="icon-btn" title="More options">
                <span class="material-symbols-outlined">more_vert</span>
              </button>
            </div>
          </div>
        </TransitionGroup>

        <p v-if="!tasks.length" class="todo-empty" data-testid="tasks-empty">
          Nothing gathered for today. Todoist tasks due today and action items from important mail
          show up here after the overnight run.
        </p>
      </section>

      <!-- TOPICS TO CATCH UP ON -->
      <section class="ai-card topics-card">
        <div class="card-header">
          <h2>Topics to catch up on</h2>
        </div>

        <div class="topics-container">
          <!-- Kitchen Renovation -->
          <div class="topic-section">
            <div class="topic-title-row">
              <h3 class="topic-title">🍳 Kitchen Renovation</h3>
              <button class="icon-btn" title="More options">
                <span class="material-symbols-outlined">more_vert</span>
              </button>
            </div>
            <div class="topic-emails">
              <div class="topic-email-row">
                <p>
                  <strong>Revised Floor Plan</strong> – City Construction sent a revised design this
                  morning that takes into account the desire to redo the bay window, so you can get
                  more natural light in your kitchen. From:
                  <span class="email-link">Email</span>
                  <span class="unread-dot"></span>
                </p>
              </div>
              <div class="topic-email-row">
                <p>
                  <strong>Insurance Claim Processed</strong> – Your homeowner's insurance carrier has
                  processed your claim and you should expect to hear back in one week. From:
                  <span class="email-link">Email</span>
                  <span class="unread-dot"></span>
                </p>
              </div>
            </div>
            <div class="topic-footer">
              <div class="topic-meta">
                <span class="material-symbols-outlined font-sm">link</span>
                <span>2 sources</span>
              </div>
              <button class="topic-action-btn">Mark all emails as read</button>
            </div>
          </div>

          <!-- College Search -->
          <div class="topic-section">
            <div class="topic-title-row">
              <h3 class="topic-title">🎓 College Search</h3>
              <button class="icon-btn" title="More options">
                <span class="material-symbols-outlined">more_vert</span>
              </button>
            </div>
            <div class="topic-emails">
              <div class="topic-email-row">
                <p>
                  <strong>New Application Dates</strong> – Lincoln High shared new FAFSA deadlines,
                  which shifted from last year. From:
                  <span class="email-link">Email</span>
                  <span class="unread-dot"></span>
                </p>
              </div>
              <div class="topic-email-row">
                <p>
                  <strong>Webinar Recording Available</strong> – The "College Prep 101" webinar
                  recording was shared and provides valuable application information. From:
                  <span class="email-link">Email</span>
                  <span class="unread-dot"></span>
                </p>
              </div>
              <div class="topic-email-row">
                <p>
                  <strong>Scholarship for the Arts</strong> – The Lincoln High college counselor
                  mentioned that your daughter might qualify for this specific aid package. From:
                  <span class="email-link">Email</span>
                  <span class="unread-dot"></span>
                </p>
              </div>
            </div>
            <div class="topic-footer">
              <div class="topic-meta">
                <span class="material-symbols-outlined font-sm">link</span>
                <span>3 sources</span>
              </div>
              <button class="topic-action-btn">Mark all emails as read</button>
            </div>
          </div>

          <!-- Soccer Spring Season -->
          <div class="topic-section">
            <div class="topic-title-row">
              <h3 class="topic-title">⚽ Soccer Spring Season</h3>
              <button class="icon-btn" title="More options">
                <span class="material-symbols-outlined">more_vert</span>
              </button>
            </div>
            <div class="topic-emails">
              <div class="topic-email-row">
                <p>
                  <strong>Practice Location Moved</strong> – The U10 team scrimmage has moved to West
                  Side Park for the rest of the month due to field maintenance. From:
                  <span class="email-link">Email</span>
                  •
                  <span class="email-link">Doc</span>
                  <span class="unread-dot"></span>
                </p>
              </div>
              <div class="topic-email-row">
                <p>
                  <strong>Team Pizza Party</strong> – Parents are debating if this should be held
                  before or after semifinals. From:
                  <span class="email-link">Email</span>
                  <span class="unread-dot"></span>
                </p>
              </div>
            </div>
            <div class="topic-footer">
              <div class="topic-meta">
                <span class="material-symbols-outlined font-sm">link</span>
                <span>2 sources</span>
              </div>
              <button class="topic-action-btn">Mark all emails as read</button>
            </div>
          </div>

          <!-- More Updates -->
          <div class="topic-section">
            <div class="topic-title-row">
              <h3 class="topic-title">📣 More Updates</h3>
              <button class="icon-btn" title="More options">
                <span class="material-symbols-outlined">more_vert</span>
              </button>
            </div>
            <div class="topic-emails">
              <div class="topic-email-row">
                <p>
                  <strong>Chicago Summer Trip</strong> – Your room at the Palm House was upgraded from
                  Standard to Deluxe. From: <span class="email-link">Email</span>
                  <span class="unread-dot"></span>
                </p>
              </div>
              <div class="topic-email-row">
                <p>
                  <strong>Resale Marketplace Sale</strong> – You sold the baby winter coat bundle for
                  $15. Please contact buyer within 3 days. From:
                  <span class="email-link">Email</span> <span class="unread-dot"></span>
                </p>
              </div>
              <div class="topic-email-row">
                <p>
                  <strong>Resale Marketplace Inquiry</strong> – A buyer asked if the toddler shoe lot
                  is still available. From: <span class="email-link">Email</span>
                  <span class="unread-dot"></span>
                </p>
              </div>
            </div>
            <div class="topic-footer">
              <div class="topic-meta">
                <span class="material-symbols-outlined font-sm">link</span>
                <span>3 sources</span>
              </div>
              <button class="topic-action-btn">Mark all emails as read</button>
            </div>
          </div>
        </div>
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

.todo-empty {
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
