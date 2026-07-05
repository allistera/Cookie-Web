<script setup>
import { computed } from 'vue'
import { useInboxStore } from '../stores/inbox'

const store = useInboxStore()

const visibleTodos = computed(() => store.visibleTodos)
const hiddenTodosCount = computed(() => store.hiddenTodosCount)
const totalActiveCount = computed(() => store.totalActiveTodosCount)

function triggerAction(todo) {
  if (todo.action === 'open-reply') {
    store.openComposer(todo.id)
  } else if (todo.action === 'open-waiver') {
    store.openTodoModal('waiver', todo.id)
  } else if (todo.action === 'open-sheet') {
    store.openTodoModal('sheets', todo.id)
  } else {
    alert(`Opening ${todo.title} link...`)
    store.completeTodo(todo.id)
  }
}
</script>

<template>
  <div class="view-panel active" id="aiInboxView">
    <div class="ai-header">
      <div class="beta-badge">Beta</div>
      <h1 class="ai-greeting" id="aiGreeting">
        Hi Rose 👋 You have
        <span class="counter-text" id="todoCounter">{{ totalActiveCount }} to-dos</span>
        and
        <span class="counter-text" id="topicCounter">4 topics</span>
        to catch up on.
      </h1>
      <div class="ai-update-status" @click="store.refreshInbox" id="refreshBtn">
        <span class="status-time" id="statusTime">{{ store.statusTime }}</span>
        <span
          class="material-symbols-outlined refresh-icon"
          :class="{ refreshing: store.isRefreshing }"
          id="refreshIcon"
        >
          sync
        </span>
      </div>
    </div>

    <!-- CARDS WRAPPER -->
    <div class="ai-cards-container">
      <!-- SUGGESTED TO-DOS CARD -->
      <section class="ai-card todo-card">
        <div class="card-header">
          <h2>Suggested to-dos</h2>
        </div>

        <!-- TO-DO ROWS CONTAINER WITH SMOOTH TRANSITION -->
        <TransitionGroup name="todo-list" tag="div" class="todo-rows">
          <div v-for="todo in visibleTodos" :key="todo.id" class="todo-row" :id="todo.id">
            <div class="todo-checkbox-container">
              <button
                class="todo-check-btn"
                @click="store.completeTodo(todo.id)"
                title="Mark complete"
              >
                <span class="material-symbols-outlined">circle</span>
              </button>
            </div>

            <div class="todo-text">
              <strong>{{ todo.title }}</strong> – {{ todo.description }}
              <span
                class="from-links-container"
                style="color: var(--text-secondary); margin-left: 4px; font-size: 12px"
              >
                From:
                <template v-for="(f, index) in todo.from" :key="f">
                  <span class="email-link" @click="triggerAction(todo)">{{ f }}</span>
                  <span v-if="index < todo.from.length - 1"> • </span>
                </template>
              </span>
            </div>

            <div class="todo-actions">
              <button class="action-pill-btn" @click="triggerAction(todo)">
                <span class="material-symbols-outlined">{{ todo.btnIcon }}</span>
                <span>{{ todo.btnText }}</span>
              </button>
              <button
                class="todo-check-btn"
                @click="store.completeTodo(todo.id)"
                title="Complete"
                style="margin-left: 8px"
              >
                <span class="material-symbols-outlined">check</span>
              </button>
              <button class="icon-btn" title="More options">
                <span class="material-symbols-outlined">more_vert</span>
              </button>
            </div>
          </div>

          <!-- Empty State -->
          <div
            v-if="visibleTodos.length === 0"
            key="empty-state"
            class="empty-state"
            style="padding: 32px; text-align: center; color: var(--text-secondary)"
          >
            <span
              class="material-symbols-outlined gemini-color"
              style="font-size: 48px; margin-bottom: 12px; display: block"
              >done_all</span
            >
            <h3 style="font-weight: 500; font-size: 16px; color: var(--text-primary)">
              All caught up!
            </h3>
            <p style="font-size: 13px; margin-top: 4px">You have completed all suggested to-dos.</p>
          </div>
        </TransitionGroup>

        <div class="card-footer" v-if="hiddenTodosCount > 0">
          <button class="show-more-btn" @click="store.showAllTodos" id="showMoreTodosBtn">
            <span class="material-symbols-outlined">keyboard_arrow_down</span>
            <span id="showMoreText">Show {{ hiddenTodosCount }} more</span>
          </button>
        </div>
      </section>

      <!-- TOPICS TO CATCH UP ON CARD -->
      <section class="ai-card topics-card">
        <div class="card-header">
          <h2>Topics to catch up on</h2>
        </div>

        <div class="topics-container">
          <!-- Kitchen Renovation Topic -->
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
                  <span
                    class="email-link"
                    @click="store.askGemini('Summarize my kitchen renovation updates.')"
                    >Email</span
                  >
                  <span class="unread-dot"></span>
                </p>
              </div>
              <div class="topic-email-row">
                <p>
                  <strong>Insurance Claim Processed</strong> – Your homeowner's insurance carrier
                  has processed your claim and you should expect to hear back in one week. From:
                  <span
                    class="email-link"
                    @click="store.askGemini('Summarize my kitchen renovation updates.')"
                    >Email</span
                  >
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

          <!-- College Search Topic -->
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
                  <span
                    class="email-link"
                    @click="store.askGemini('Do I have any digital waivers to sign?')"
                    >Email</span
                  >
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

          <!-- Soccer Spring Season Topic -->
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
                  <strong>Practice Location Moved</strong> – The U10 team scrimmage has moved to
                  West Side Park for the rest of the month due to field maintenance. From:
                  <span
                    class="email-link"
                    @click="store.askGemini('What did Coach Mike say about snacks?')"
                    >Email</span
                  >
                  •
                  <span
                    class="email-link"
                    @click="store.askGemini('What did Coach Mike say about snacks?')"
                    >Doc</span
                  >
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

          <!-- More Updates Topic -->
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
                  <strong>Chicago Summer Trip</strong> – Your room at the Palm House was upgraded
                  from Standard to Deluxe. From: <span class="email-link">Email</span>
                  <span class="unread-dot"></span>
                </p>
              </div>
              <div class="topic-email-row">
                <p>
                  <strong>Resale Marketplace Sale</strong> – You sold the baby winter coat bundle
                  for $15. Please contact buyer within 3 days. From:
                  <span class="email-link">Email</span> <span class="unread-dot"></span>
                </p>
              </div>
              <div class="topic-email-row">
                <p>
                  <strong>Resale Marketplace Inquiry</strong> – A buyer asked if the toddler shoe
                  lot is still available. From: <span class="email-link">Email</span>
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
/* List Transitions for Suggested To-Dos */
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
