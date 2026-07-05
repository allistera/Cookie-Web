<script setup>
import { ref, watch, nextTick, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useInboxStore } from './stores/inbox'
import GeminiChatDrawer from './components/GeminiChatDrawer.jsx'

const store = useInboxStore()
const route = useRoute()

// Header Search
const searchInputVal = ref('')
const isSearchSuggestionsActive = ref(false)

function selectSuggestion(query) {
  searchInputVal.value = query
  isSearchSuggestionsActive.value = false
  store.askGemini(query)
}

function handleSearchEnter() {
  const query = searchInputVal.value.trim()
  if (query) {
    isSearchSuggestionsActive.value = false
    store.askGemini(query)
  }
}

function clearSearch() {
  searchInputVal.value = ''
  store.isChatDrawerActive = false
}

// Canvas waiver signature variables
const signatureCanvasRef = ref(null)
let canvasCtx = null
let isDrawing = false

function setupSignatureCanvas() {
  const canvas = signatureCanvasRef.value
  if (!canvas) return

  canvasCtx = canvas.getContext('2d')
  canvasCtx.strokeStyle =
    document.documentElement.getAttribute('data-theme') === 'dark' ? '#7fcfff' : '#0b57d0'
  canvasCtx.lineWidth = 3
  canvasCtx.lineCap = 'round'

  canvasCtx.clearRect(0, 0, canvas.width, canvas.height)

  canvas.addEventListener('mousedown', startDrawing)
  canvas.addEventListener('mousemove', draw)
  canvas.addEventListener('mouseup', stopDrawing)
  canvas.addEventListener('mouseout', stopDrawing)
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

// Document level click listener to close search dropdown
onMounted(() => {
  document.addEventListener('click', (e) => {
    const searchContainer = document.getElementById('searchBarContainer')
    if (searchContainer && !searchContainer.contains(e.target)) {
      isSearchSuggestionsActive.value = false
    }
  })
})
</script>

<template>
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
          <span class="logo-text">Gmail</span>
        </div>
      </div>

      <div class="header-center">
        <div class="search-bar-container" id="searchBarContainer">
          <span class="material-symbols-outlined search-icon glow-ai">spark</span>
          <input
            type="text"
            class="search-input"
            placeholder="Ask Gmail..."
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
        <!-- Theme Switcher -->
        <button class="icon-btn theme-toggle-btn" @click="store.toggleTheme" title="Toggle theme">
          <span class="material-symbols-outlined">dark_mode</span>
        </button>
        <button class="icon-btn" title="Help">
          <span class="material-symbols-outlined">help</span>
        </button>
        <button class="icon-btn" title="Settings">
          <span class="material-symbols-outlined">settings</span>
        </button>
        <button class="icon-btn gemini-badge-btn" title="Gemini Status">
          <span class="material-symbols-outlined gemini-color">spark</span>
        </button>
        <button class="icon-btn" title="Google apps">
          <span class="material-symbols-outlined">apps</span>
        </button>
        <div class="profile-container" title="Google Account: Allister">
          <img src="/rose_avatar.jpg" alt="Allister" class="profile-img" />
        </div>
      </div>
    </header>

    <div class="app-body">
      <!-- LEFT SIDEBAR -->
      <aside class="left-sidebar">
        <button class="compose-btn" @click="store.openComposer(null)">
          <span class="material-symbols-outlined">edit</span>
          <span class="compose-text">Compose</span>
        </button>

        <nav class="sidebar-nav">
          <router-link
            to="/inbox"
            class="nav-item"
            :class="{ active: route.name === 'traditional-inbox' }"
          >
            <span class="material-symbols-outlined">inbox</span>
            <span class="nav-text">Inbox</span>
            <span class="nav-badge">{{ store.unreadInboxCount }}</span>
          </router-link>
          <router-link to="/" class="nav-item" :class="{ active: route.name === 'ai-inbox' }">
            <span class="material-symbols-outlined fill-icon gemini-color">spark</span>
            <span class="nav-text">AI Inbox</span>
          </router-link>
          <a href="#" class="nav-item">
            <span class="material-symbols-outlined">star</span>
            <span class="nav-text">Starred</span>
          </a>
          <a href="#" class="nav-item">
            <span class="material-symbols-outlined">schedule</span>
            <span class="nav-text">Snoozed</span>
          </a>
          <a href="#" class="nav-item">
            <span class="material-symbols-outlined">send</span>
            <span class="nav-text">Sent</span>
          </a>
          <a href="#" class="nav-item">
            <span class="material-symbols-outlined">description</span>
            <span class="nav-text">Drafts</span>
          </a>
          <a href="#" class="nav-item">
            <span class="material-symbols-outlined">keyboard_arrow_down</span>
            <span class="nav-text">More</span>
          </a>
        </nav>

        <div class="sidebar-labels">
          <div class="labels-header">
            <span>Labels</span>
            <button class="add-label-btn" title="Create new label">
              <span class="material-symbols-outlined">add</span>
            </button>
          </div>
        </div>
      </aside>

      <!-- MAIN CONTENT PANEL -->
      <main class="main-content">
        <router-view />
      </main>

      <!-- RIGHT SIDEBAR (WORKSPACE ICONS) -->
      <aside class="right-sidebar-panel">
        <div class="workspace-icons">
          <button class="ws-icon-btn active" title="Calendar">
            <img
              src="https://ssl.gstatic.com/calendar/images/dynamiclogo_2020q4/calendar_31_2x.png"
              alt="Calendar"
              class="ws-icon-img"
            />
          </button>
          <button class="ws-icon-btn" title="Keep">
            <img
              src="https://www.gstatic.com/images/branding/product/2x/keep_2020q4_48dp.png"
              alt="Keep"
              class="ws-icon-img"
            />
          </button>
          <button class="ws-icon-btn" title="Tasks">
            <img
              src="https://www.gstatic.com/images/branding/product/2x/tasks_2020q4_48dp.png"
              alt="Tasks"
              class="ws-icon-img"
            />
          </button>
          <button class="ws-icon-btn" title="Contacts">
            <img
              src="https://www.gstatic.com/images/branding/product/2x/contacts_2020q4_48dp.png"
              alt="Contacts"
              class="ws-icon-img"
            />
          </button>
          <button class="ws-icon-btn" title="Voice">
            <span class="material-symbols-outlined text-green voice-icon-size">call</span>
          </button>
          <div class="ws-separator"></div>
          <button class="ws-icon-btn" title="Get Add-ons">
            <span class="material-symbols-outlined text-gray">add</span>
          </button>
        </div>

        <!-- Render Gemini JSX Chat Drawer -->
        <GeminiChatDrawer />
      </aside>
    </div>

    <!-- MODAL OVERLAYS -->
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
            Save & Sync to Gmail
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

  <!-- Inline Composer Toast -->
  <div class="composer-toast" :class="{ active: store.isComposerActive }" id="composerToast">
    <div class="composer-header">
      <span>New Message (Reply to Tile Vendor)</span>
      <span class="material-symbols-outlined close-composer" @click="store.closeComposer"
        >close</span
      >
    </div>
    <div class="composer-fields">
      <div>To: <strong>info@citytileandstone.com</strong></div>
      <div>Subject: <strong>Re: Kitchen Renovation - Tile Selection Due</strong></div>
    </div>
    <div class="composer-body">
      <textarea v-model="store.composerTextArea" placeholder="Write reply here..."></textarea>

      <!-- Inline Gemini drafting box -->
      <div class="composer-gemini-box" :class="{ active: store.isGeminiDraftActive }">
        <div class="gemini-draft-header">
          <div class="gemini-badge">
            <span class="material-symbols-outlined gemini-color font-sm">spark</span>
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
      <button class="btn btn-primary" @click="store.sendEmail">Send</button>
      <button class="btn btn-text" @click="store.triggerGeminiDraft">
        <span class="material-symbols-outlined gemini-color font-sm">spark</span>
        <span>Help me write</span>
      </button>
    </div>
  </div>
</template>
