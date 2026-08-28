<script setup>
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useInboxStore } from './stores/inbox'
import { useDocumentsStore } from './stores/documents'
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
const documentsStore = useDocumentsStore()
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
  if (source.key === 'email') leaveSearchResults()
  router.push(source.to)
}

// Clicking the header logo while already on that app's home route is a
// same-route navigation vue-router won't report as a change, so the
// route.fullPath watcher below never fires — this is the app-agnostic
// equivalent of email's explicit @click="leaveSearchResults" on its Inbox
// link, which documents has no persistent nav-link analogue for.
function onAppLogoClick() {
  if (activeApp.value === 'email') leaveSearchResults()
  else if (activeApp.value === 'documents') leaveDocSearchResults()
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

// Header Search
const searchInputVal = ref('')
const isSearchSuggestionsActive = ref(false)
const AUTO_SEARCH_DELAY_MS = 400
let isNavigatingToSearchResults = false
let autoSearchTimer

function cancelScheduledSearch() {
  window.clearTimeout(autoSearchTimer)
  autoSearchTimer = undefined
}

// The dropdown's single "Search Cookie" item sends the typed text to the
// mailbox Q&A assistant instead of the search index.
function askFromSearch() {
  const query = searchInputVal.value.trim()
  if (!query) return
  cancelScheduledSearch()
  store.cancelPendingSearch()
  isSearchSuggestionsActive.value = false
  store.askAssistant(query)
}

async function runMailboxSearch(query, { semantic = true, force = false } = {}) {
  if (!query || (!force && query === store.activeSearchQuery)) return

  if (route.name !== 'traditional-inbox') {
    isNavigatingToSearchResults = true
    try {
      await router.push('/inbox')
    } finally {
      isNavigatingToSearchResults = false
    }
  }
  // The inbox view starts its initial list request when it mounts. Search
  // afterwards so its list sequence is authoritative and a slower bootstrap
  // response cannot replace the results that were just rendered.
  return store.searchEmails(query, { semantic })
}

// Enter searches immediately; typing searches after a short pause. The
// dropdown's "Search Cookie" item routes the same text to Q&A instead.
function handleSearchEnter() {
  cancelScheduledSearch()
  isSearchSuggestionsActive.value = false
  return runMailboxSearch(searchInputVal.value.trim(), { semantic: true, force: true })
}

function leaveSearchResults() {
  if (!searchInputVal.value && !store.activeSearchQuery) return
  searchInputVal.value = ''
  isSearchSuggestionsActive.value = false
  store.clearSearch()
}

function clearSearch() {
  store.isChatDrawerActive = false
  leaveSearchResults()
}

// Documents search: mirrors the email search block above (same debounce/
// Enter pattern, same CSS classes), but scoped to the Documents app and its
// own store. There is no Q&A-style assistant for documents, so the dropdown's
// single suggestion just triggers the same hybrid search as Enter — a
// discoverability affordance for click vs. Enter, not a second feature.
const docSearchInputVal = ref('')
const isDocSearchSuggestionsActive = ref(false)
let isNavigatingToDocSearchResults = false
let docAutoSearchTimer

function cancelScheduledDocSearch() {
  window.clearTimeout(docAutoSearchTimer)
  docAutoSearchTimer = undefined
}

async function runDocumentSearch(query, { semantic = true, force = false } = {}) {
  if (!query || (!force && query === documentsStore.activeSearchQuery)) return

  // /documents/:id shares the search bar (it's the same activeApp) but
  // results render on the dashboard route, so a search from an open document
  // navigates back to it first.
  if (route.name !== 'documents' || route.params.id) {
    isNavigatingToDocSearchResults = true
    try {
      await router.push('/documents')
    } finally {
      isNavigatingToDocSearchResults = false
    }
  }
  return documentsStore.searchDocuments(query, { semantic })
}

function handleDocSearchEnter() {
  cancelScheduledDocSearch()
  isDocSearchSuggestionsActive.value = false
  return runDocumentSearch(docSearchInputVal.value.trim(), { semantic: true, force: true })
}

function searchDocumentsFromSuggestion() {
  return handleDocSearchEnter()
}

function leaveDocSearchResults() {
  if (!docSearchInputVal.value && !documentsStore.activeSearchQuery) return
  docSearchInputVal.value = ''
  isDocSearchSuggestionsActive.value = false
  documentsStore.clearSearch()
}

function clearDocSearch() {
  leaveDocSearchResults()
}

// Search results share the /inbox (email) or /documents (documents) route
// with the regular list. Any actual route change leaves search mode; the
// Inbox link handles email's same-route case (documents has no equivalent
// persistent "all documents" link — clearing the input or the "x" icon
// covers the same-route case there).
watch(
  () => route.fullPath,
  () => {
    if (!isNavigatingToSearchResults) leaveSearchResults()
    if (!isNavigatingToDocSearchResults) leaveDocSearchResults()
  },
)

watch(searchInputVal, (value) => {
  cancelScheduledSearch()
  const query = value.trim()

  // Do not issue broad one-character searches. Clearing or shortening the
  // value also restores the inbox and invalidates any request still in
  // flight. Only call clearSearch() when a search is actually active: this
  // watcher also fires as a side effect of leaveSearchResults() setting
  // searchInputVal to '', which already called clearSearch() itself — a
  // second, redundant call here would otherwise still bump the store's
  // listSeq and discard that first call's own in-flight inbox reload.
  if (query.length < 2) {
    if (store.activeSearchQuery) store.clearSearch()
    return
  }

  autoSearchTimer = window.setTimeout(() => {
    // Type-ahead stays on the local keyword index. Semantic retrieval adds an
    // embedding round trip and is reserved for an explicit Enter submission.
    runMailboxSearch(query, { semantic: false })
  }, AUTO_SEARCH_DELAY_MS)
})

watch(docSearchInputVal, (value) => {
  cancelScheduledDocSearch()
  const query = value.trim()

  if (query.length < 2) {
    if (documentsStore.activeSearchQuery) documentsStore.clearSearch()
    return
  }

  docAutoSearchTimer = window.setTimeout(() => {
    runDocumentSearch(query, { semantic: false })
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

// Document level click listener to close the search dropdown and profile menu
function onDocumentClick(e) {
  const searchContainer = document.getElementById('searchBarContainer')
  if (searchContainer && !searchContainer.contains(e.target)) {
    isSearchSuggestionsActive.value = false
  }

  const docSearchContainer = document.getElementById('docSearchBarContainer')
  if (docSearchContainer && !docSearchContainer.contains(e.target)) {
    isDocSearchSuggestionsActive.value = false
  }

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
  cancelScheduledDocSearch()
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
              @click="onAppLogoClick"
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
          <div v-if="activeApp === 'email'" class="search-bar-container" id="searchBarContainer">
            <span class="material-symbols-outlined search-icon">search</span>
            <input
              type="text"
              class="search-input"
              placeholder="Search mail — try tag:Personal or in:done"
              aria-label="Search mail. Use tag:Personal, sender:foo@bar.com, or in:done/spam/all to filter."
              v-model="searchInputVal"
              @focus="isSearchSuggestionsActive = true"
              @keydown.enter.prevent="handleSearchEnter"
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
                <span>Search Cookie: “{{ searchInputVal.trim() }}”</span>
              </div>
            </div>
          </div>

          <div
            v-else-if="activeApp === 'documents'"
            class="search-bar-container"
            id="docSearchBarContainer"
          >
            <span class="material-symbols-outlined search-icon">search</span>
            <input
              type="text"
              class="search-input"
              placeholder="Search documents — try tag:Work or is:starred"
              aria-label="Search documents. Use tag:Work or is:starred to filter."
              v-model="docSearchInputVal"
              @focus="isDocSearchSuggestionsActive = true"
              @keydown.enter.prevent="handleDocSearchEnter"
            />
            <span
              class="material-symbols-outlined search-clear-icon"
              v-if="docSearchInputVal.length > 0"
              @click="clearDocSearch"
            >
              close
            </span>

            <!-- Enter and this dropdown both run the same hybrid search; the
               dropdown is a discoverability affordance, not a second action. -->
            <div
              class="search-suggestions"
              :class="{
                active: isDocSearchSuggestionsActive && docSearchInputVal.trim().length > 0,
              }"
            >
              <div class="suggestion-item" @click="searchDocumentsFromSuggestion">
                <span class="material-symbols-outlined text-blue">description</span>
                <span>Search documents: “{{ docSearchInputVal.trim() }}”</span>
              </div>
            </div>
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
              @click="leaveSearchResults"
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
