<script setup>
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useInboxStore } from './stores/inbox'
import { clearCachedMail } from './lib/serviceWorker'
import { loadMaterialSymbols } from './lib/iconFont'
import { scheduleIdleTask } from './lib/scheduleIdleTask'
import LoadingBar from './components/LoadingBar.vue'
import { useAuth } from './composables/useAuth'
import { useRealtimeInbox } from './composables/useRealtimeInbox'
import { useTitleUnreadBadge } from './composables/useTitleUnreadBadge'
import { useAppBadge } from './composables/useAppBadge'
import { getRealtimeClient } from './lib/supabase'

const ChatDrawer = defineAsyncComponent(() => import('./components/ChatDrawer.vue'))
const CommandPalette = defineAsyncComponent(() => import('./components/CommandPalette.vue'))
const ComposerWindow = defineAsyncComponent(() => import('./components/ComposerWindow.vue'))
const DocumentsSidebar = defineAsyncComponent(() => import('./components/DocumentsSidebar.vue'))
const TasksSidebar = defineAsyncComponent(() => import('./components/TasksSidebar.vue'))

const store = useInboxStore()
const route = useRoute()
const router = useRouter()

const { loginWithRedirect, logout, isAuthenticated, user, isLoading } = useAuth()
const showLogoutMenu = ref(false)
const showMoreNav = ref(false)

// Which Cookie app the current route belongs to; drives the header switcher,
// the logo suffix, and which left sidebar (if any) renders.
const APPS = {
  email: { label: 'Email', icon: 'mail', to: '/' },
  calendar: { label: 'Calendar', icon: 'calendar_month', to: '/calendar' },
  documents: { label: 'Documents', icon: 'description', to: '/documents' },
  tasks: { label: 'Tasks', icon: 'task_alt', to: '/tasks' },
}
const activeApp = computed(() => {
  if (route.name === 'calendar') return 'calendar'
  if (route.name === 'documents') return 'documents'
  if (route.name === 'tasks') return 'tasks'
  return 'email'
})
const otherApps = computed(() =>
  Object.entries(APPS)
    .filter(([key]) => key !== activeApp.value)
    .map(([key, app]) => ({ key, ...app })),
)

// Header notifications stay backed by each app's existing unread state. Email
// is the first source today; keeping the destinations together makes the
// button route to the first source without introducing a second state store.
const notificationSources = computed(() => {
  const sources = []
  if (store.unreadInboxCount > 0) {
    sources.push({
      key: 'email',
      count: store.unreadInboxCount,
      to: '/inbox',
      label: `${store.unreadInboxCount} unread email${store.unreadInboxCount === 1 ? '' : 's'}`,
    })
  }
  return sources
})
const notificationCount = computed(() =>
  notificationSources.value.reduce((total, source) => total + source.count, 0),
)
const notificationCountText = computed(() =>
  notificationCount.value > 99 ? '99+' : String(notificationCount.value),
)

function openFirstNotification() {
  const source = notificationSources.value[0]
  if (!source) return
  router.push(source.to)
}

// Undo-send toast: hovering pauses the countdown and reveals the Undo button;
// leaving resumes it. Undo cancels the send and reopens the composer.
const undoSendHover = ref(false)

function onUndoSendEnter() {
  undoSendHover.value = true
  store.pausePendingSend()
}

function onUndoSendLeave() {
  undoSendHover.value = false
  store.resumePendingSend()
}

function undoSend() {
  undoSendHover.value = false
  store.undoPendingSend()
}

function onUndoKeydown(event) {
  const target = event.target instanceof Element ? event.target : null
  const isTyping = target?.closest('input, textarea, select, [contenteditable="true"]')
  const canUndo = store.pendingSend || store.toasts.some((toast) => toast.action)
  if (
    event.key !== 'u' ||
    event.repeat ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    isTyping ||
    store.isCommandPaletteOpen ||
    !canUndo
  ) {
    return
  }

  event.preventDefault()
  if (store.pendingSend) undoSendHover.value = false
  store.undoLatestAction()
}

const chatDrawerLoaded = ref(store.isChatDrawerActive)
const commandPaletteLoaded = ref(store.isCommandPaletteOpen)
const composerLoaded = ref(store.isComposerActive)

watch(
  () => store.isChatDrawerActive,
  (active) => {
    if (active) chatDrawerLoaded.value = true
  },
)
watch(
  () => store.isComposerActive,
  (active) => {
    if (active) composerLoaded.value = true
  },
)

function onCommandPaletteKeydown(event) {
  const target = event.target instanceof HTMLElement ? event.target : null
  const isTyping = target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
  if (
    event.key !== '/' ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    isTyping ||
    target?.isContentEditable ||
    store.isCommandPaletteOpen
  ) {
    return
  }
  event.preventDefault()
  commandPaletteLoaded.value = true
  store.isCommandPaletteOpen = true
}

function openSettings() {
  showLogoutMenu.value = false
  router.push({ name: 'settings', params: { section: 'account' } })
}

function handleLogout() {
  clearCachedMail()
  logout({ logoutParams: { returnTo: window.location.origin } })
}

// Header Search: one combined box (mail + documents) leading to the
// dedicated /search results page, which keeps q/scope/page in the URL so
// results stay shareable and back-button friendly (see
// views/SearchResultsView.vue). Behavior mirrors the two per-app boxes this
// replaces: minimum 2 characters, type-ahead is debounced and stays on the
// keyword index (mode=keyword), Enter searches immediately with the full
// semantic/hybrid index. The old dropdown's "ask the assistant" affordance
// now lives on the results page itself (its "Ask the assistant about" action
// calls store.askAssistant, same as before).
const searchInputVal = ref('')
const AUTO_SEARCH_DELAY_MS = 400
const SEARCH_MIN_CHARS = 2
let autoSearchTimer

function cancelScheduledSearch() {
  window.clearTimeout(autoSearchTimer)
  autoSearchTimer = undefined
}

// Reuses the current /search scope tab (if any) so typing more into an
// already-scoped search doesn't silently reset it back to "All".
function navigateToSearch(q, mode) {
  const query = { q }
  if (mode) query.mode = mode
  if (route.name === 'search' && route.query.scope) query.scope = route.query.scope
  return route.name === 'search'
    ? router.replace({ name: 'search', query })
    : router.push({ name: 'search', query })
}

// Enter searches immediately with the full semantic/hybrid index; typing
// searches after a short pause using the keyword-only index (see the
// debounce watcher below).
function handleSearchEnter() {
  cancelScheduledSearch()
  const q = searchInputVal.value.trim()
  if (q.length < SEARCH_MIN_CHARS) return
  navigateToSearch(q)
}

// Only clears the box itself — there is no per-app search state to tear
// down anymore, and leaving /search already happens through normal
// navigation (handled by the sync watcher below).
function clearSearch() {
  cancelScheduledSearch()
  searchInputVal.value = ''
}

// Keeps the box in sync with the URL: opening a /search link directly, using
// Back/Forward, or navigating away from /search altogether all update the
// box without it triggering a search of its own (the debounce watcher below
// no-ops whenever the value already matches the route).
watch(
  () => [route.name, route.query.q],
  ([name, q]) => {
    if (name !== 'search') {
      searchInputVal.value = ''
      return
    }
    const value = Array.isArray(q) ? q[0] : q
    searchInputVal.value = String(value ?? '')
  },
  { immediate: true },
)

watch(searchInputVal, (value) => {
  cancelScheduledSearch()
  const query = value.trim()
  if (query.length < SEARCH_MIN_CHARS) return
  // Nothing to do if the URL already reflects this exact text — this fires
  // as a side effect of the sync watcher above restoring the box from the
  // route, not from typing.
  if (route.name === 'search' && route.query.q === query) return

  autoSearchTimer = window.setTimeout(() => {
    navigateToSearch(query, 'keyword')
  }, AUTO_SEARCH_DELAY_MS)
})

// Bootstrap the unread badge and Realtime identity after authentication. The
// full mailbox page is deferred until the user enters Inbox.
watch(
  isAuthenticated,
  (authenticated) => {
    if (authenticated) {
      scheduleIdleTask(() => loadMaterialSymbols())
      store.loadInboxState()
      // Load the full label palette so the sidebar lists every defined label,
      // not only ones on loaded emails (and without needing settings opened).
      store.loadLabels()
    }
  },
  { immediate: true },
)

// Live inbox: pings the store to refetch when the backend broadcasts a
// content-free "inbox changed" notification (see notify_inbox_changed()).
const realtimeClient = shallowRef(null)
watch(
  isAuthenticated,
  async (authenticated) => {
    if (!authenticated) {
      realtimeClient.value = null
      return
    }
    const client = await getRealtimeClient()
    if (isAuthenticated.value) realtimeClient.value = client
  },
  { immediate: true },
)
useRealtimeInbox(store, realtimeClient, isAuthenticated)

// "(2) Cookie AI Inbox …" tab-title badge for emails that arrive while the
// tab is in the background.
useTitleUnreadBadge(store)

// Dock/taskbar icon badge with the unread inbox count, once installed as a PWA.
useAppBadge(store)

// Document level click listener to close the profile menu
function onDocumentClick(e) {
  // Close profile dropdown when clicking outside
  const profileContainer = document.querySelector('.profile-container')
  if (profileContainer && !profileContainer.contains(e.target)) {
    showLogoutMenu.value = false
  }
}

onMounted(() => {
  document.addEventListener('keydown', onUndoKeydown)
  document.addEventListener('keydown', onCommandPaletteKeydown)
  document.addEventListener('click', onDocumentClick)
})

onUnmounted(() => {
  cancelScheduledSearch()
  document.removeEventListener('keydown', onUndoKeydown)
  document.removeEventListener('keydown', onCommandPaletteKeydown)
  document.removeEventListener('click', onDocumentClick)
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
    <router-view v-if="route.meta.layout === 'settings'" />
    <div v-else class="app-container">
      <!-- TOP HEADER -->
      <header class="app-header">
        <div class="header-left">
          <div class="app-switcher">
            <router-link
              :to="APPS[activeApp].to"
              class="logo-container"
              :aria-label="`Cookie ${APPS[activeApp].label} home`"
            >
              <img class="app-logo" src="/icons/cookie-mark.svg" alt="" />
              <span class="logo-text">Cookie</span>
              <span class="logo-suffix">{{ APPS[activeApp].label }}</span>
            </router-link>
            <button
              class="app-switcher-trigger"
              type="button"
              aria-label="Switch Cookie app"
              aria-haspopup="menu"
            >
              <span class="material-symbols-outlined" aria-hidden="true">keyboard_arrow_down</span>
            </button>
            <!-- Outer div is the hover-bridge positioner; the card inside is the
               single visual surface all app links share. -->
            <div class="app-switcher-menu">
              <div class="app-switcher-menu-card" role="menu">
                <router-link
                  v-for="app in otherApps"
                  :key="app.key"
                  :to="app.to"
                  class="app-switcher-menu-item"
                  role="menuitem"
                >
                  <span class="material-symbols-outlined" aria-hidden="true">{{ app.icon }}</span>
                  <span>{{ app.label }}</span>
                </router-link>
              </div>
            </div>
          </div>
          <button
            v-if="notificationCount"
            class="header-notification-btn"
            type="button"
            :aria-label="`Open ${notificationCount} notification${notificationCount === 1 ? '' : 's'}: ${notificationSources[0].label}`"
            @click="openFirstNotification"
          >
            <span class="material-symbols-outlined" aria-hidden="true">notifications</span>
            <span class="header-notification-count" aria-hidden="true">{{
              notificationCountText
            }}</span>
          </button>
        </div>

        <div class="header-center">
          <div class="search-bar-container">
            <span class="material-symbols-outlined search-icon">search</span>
            <input
              type="text"
              class="search-input"
              placeholder="Search..."
              aria-label="Search"
              v-model="searchInputVal"
              @keydown.enter.prevent="handleSearchEnter"
            />
            <span
              class="material-symbols-outlined search-clear-icon"
              v-if="searchInputVal.length > 0"
              @click="clearSearch"
            >
              close
            </span>
          </div>
        </div>

        <div class="header-right">
          <div
            class="profile-container"
            :title="user?.name || 'Account'"
            @click="showLogoutMenu = !showLogoutMenu"
          >
            <img
              :src="user?.picture || '/rose_avatar.webp'"
              :alt="user?.name || 'Account'"
              class="profile-img"
            />

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
        <aside v-if="activeApp === 'email'" class="left-sidebar">
          <button class="compose-btn" @click="store.openComposer()">
            <span class="material-symbols-outlined">edit_square</span>
            <span>Compose</span>
          </button>

          <div class="sb-section-label">Views</div>

          <nav class="sidebar-nav">
            <router-link to="/" class="nav-item" :class="{ active: route.name === 'ai-inbox' }">
              <span class="material-symbols-outlined fill-icon gemini-color">auto_awesome</span>
              <span class="nav-text">AI Today</span>
            </router-link>
            <router-link
              to="/inbox"
              class="nav-item"
              :class="{ active: route.name === 'traditional-inbox' && !route.query.filter }"
            >
              <span class="material-symbols-outlined nav-icon-red">inbox</span>
              <span class="nav-text">Inbox</span>
              <span class="nav-badge" v-if="store.unreadInboxCount">{{
                store.unreadInboxCount
              }}</span>
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
                :to="{ path: '/scheduled' }"
                class="nav-item"
                :class="{ active: route.name === 'scheduled-sends' }"
              >
                <span class="material-symbols-outlined">upcoming</span>
                <span class="nav-text">Scheduled</span>
              </router-link>
              <router-link
                :to="{ path: '/inbox', query: { filter: 'done' } }"
                class="nav-item"
                :class="{ active: route.query.filter === 'done' }"
              >
                <span class="material-symbols-outlined">task_alt</span>
                <span class="nav-text">Done</span>
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

        <!-- Documents: the file tree replaces the mail sidebar -->
        <DocumentsSidebar v-else-if="activeApp === 'documents'" />

        <!-- Tasks: its own sidebar replaces the mail one -->
        <TasksSidebar v-else-if="activeApp === 'tasks'" />

        <!-- MAIN CONTENT PANEL -->
        <main class="main-content">
          <router-view />
        </main>

        <!-- Assistant chat drawer -->
        <ChatDrawer v-if="chatDrawerLoaded" />
      </div>

      <!-- Command palette (Cmd+K) -->
      <CommandPalette v-if="commandPaletteLoaded" />
    </div>

    <!-- Toast notifications -->
    <div class="toast-container">
      <Transition name="toast">
        <div
          v-if="store.pendingSend"
          class="toast undo-send-toast"
          :class="{ expanded: undoSendHover }"
          @mouseenter="onUndoSendEnter"
          @mouseleave="onUndoSendLeave"
        >
          <span class="toast-message">Sending in {{ store.pendingSend.secondsLeft }}</span>
          <button v-if="undoSendHover" class="undo-send-btn" @click="undoSend">Undo</button>
        </div>
      </Transition>
      <TransitionGroup name="toast">
        <div
          v-for="toast in store.toasts"
          :key="toast.id"
          class="toast"
          :class="`toast-${toast.kind}`"
        >
          <span class="toast-message">{{ toast.message }}</span>
          <button v-if="toast.action" class="toast-action" @click="store.runToastAction(toast.id)">
            {{ toast.action.label }}
          </button>
          <button class="toast-close" title="Dismiss" @click="store.dismissToast(toast.id)">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
      </TransitionGroup>
    </div>

    <ComposerWindow v-if="composerLoaded" />
  </template>
</template>
