<script setup>
import { ref, watch, nextTick, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useInboxStore } from './stores/inbox'
import ChatDrawer from './components/ChatDrawer.vue'
import LoadingBar from './components/LoadingBar.vue'
import SettingsModal from './components/SettingsModal.vue'
import CommandPalette from './components/CommandPalette.vue'
import { useAuth } from './composables/useAuth'
import { useRealtimeInbox } from './composables/useRealtimeInbox'
import { useTitleUnreadBadge } from './composables/useTitleUnreadBadge'
import { supabase } from './lib/supabase'

const store = useInboxStore()
const route = useRoute()
const router = useRouter()

const { loginWithRedirect, logout, isAuthenticated, user, isLoading } = useAuth()
const showLogoutMenu = ref(false)
const showMoreNav = ref(false)

// Compose window: the inline subject in the title row gets focus first.
const composerToRef = ref(null)
const composerSubjectRef = ref(null)
const composerBodyRef = ref(null)
watch(
  () => store.isComposerActive,
  (active) => {
    if (active) {
      nextTick(() => composerSubjectRef.value?.focus())
    }
  },
)

function openSettings() {
  showLogoutMenu.value = false
  store.activeModal = 'settings'
}

function handleLogout() {
  logout({ logoutParams: { returnTo: window.location.origin } })
}

// Header Search
const searchInputVal = ref('')
const isSearchSuggestionsActive = ref(false)

// The dropdown's single "Ask Cookie" item sends the typed text to the
// mailbox Q&A assistant instead of the search index.
function askFromSearch() {
  const query = searchInputVal.value.trim()
  if (!query) return
  isSearchSuggestionsActive.value = false
  store.askGemini(query)
}

// Enter searches the mailbox (hybrid keyword + semantic); the dropdown's
// "Ask Cookie" item routes the same text to the Q&A assistant instead.
function handleSearchEnter() {
  const query = searchInputVal.value.trim()
  if (query) {
    isSearchSuggestionsActive.value = false
    store.searchEmails(query)
    if (route.name !== 'traditional-inbox') {
      router.push('/inbox')
    }
  }
}

function clearSearch() {
  searchInputVal.value = ''
  store.isChatDrawerActive = false
  store.clearSearch()
}

// Load the inbox once the user is authenticated (immediately in E2E mode,
// after the Auth0 redirect completes otherwise).
watch(
  isAuthenticated,
  (authenticated) => {
    if (authenticated) {
      store.loadEmails()
    }
  },
  { immediate: true },
)

// Live inbox: pings the store to refetch when the backend broadcasts a
// content-free "inbox changed" notification (see notify_inbox_changed()).
useRealtimeInbox(store, supabase, isAuthenticated)

// "(2) Cookie AI Inbox …" tab-title badge for emails that arrive while the
// tab is in the background.
useTitleUnreadBadge(store)

// Document level click listener to close search dropdown
onMounted(() => {
  document.addEventListener('click', (e) => {
    const searchContainer = document.getElementById('searchBarContainer')
    if (searchContainer && !searchContainer.contains(e.target)) {
      isSearchSuggestionsActive.value = false
    }

    // Close profile dropdown when clicking outside
    const profileContainer = document.querySelector('.profile-container')
    if (profileContainer && !profileContainer.contains(e.target)) {
      showLogoutMenu.value = false
    }
  })
})
</script>

<template>
  <!-- Data-sync feedback: thin indeterminate bar across the very top while
       any email list fetch is in flight -->
  <LoadingBar />

  <!-- Loading State -->
  <div v-if="isLoading" class="auth-loading-container">
    <div class="spinner"></div>
    <p>Loading Cookie...</p>
  </div>

  <!-- Login/Landing State -->
  <div v-else-if="!isAuthenticated" class="auth-login-container">
    <div class="login-card">
      <div class="login-logo">
        <img class="login-logo-icon" src="/icons/cookie-mark.svg" alt="" />
      </div>
      <h1 class="login-title">Cookie</h1>
      <p class="login-subtitle">Workspace Intelligence & Automation</p>
      <button @click="loginWithRedirect" class="login-btn">Log In with Auth0</button>
    </div>
  </div>

  <!-- Authenticated App -->
  <template v-else>
    <div class="app-container">
    <!-- TOP HEADER -->
    <header class="app-header">
      <div class="header-left">
        <div class="logo-container" @click="$router.push('/')">
          <img class="app-logo" src="/icons/cookie-mark.svg" alt="" />
          <span class="logo-text">Cookie</span>
        </div>
      </div>

      <div class="header-center">
        <div class="search-bar-container" id="searchBarContainer">
          <span class="material-symbols-outlined search-icon glow-ai">auto_awesome</span>
          <input
            type="text"
            class="search-input"
            placeholder="Ask Cookie..."
            v-model="searchInputVal"
            @focus="isSearchSuggestionsActive = true"
            @keypress.enter="handleSearchEnter"
          />
          <span
            class="material-symbols-outlined search-clear-icon"
            v-if="searchInputVal.length > 0"
            @click="clearSearch"
          >
            close
          </span>

          <!-- Enter searches the mailbox; this dropdown routes the same text
               to the Q&A assistant instead. -->
          <div
            class="search-suggestions"
            :class="{ active: isSearchSuggestionsActive && searchInputVal.trim().length > 0 }"
          >
            <div class="suggestion-item" @click="askFromSearch">
              <span class="material-symbols-outlined text-purple">chat_bubble</span>
              <span>Ask Cookie: “{{ searchInputVal.trim() }}”</span>
            </div>
          </div>
        </div>
      </div>

      <div class="header-right">
        <div class="profile-container" :title="user?.name || 'Account'" @click="showLogoutMenu = !showLogoutMenu">
          <img :src="user?.picture || '/rose_avatar.jpg'" :alt="user?.name || 'Account'" class="profile-img" />

          <!-- Dropdown/Logout menu -->
          <div class="profile-dropdown" v-if="showLogoutMenu" @click.stop>
            <div class="dropdown-user-info">
              <span class="user-name">{{ user?.name }}</span>
              <span class="user-email">{{ user?.email }}</span>
            </div>
            <div class="dropdown-divider"></div>
            <button class="dropdown-menu-btn" @click="openSettings">
              <span class="material-symbols-outlined">settings</span>
              <span>Settings</span>
            </button>
            <button class="logout-btn" @click="handleLogout">
              <span class="material-symbols-outlined">logout</span>
              <span>Log out</span>
            </button>
          </div>
        </div>
      </div>
    </header>

    <div class="app-body">
      <!-- LEFT SIDEBAR -->
      <aside class="left-sidebar">
        <button class="compose-btn" @click="store.openComposer()">
          <span class="material-symbols-outlined">edit_square</span>
          <span>Compose</span>
        </button>

        <div class="sb-section-label">Views</div>

        <nav class="sidebar-nav">
          <router-link
            to="/inbox"
            class="nav-item"
            :class="{ active: route.name === 'traditional-inbox' && !route.query.filter }"
          >
            <span class="material-symbols-outlined nav-icon-red">inbox</span>
            <span class="nav-text">Inbox</span>
            <span class="nav-badge" v-if="store.unreadInboxCount">{{ store.unreadInboxCount }}</span>
          </router-link>
          <router-link
            :to="{ path: '/inbox', query: { filter: 'starred' } }"
            class="nav-item"
            :class="{ active: route.query.filter === 'starred' }"
          >
            <span class="material-symbols-outlined">star</span>
            <span class="nav-text">Starred</span>
          </router-link>
          <a href="#" class="nav-item" @click.prevent="showMoreNav = !showMoreNav">
            <span class="material-symbols-outlined">{{
              showMoreNav ? 'keyboard_arrow_up' : 'keyboard_arrow_down'
            }}</span>
            <span class="nav-text">{{ showMoreNav ? 'Less' : 'More' }}</span>
          </a>
          <template v-if="showMoreNav">
            <router-link
              :to="{ path: '/inbox', query: { filter: 'snoozed' } }"
              class="nav-item"
              :class="{ active: route.query.filter === 'snoozed' }"
            >
              <span class="material-symbols-outlined">schedule</span>
              <span class="nav-text">Snoozed</span>
            </router-link>
            <router-link
              :to="{ path: '/inbox', query: { filter: 'sent' } }"
              class="nav-item"
              :class="{ active: route.query.filter === 'sent' }"
            >
              <span class="material-symbols-outlined">send</span>
              <span class="nav-text">Sent</span>
            </router-link>
            <router-link
              :to="{ path: '/inbox', query: { filter: 'spam' } }"
              class="nav-item"
              :class="{ active: route.query.filter === 'spam' }"
            >
              <span class="material-symbols-outlined">report</span>
              <span class="nav-text">Spam</span>
            </router-link>
          </template>
        </nav>

        <template v-if="store.allLabels.length">
          <div class="sb-section-label">Labels</div>
          <nav class="sidebar-nav">
            <router-link
              v-for="label in store.allLabels"
              :key="label.name"
              :to="{ path: '/inbox', query: { filter: 'label', label: label.name } }"
              class="nav-item"
              :class="{
                active: route.query.filter === 'label' && route.query.label === label.name,
              }"
            >
              <span class="material-symbols-outlined" :style="{ color: label.color }">sell</span>
              <span class="nav-text">{{ label.name }}</span>
            </router-link>
          </nav>
        </template>
      </aside>

      <!-- MAIN CONTENT PANEL -->
      <main class="main-content">
        <router-view />
      </main>

      <!-- Assistant chat drawer -->
      <ChatDrawer />
    </div>

    <!-- MODAL OVERLAYS -->
    <!-- Settings Modal -->
    <SettingsModal />

    <!-- Command palette (Cmd+K) -->
    <CommandPalette />
  </div>

  <!-- Toast notifications -->
  <div class="toast-container">
    <TransitionGroup name="toast">
      <div v-for="toast in store.toasts" :key="toast.id" class="toast" :class="`toast-${toast.kind}`">
        <span class="toast-message">{{ toast.message }}</span>
        <button class="toast-close" title="Dismiss" @click="store.dismissToast(toast.id)">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
    </TransitionGroup>
  </div>

  <!-- Inline Composer Toast -->
  <div class="composer-toast" :class="{ active: store.isComposerActive }" id="composerToast">
    <div class="composer-draft-row">
      <div class="composer-draft-title">
        <input
          ref="composerSubjectRef"
          v-model="store.composerSubject"
          class="composer-subject-inline"
          placeholder="Hello"
          @keydown.tab.exact.prevent="composerToRef?.focus()"
        />
        <span class="composer-draft-to">to</span>
        <input
          ref="composerToRef"
          v-model="store.composerTo"
          class="composer-to-inline"
          type="email"
          @keydown.tab.exact.prevent="composerBodyRef?.focus()"
          @keydown.shift.tab.prevent="composerSubjectRef?.focus()"
        />
      </div>
      <div class="composer-window-actions">
        <button class="composer-icon-btn" title="Close" tabindex="-1" @click="store.closeComposer">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
    </div>
    <div class="composer-body">
      <textarea
        ref="composerBodyRef"
        v-model="store.composerTextArea"
        placeholder="..."
        @keydown.shift.tab.prevent="composerToRef?.focus()"
      ></textarea>

      <!-- Reviewable AI drafting box; generation never sends mail. -->
      <div class="composer-gemini-box" :class="{ active: store.isAiDraftActive }">
        <div class="gemini-draft-header">
          <div class="gemini-badge">
            <span class="material-symbols-outlined gemini-color font-sm">auto_awesome</span>
            <span>Cookie AI Compose</span>
          </div>
          <div class="gemini-draft-actions">
            <button class="btn btn-text-sm" :disabled="store.isAiDraftLoading" @click="store.requestAiDraft">
              {{ store.aiDraftPreview ? 'Refine' : 'Generate' }}
            </button>
            <button class="btn btn-text-sm" :disabled="!store.aiDraftPreview" @click="store.insertAiDraft">Insert</button>
          </div>
        </div>
        <input
          v-model="store.composerAiInstruction"
          class="composer-ai-instruction"
          maxlength="1000"
          placeholder="Describe what you want to say…"
          @keydown.enter.prevent="store.requestAiDraft"
        />
        <div
          class="gemini-draft-preview"
          :class="{
            'typing-cursor': store.isAiDraftLoading,
          }"
        >
          {{ store.isAiDraftLoading ? 'Drafting…' : store.aiDraftPreview || 'Your generated draft will appear here for review.' }}
        </div>
      </div>
    </div>
    <div class="composer-footer">
      <div class="composer-send-actions">
        <button
          class="composer-text-btn composer-text-btn-primary"
          :disabled="store.isSendingEmail || !store.composerTo.includes('@') || !store.composerTextArea.trim()"
          :aria-busy="store.isSendingEmail"
          @click="store.sendEmail"
        >
          {{ store.isSendingEmail ? 'Sending…' : 'Send' }}
        </button>
      </div>
      <div class="composer-tools">
        <button
          class="composer-icon-btn composer-ai-btn"
          title="Help me write"
          @click="store.openAiDraft"
        >
          ai
        </button>
        <button class="composer-icon-btn" title="Discard" @click="store.closeComposer">
          <span class="material-symbols-outlined">delete</span>
        </button>
      </div>
    </div>
  </div>
  </template>
</template>
