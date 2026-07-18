<script setup>
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useInboxStore } from '../stores/inbox'

const MAX_PRIORITIES = 5

const store = useInboxStore()
const router = useRouter()

// "Needs attention" surfaces gathered tasks (Todoist tasks + AI-extracted email
// action items) from public.tasks rather than raw unread emails.
const tasks = computed(() => store.tasks)

function formatDue(due) {
  if (!due) return ''
  const date = new Date(due)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function taskMeta(task) {
  const parts = []
  if (task.priority === 4) parts.push('Urgent')
  parts.push(task.source === 'email' ? 'From email' : 'Todoist')
  const due = formatDue(task.due_date)
  if (due) parts.push(`Due ${due}`)
  return parts.join(' · ')
}

onMounted(() => store.loadTasks())

const summarizedEmails = computed(() =>
  store.traditionalEmails.filter((email) => email.hasAiSummary).slice(0, MAX_PRIORITIES),
)

const unreadLabel = computed(() => `${store.unreadInboxCount} unread`)

function openEmail(email) {
  store.openReader(email)
  router.push({ name: 'traditional-inbox' })
}

function askCookie() {
  store.askGemini('What needs my attention in my inbox?')
}
</script>

<template>
  <section class="view-panel active ai-inbox-view" aria-labelledby="ai-inbox-title">
    <header class="ai-header ai-inbox-header">
      <div>
        <span class="beta-badge">AI</span>
        <h1 id="ai-inbox-title" class="ai-greeting">AI Inbox</h1>
        <p class="ai-inbox-subtitle">
          Your live inbox, with the messages that still need your attention.
        </p>
      </div>
      <div class="ai-inbox-header-actions">
        <span class="ai-inbox-count" data-testid="ai-unread-count">{{ unreadLabel }}</span>
      </div>
    </header>

    <div class="ai-cards-container">
      <section class="ai-card" aria-labelledby="priority-title">
        <div class="card-header ai-inbox-card-header">
          <div>
            <h2 id="priority-title">Needs attention</h2>
            <p>Tasks and action items gathered from your tools and email.</p>
          </div>
          <button class="action-pill-btn" type="button" @click="askCookie">
            <span class="material-symbols-outlined">auto_awesome</span>
            <span>Ask Cookie</span>
          </button>
        </div>

        <div v-if="tasks.length" class="ai-inbox-email-list" data-testid="ai-priority-list">
          <article v-for="task in tasks" :key="task.id" class="ai-inbox-email-row">
            <div class="ai-inbox-email-copy">
              <span
                class="material-symbols-outlined ai-task-icon"
                :class="{ 'ai-task-urgent': task.priority === 4 }"
              >
                {{ task.source === 'email' ? 'mail' : 'task_alt' }}
              </span>
              <div>
                <p class="ai-inbox-subject">{{ task.content }}</p>
                <p v-if="task.description" class="ai-inbox-snippet">{{ task.description }}</p>
                <p class="ai-inbox-sender">{{ taskMeta(task) }}</p>
              </div>
            </div>
            <a
              v-if="task.url"
              class="action-pill-btn ai-inbox-open"
              :href="task.url"
              target="_blank"
              rel="noopener noreferrer"
            >
              Open
            </a>
          </article>
        </div>
        <p v-else class="ai-inbox-empty">Nothing needs your attention right now.</p>
      </section>

      <section class="ai-card" aria-labelledby="summary-title">
        <div class="card-header ai-inbox-card-header">
          <div>
            <h2 id="summary-title">Ready to catch up</h2>
            <p>Messages with an AI summary you can reopen anytime.</p>
          </div>
        </div>

        <div v-if="summarizedEmails.length" class="ai-inbox-email-list" data-testid="ai-summary-list">
          <article v-for="email in summarizedEmails" :key="email.id" class="ai-inbox-email-row">
            <div class="ai-inbox-email-copy">
              <span class="material-symbols-outlined gemini-color ai-inbox-summary-icon">auto_awesome</span>
              <div>
                <p class="ai-inbox-sender">{{ email.sender }}</p>
                <p class="ai-inbox-subject">{{ email.subject || '(No subject)' }}</p>
                <p v-if="email.snippet" class="ai-inbox-snippet">{{ email.snippet }}</p>
              </div>
            </div>
            <button class="action-pill-btn ai-inbox-open" type="button" @click="openEmail(email)">
              Open
            </button>
          </article>
        </div>
        <p v-else class="ai-inbox-empty">Summarize an email to see it here.</p>
      </section>
    </div>
  </section>
</template>

<style scoped>
.ai-inbox-header {
  flex-direction: row;
  align-items: flex-start;
  justify-content: space-between;
}

.ai-inbox-subtitle,
.ai-inbox-card-header p,
.ai-inbox-snippet,
.ai-inbox-empty {
  margin: 0;
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.45;
}

.ai-inbox-subtitle {
  margin-top: 6px;
}

.ai-inbox-header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.ai-inbox-count {
  color: var(--text-blue);
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
}

.ai-inbox-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.ai-inbox-card-header h2 {
  color: var(--text-primary);
}

.ai-inbox-card-header p {
  margin-top: 4px;
}

.ai-inbox-email-list {
  display: flex;
  flex-direction: column;
}

.ai-inbox-email-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 16px 24px;
  border-bottom: 1px solid var(--border-color);
}

.ai-inbox-email-row:last-child {
  border-bottom: 0;
}

.ai-inbox-email-copy {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
}

.ai-inbox-email-copy .unread-dot,
.ai-inbox-summary-icon {
  flex: 0 0 auto;
  margin-top: 6px;
}

.ai-inbox-summary-icon {
  font-size: 18px;
}

.ai-task-icon {
  flex: 0 0 auto;
  margin-top: 4px;
  font-size: 18px;
  color: var(--text-secondary);
}

.ai-task-urgent {
  color: #e5484d;
}

.ai-inbox-sender,
.ai-inbox-subject {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-inbox-sender {
  color: var(--text-secondary);
  font-size: 13px;
}

.ai-inbox-subject {
  margin-top: 2px;
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 600;
}

.ai-inbox-snippet {
  margin-top: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-inbox-open {
  flex: 0 0 auto;
}

.ai-inbox-empty {
  padding: 24px;
}

@media (max-width: 680px) {
  .ai-inbox-header,
  .ai-inbox-card-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .ai-inbox-email-row {
    align-items: flex-start;
    flex-direction: column;
    gap: 12px;
  }
}
</style>
