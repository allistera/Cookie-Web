<script setup>
import { computed, ref } from 'vue'

// "AI Today" is a static design mock of the daily digest: a set of suggested
// to-dos and topics to catch up on. The data below is fixed mock content, not
// wired to the live inbox store.
const todos = ref([
  {
    id: 'todo-kitchen',
    title: 'Kitchen Renovation',
    description:
      "A reply to the tile vendor is due, confirming selection so they can order in time to have it installed by the contractor's timeline.",
    from: ['Email'],
    btnText: 'Reply',
    btnIcon: 'edit',
    visible: true,
    completed: false,
  },
  {
    id: 'todo-waiver',
    title: 'RSVP for College Tour',
    description:
      'The University of State sent a confirmation for the June 12th tour. You need to sign the digital waiver for your daughter.',
    from: ['Email'],
    btnText: 'View',
    btnIcon: 'mail',
    visible: true,
    completed: false,
  },
  {
    id: 'todo-soccer',
    title: 'Bring snack to soccer practice',
    description:
      "Coach Mike reminded you it's your turn to bring snacks for 20 people tomorrow and to log what you're bringing; one child has a peanut allergy.",
    from: ['Email', 'Sheet'],
    btnText: 'Open',
    btnIcon: 'table_chart',
    visible: true,
    completed: false,
  },
  {
    id: 'todo-marketplace',
    title: 'Resale Marketplace Sale',
    description:
      'Resale Marketplace has notified you that the baby winter coat bundle is now marked as sold for $15. You need to contact buyer within 3 days.',
    from: ['Email'],
    btnText: 'Open',
    btnIcon: 'link',
    visible: false,
    completed: false,
  },
  {
    id: 'todo-chicago',
    title: 'Chicago Summer Trip',
    description:
      'Confirm your upgrade to the Deluxe room at the Palm House by Tuesday. The hotel has updated your reservation details.',
    from: ['Email'],
    btnText: 'View',
    btnIcon: 'mail',
    visible: false,
    completed: false,
  },
])

const showAll = ref(false)
const topicCount = 4

const visibleTodos = computed(() =>
  todos.value.filter((t) => !t.completed && (showAll.value || t.visible)),
)
const activeCount = computed(() => todos.value.filter((t) => !t.completed).length)
const hiddenCount = computed(() => todos.value.filter((t) => !t.completed && !t.visible).length)
const showFooter = computed(() => !showAll.value && hiddenCount.value > 0)

const statusTime = ref('Updated just now')
const isRefreshing = ref(false)

function completeTodo(id) {
  const todo = todos.value.find((t) => t.id === id)
  if (todo) todo.completed = true
}

function showAllTodos() {
  showAll.value = true
}

function refresh() {
  if (isRefreshing.value) return
  isRefreshing.value = true
  statusTime.value = 'Updated just now'
  setTimeout(() => {
    isRefreshing.value = false
  }, 600)
}
</script>

<template>
  <div class="view-panel active ai-today-view" aria-labelledby="ai-today-title">
    <div class="ai-header">
      <div class="beta-badge">Beta</div>
      <h1 id="ai-today-title" class="ai-greeting">
        Hi Allister 👋 You have
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

        <TransitionGroup name="todo-list" tag="div" class="todo-rows" data-testid="todo-rows">
          <div v-for="todo in visibleTodos" :key="todo.id" class="todo-row">
            <div class="todo-checkbox-container">
              <button class="todo-check-btn" title="Mark complete" @click="completeTodo(todo.id)">
                <span class="material-symbols-outlined">circle</span>
              </button>
            </div>

            <div class="todo-text">
              <strong>{{ todo.title }}</strong> – {{ todo.description }}
              <span class="from-links-container">
                From:
                <template v-for="(f, index) in todo.from" :key="f">
                  <span class="email-link">{{ f }}</span>
                  <span v-if="index < todo.from.length - 1"> • </span>
                </template>
              </span>
            </div>

            <div class="todo-actions">
              <button class="action-pill-btn">
                <span class="material-symbols-outlined">{{ todo.btnIcon }}</span>
                <span>{{ todo.btnText }}</span>
              </button>
              <button
                class="todo-check-btn"
                title="Complete"
                style="margin-left: 8px"
                @click="completeTodo(todo.id)"
              >
                <span class="material-symbols-outlined">check</span>
              </button>
              <button class="icon-btn" title="More options">
                <span class="material-symbols-outlined">more_vert</span>
              </button>
            </div>
          </div>
        </TransitionGroup>

        <div v-if="showFooter" class="card-footer">
          <button class="show-more-btn" @click="showAllTodos">
            <span class="material-symbols-outlined">keyboard_arrow_down</span>
            <span>Show {{ hiddenCount }} more</span>
          </button>
        </div>
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
  transition: transform 0.6s ease;
}

.refreshing {
  transform: rotate(360deg);
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
