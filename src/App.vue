<script setup>
import { ref, watch, nextTick, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useInboxStore } from './stores/inbox'
import GeminiChatDrawer from './components/GeminiChatDrawer.jsx'
import SettingsModal from './components/SettingsModal.vue'
import CommandPalette from './components/CommandPalette.vue'
import { useAuth } from './composables/useAuth'
import { useRealtimeInbox } from './composables/useRealtimeInbox'
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

function selectSuggestion(query) {
  searchInputVal.value = query
  isSearchSuggestionsActive.value = false
  store.askGemini(query)
}

// Enter searches the mailbox (hybrid keyword + semantic); the suggestion
// items below keep their Gemini Q&A behavior via selectSuggestion.
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

// Canvas waiver signature variables
const signatureCanvasRef = ref(null)
let canvasCtx = null
let isDrawing = false
let canvasListenersAdded = false

function setupSignatureCanvas() {
  const canvas = signatureCanvasRef.value
  if (!canvas) return

  canvasCtx = canvas.getContext('2d')
  canvasCtx.strokeStyle =
    document.documentElement.getAttribute('data-theme') === 'dark' ? '#7fcfff' : '#0b57d0'
  canvasCtx.lineWidth = 3
  canvasCtx.lineCap = 'round'

  canvasCtx.clearRect(0, 0, canvas.width, canvas.height)

  if (!canvasListenersAdded) {
    canvas.addEventListener('mousedown', startDrawing)
    canvas.addEventListener('mousemove', draw)
    canvas.addEventListener('mouseup', stopDrawing)
    canvas.addEventListener('mouseout', stopDrawing)
    canvasListenersAdded = true
  }
}

function startDrawing(e) {
  isDrawing = true
  canvasCtx.beginPath()
  const rect = signatureCanvasRef.value.getBoundingClientRect()
  canvasCtx.moveTo(e.clientX - rect.left, e.clientY - rect.top)
}

function draw(e) {
  if (!isDrawing) return
  const rect = signatureCanvasRef.value.getBoundingClientRect()
  canvasCtx.lineTo(e.clientX - rect.left, e.clientY - rect.top)
  canvasCtx.stroke()
}

function stopDrawing() {
  isDrawing = false
}

function clearSignature() {
  if (canvasCtx && signatureCanvasRef.value) {
    canvasCtx.clearRect(0, 0, signatureCanvasRef.value.width, signatureCanvasRef.value.height)
  }
}

// Watch active modal to initialize signature pad
watch(
  () => store.activeModal,
  (modalName) => {
    if (modalName === 'waiver') {
      nextTick(() => {
        setupSignatureCanvas()
      })
    }
  },
)

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
  <!-- Loading State -->
  <div v-if="isLoading" class="auth-loading-container">
    <div class="spinner"></div>
    <p>Loading Cookie...</p>
  </div>

  <!-- Login/Landing State -->
  <div v-else-if="!isAuthenticated" class="auth-login-container">
    <div class="login-card">
      <div class="login-logo">
        <span class="material-symbols-outlined login-logo-icon">cookie</span>
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
        <button class="menu-btn" title="Main menu">
          <span class="material-symbols-outlined">menu</span>
        </button>
        <div class="logo-container" @click="$router.push('/')">
          <svg class="gmail-logo" viewBox="0 0 24 24" width="24" height="24">
            <path
              d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2z"
              fill="#F44336"
            />
            <path
              d="M22 6v12c0 1.1-.9 2-2 2h-2V8l-6 4-6-4v12H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2h16c1.1 0 2-.9 2 2z"
              fill="#FFFFFF"
              opacity="0.2"
            />
            <path
              d="M2 6l10 7 10-7v12c0 1.1-.9 2-2 2h-3V8.5L12 12 7 8.5V20H4c-1.1 0-2-.9-2-2V6z"
              fill="#B0BEC5"
            />
            <path d="M22 6l-10 7L2 6" fill="#CFD8DC" />
            <path d="M2 6v1.5l10 6.5 10-6.5V6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2z" fill="#F44336" />
          </svg>
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

          <!-- Dropdown suggestions -->
          <div class="search-suggestions" :class="{ active: isSearchSuggestionsActive }">
            <div class="suggestion-header">Suggested Questions</div>
            <div
              class="suggestion-item"
              @click="selectSuggestion('What did Coach Mike say about snacks?')"
            >
              <span class="material-symbols-outlined text-purple">chat_bubble</span>
              <span>What did Coach Mike say about snacks?</span>
            </div>
            <div
              class="suggestion-item"
              @click="selectSuggestion('Do I have any digital waivers to sign?')"
            >
              <span class="material-symbols-outlined text-purple">draw</span>
              <span>Do I have any digital waivers to sign?</span>
            </div>
            <div
              class="suggestion-item"
              @click="selectSuggestion('Summarize my kitchen renovation updates.')"
            >
              <span class="material-symbols-outlined text-purple">summarize</span>
              <span>Summarize my kitchen renovation updates.</span>
            </div>
          </div>
        </div>
      </div>

      <div class="header-right">
        <button class="icon-btn gemini-badge-btn" title="Gemini Status">
          <span class="material-symbols-outlined gemini-color">auto_awesome</span>
        </button>
        <div class="profile-container" :title="`Google Account: ${user?.name || 'Allister'}`" @click="showLogoutMenu = !showLogoutMenu">
          <img :src="user?.picture || '/rose_avatar.jpg'" :alt="user?.name || 'Allister'" class="profile-img" />
          
          <!-- Dropdown/Logout menu -->
          <div class="profile-dropdown" v-if="showLogoutMenu" @click.stop>
            <div class="dropdown-user-info">
              <span class="user-name">{{ user?.name || 'Allister' }}</span>
              <span class="user-email">{{ user?.email || 'allistera@gmail.com' }}</span>
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
        <button class="compose-btn" @click="store.openComposer(null)">
          <span class="material-symbols-outlined">edit_square</span>
          <span>Compose</span>
        </button>

        <div class="sb-section-label">Views</div>

        <nav class="sidebar-nav">
          <router-link to="/" class="nav-item" :class="{ active: route.name === 'ai-inbox' }">
            <span class="material-symbols-outlined fill-icon gemini-color">auto_awesome</span>
            <span class="nav-text">AI Inbox</span>
          </router-link>
          <router-link
            to="/inbox"
            class="nav-item"
            :class="{ active: route.name === 'traditional-inbox' && !route.query.filter }"
          >
            <span class="material-symbols-outlined nav-icon-red">inbox</span>
            <span class="nav-text">Inbox</span>
            <span class="nav-badge">{{ store.unreadInboxCount }}</span>
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
              :to="{ path: '/inbox', query: { filter: 'drafts' } }"
              class="nav-item"
              :class="{ active: route.query.filter === 'drafts' }"
            >
              <span class="material-symbols-outlined">description</span>
              <span class="nav-text">Drafts</span>
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

      <!-- Gemini JSX Chat Drawer -->
      <GeminiChatDrawer />
    </div>

    <!-- MODAL OVERLAYS -->
    <!-- 0. Settings Modal -->
    <SettingsModal />

    <!-- Command palette (Cmd+K) -->
    <CommandPalette />

    <!-- 1. Google Sheets Modal -->
    <div class="modal-overlay" :class="{ active: store.activeModal === 'sheets' }">
      <div class="modal-container sheets-modal-container">
        <div class="modal-header sheets-header">
          <div class="modal-title">
            <span class="material-symbols-outlined text-green">table_chart</span>
            <span>Soccer Snacks Signup - 2026 Season</span>
          </div>
          <button class="close-modal-btn" @click="store.closeTodoModal">&times;</button>
        </div>
        <div class="modal-body sheets-body">
          <table class="google-sheet-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Opponent</th>
                <th>Snack Provider</th>
                <th>Snack Details</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>June 6 (Tomorrow)</td>
                <td>Green Eagles</td>
                <td class="cell-highlight">Allister (You)</td>
                <td>
                  <input type="text" v-model="store.sheetSnackText" class="sheet-inline-input" />
                </td>
                <td><span class="status-badge status-pending">Pending confirmation</span></td>
              </tr>
              <tr>
                <td>June 13</td>
                <td>Blue Sharks</td>
                <td>David Lee</td>
                <td>Orange slices & pretzels</td>
                <td><span class="status-badge status-confirmed">Confirmed</span></td>
              </tr>
              <tr>
                <td>June 20</td>
                <td>Red Dragons</td>
                <td>Sarah Miller</td>
                <td>Granola bars & apples</td>
                <td><span class="status-badge status-confirmed">Confirmed</span></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" @click="store.closeTodoModal">Cancel</button>
          <button class="btn btn-success" @click="store.saveSoccerSheet">
            Save & Sync to Cookie
          </button>
        </div>
      </div>
    </div>

    <!-- 2. Waiver Signature Modal -->
    <div class="modal-overlay" :class="{ active: store.activeModal === 'waiver' }">
      <div class="modal-container waiver-modal-container">
        <div class="modal-header waiver-header">
          <div class="modal-title">
            <span class="material-symbols-outlined text-blue">verified</span>
            <span>Digital Liability Waiver - State Univ College Tour</span>
          </div>
          <button class="close-modal-btn" @click="store.closeTodoModal">&times;</button>
        </div>
        <div class="modal-body waiver-body">
          <div class="waiver-text-box">
            <p><strong>Visitor Liability Release Form & Waiver</strong></p>
            <p>
              I hereby grant permission for my daughter to participate in the University of State
              Campus Guided Tour scheduled on June 12th, 2026. I agree to indemnify and hold
              harmless the University of State, its officers, agents, and employees against any and
              all claims, demands, damages, or liability arising out of or in connection with this
              campus visit.
            </p>
            <p>
              By signing below, I certify that I am the legal parent/guardian of the minor and agree
              to these terms.
            </p>
          </div>
          <div class="signature-canvas-container">
            <label>Draw signature below with your mouse/finger:</label>
            <canvas ref="signatureCanvasRef" width="450" height="150" id="signatureCanvas"></canvas>
            <button class="btn btn-text" @click="clearSignature" id="clearCanvasBtn">
              Clear signature
            </button>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" @click="store.closeTodoModal">Cancel</button>
          <button class="btn btn-primary" @click="store.submitWaiver">Sign & Submit Waiver</button>
        </div>
      </div>
    </div>
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
        <button class="composer-icon-btn" title="Pop out" tabindex="-1">
          <span class="material-symbols-outlined">filter_none</span>
        </button>
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

      <!-- Inline Gemini drafting box -->
      <div class="composer-gemini-box" :class="{ active: store.isGeminiDraftActive }">
        <div class="gemini-draft-header">
          <div class="gemini-badge">
            <span class="material-symbols-outlined gemini-color font-sm">auto_awesome</span>
            <span>Gemini Drafted</span>
          </div>
          <div class="gemini-draft-actions">
            <button class="btn btn-text-sm" @click="store.triggerGeminiDraft">Refine</button>
            <button class="btn btn-text-sm" @click="store.insertGeminiDraft">Insert</button>
          </div>
        </div>
        <div
          class="gemini-draft-preview"
          :class="{
            'typing-cursor': store.isGeminiDraftActive && store.geminiDraftPreview.length === 0,
          }"
        >
          {{ store.geminiDraftPreview || 'Drafting response...' }}
        </div>
      </div>
    </div>
    <div class="composer-footer">
      <div class="composer-send-actions">
        <button
          class="composer-text-btn composer-text-btn-primary"
          :disabled="!store.composerTo.includes('@') || !store.composerTextArea.trim()"
          @click="store.sendEmail"
        >
          Send
        </button>
        <button class="composer-text-btn">Send later</button>
        <button class="composer-text-btn">Remind me</button>
        <button class="composer-text-btn">Share draft</button>
      </div>
      <div class="composer-tools">
        <button
          class="composer-icon-btn composer-ai-btn"
          title="Help me write"
          @click="store.triggerGeminiDraft"
        >
          ai
        </button>
        <button class="composer-icon-btn" title="Schedule send">
          <span class="material-symbols-outlined">calendar_month</span>
        </button>
        <button class="composer-icon-btn" title="Insert variable">
          <span class="material-symbols-outlined">data_object</span>
        </button>
        <button class="composer-icon-btn" title="Attach file">
          <span class="material-symbols-outlined">attach_file</span>
        </button>
        <button class="composer-icon-btn" title="Discard" @click="store.closeComposer">
          <span class="material-symbols-outlined">delete</span>
        </button>
      </div>
    </div>
  </div>
  </template>
</template>
