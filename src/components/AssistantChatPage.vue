<script setup>
import { computed, nextTick, onMounted, ref, shallowRef, watch } from 'vue'
import { useRouter } from 'vue-router'

import { messageLines, sourceIcon } from '../lib/assistantChat'
import { useInboxStore } from '../stores/inbox'

// Cookie Assistant on a page of its own: the conversation down the middle and
// the question box under it. It is the same conversation the header's
// assistant drawer shows (the inbox store holds it), so a chat started in
// either carries on in the other.
const store = useInboxStore()
const router = useRouter()
const inputVal = ref('')
const inputRef = ref(null)
const threadRef = ref(null)

const isEmpty = computed(() => store.chatHistory.length === 0 && !store.isChatLoading)

// The status line ("Searching mail…", or a plain thinking line before the
// model has said what it is doing) shows until the first answer text lands.
const showStatus = computed(() => {
  if (!store.isChatLoading) return false
  const last = store.chatHistory.at(-1)
  return !(last?.sender === 'ai' && last.text)
})

// The reply whose listed emails the inbox list currently holds. Only the
// latest one: each such answer replaces the inbox's results.
const listedReply = shallowRef(null)

// The box grows with what is typed, up to the height its style allows.
function fitInput() {
  const input = inputRef.value
  if (!input) return
  input.style.height = 'auto'
  input.style.height = `${input.scrollHeight}px`
}

async function handleSend() {
  const text = inputVal.value.trim()
  if (!text || store.isChatLoading) return
  inputVal.value = ''
  nextTick(fitInput)
  const turn = store.askAssistant(text)
  // Asking opens the drawer for the header's assistant; the conversation is
  // already on screen here.
  store.isChatDrawerActive = false
  if (await turn) listedReply.value = store.chatHistory.at(-1)
}

function handleEnter(event) {
  if (event.shiftKey || event.isComposing) return
  event.preventDefault()
  handleSend()
}

function startNewChat() {
  store.chatHistory = []
  store.chatMessages = []
  listedReply.value = null
  inputRef.value?.focus()
}

// A cited document opens in Documents; mail and tasks have no route of their
// own, so their chips only name the source.
function openSource(source) {
  if (source.index === 'documents' && source.id) router.push(`/documents/${source.id}`)
}

onMounted(() => inputRef.value?.focus())

// Streaming replies change the last message as tokens arrive.
watch(
  () => [store.chatHistory.length, store.chatHistory.at(-1)?.text, store.chatStatus],
  () => {
    nextTick(() => {
      if (threadRef.value) threadRef.value.scrollTop = threadRef.value.scrollHeight
    })
  },
  { immediate: true },
)
</script>

<template>
  <section class="assistant-chat" :class="{ empty: isEmpty }" aria-label="Cookie Assistant">
    <header v-if="!isEmpty" class="assistant-chat-bar">
      <span class="assistant-chat-name">
        <span class="material-symbols-outlined gemini-color" aria-hidden="true">auto_awesome</span>
        Cookie Assistant
      </span>
      <button
        type="button"
        class="assistant-chat-new"
        :disabled="store.isChatLoading"
        @click="startNewChat"
      >
        <span class="material-symbols-outlined" aria-hidden="true">edit_square</span>
        New chat
      </button>
    </header>

    <div v-if="!isEmpty" ref="threadRef" class="assistant-chat-thread">
      <div class="assistant-chat-column">
        <div
          v-for="(msg, index) in store.chatHistory"
          :key="index"
          class="assistant-chat-msg"
          :class="[msg.sender, { 'typing-cursor': msg.typing }]"
        >
          <div v-for="(line, li) in messageLines(msg.text)" :key="li" class="chat-line">
            <template v-for="(seg, si) in line" :key="si">
              <strong v-if="seg.bold">{{ seg.text }}</strong>
              <template v-else>{{ seg.text }}</template>
            </template>
          </div>
          <div v-if="msg.sources?.length" class="citation-box">
            <component
              :is="source.index === 'documents' ? 'button' : 'span'"
              v-for="source in msg.sources"
              :key="`${source.index}/${source.id}`"
              class="chat-source"
              :type="source.index === 'documents' ? 'button' : null"
              :title="source.subtitle || source.title"
              @click="openSource(source)"
            >
              <span class="material-symbols-outlined" aria-hidden="true">{{
                sourceIcon(source)
              }}</span>
              <span>{{ source.title }}</span>
            </component>
          </div>
          <!-- An answer that listed emails put them in the inbox list. -->
          <router-link v-if="msg === listedReply" to="/inbox" class="assistant-chat-inbox">
            <span class="material-symbols-outlined" aria-hidden="true">inbox</span>
            Show these emails in the inbox
          </router-link>
        </div>
        <div v-if="showStatus" class="assistant-chat-msg ai typing-cursor chat-status">
          {{ store.chatStatus || 'Thinking…' }}
        </div>
      </div>
    </div>

    <div class="assistant-chat-column assistant-chat-foot">
      <h1 v-if="isEmpty" class="assistant-chat-greeting">What can I help with?</h1>
      <div class="assistant-chat-composer">
        <label class="visually-hidden" for="assistantChatInput">Ask Cookie Assistant</label>
        <textarea
          id="assistantChatInput"
          ref="inputRef"
          v-model="inputVal"
          class="assistant-chat-input"
          rows="1"
          :placeholder="isEmpty ? 'Ask about your mail, documents and tasks' : 'Ask a follow-up'"
          @input="fitInput"
          @keydown.enter="handleEnter"
        ></textarea>
        <button
          type="button"
          class="assistant-chat-send"
          aria-label="Send message"
          title="Send"
          :disabled="!inputVal.trim() || store.isChatLoading"
          @click="handleSend"
        >
          <span class="material-symbols-outlined" aria-hidden="true">arrow_upward</span>
        </button>
      </div>
      <p class="assistant-chat-note">
        Answers come from a search of your own mail, documents and tasks, with the sources
        underneath.
      </p>
    </div>
  </section>
</template>

<style scoped>
.assistant-chat {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* Before the first question the greeting and the box sit mid-page. */
.assistant-chat.empty {
  justify-content: center;
  padding-bottom: 10vh;
}

.assistant-chat-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
}

.assistant-chat-name {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
}

.assistant-chat-name .material-symbols-outlined {
  font-size: 18px;
}

.assistant-chat-new {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 10px;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--text-primary);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.assistant-chat-new:hover:not(:disabled),
.assistant-chat-new:focus-visible {
  background-color: var(--bg-hover);
}

.assistant-chat-new:disabled {
  color: var(--text-secondary);
  cursor: default;
}

.assistant-chat-new .material-symbols-outlined {
  font-size: 18px;
  color: var(--text-secondary);
}

.assistant-chat-thread {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 0 24px;
}

.assistant-chat-column {
  width: 100%;
  max-width: 768px;
  margin: 0 auto;
  padding: 0 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.assistant-chat-msg {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 15px;
  line-height: 1.6;
  color: var(--text-primary);
  overflow-wrap: anywhere;
}

/* The person's questions are bubbles on the right; answers are plain text
   across the column. */
.assistant-chat-msg.user {
  align-self: flex-end;
  max-width: 75%;
  padding: 10px 16px;
  border-radius: 18px;
  background-color: var(--bg-input);
}

.assistant-chat-msg .citation-box {
  margin-top: 0;
  padding-top: 0;
  border-top: 0;
  font-size: 12px;
}

.assistant-chat-msg .chat-source .material-symbols-outlined {
  font-size: 14px;
}

.assistant-chat-inbox {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-blue);
  text-decoration: none;
}

.assistant-chat-inbox:hover,
.assistant-chat-inbox:focus-visible {
  text-decoration: underline;
}

.assistant-chat-inbox .material-symbols-outlined {
  font-size: 16px;
}

.assistant-chat-foot {
  gap: 0;
  padding-bottom: 12px;
}

.assistant-chat-greeting {
  margin: 0 0 24px;
  font-size: 28px;
  font-weight: 600;
  text-align: center;
}

.assistant-chat-composer {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 8px 8px 8px 18px;
  border: 1px solid var(--border-color);
  border-radius: 26px;
  background-color: var(--bg-card);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.assistant-chat-composer:focus-within {
  border-color: var(--accent);
}

.assistant-chat-input {
  flex: 1;
  min-width: 0;
  max-height: 200px;
  padding: 6px 0;
  border: 0;
  outline: 0;
  resize: none;
  background: none;
  color: var(--text-primary);
  font-family: var(--font-stack);
  font-size: 15px;
  line-height: 1.5;
}

.assistant-chat-send {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 50%;
  background-color: var(--accent);
  color: #ffffff;
  cursor: pointer;
}

.assistant-chat-send:hover:not(:disabled) {
  background-color: var(--accent-hover);
}

.assistant-chat-send:disabled {
  background-color: var(--bg-input);
  color: var(--text-secondary);
  cursor: default;
}

.assistant-chat-send .material-symbols-outlined {
  font-size: 20px;
}

/* Beside the sidebar on a narrow screen the column needs its width back. */
@media (max-width: 760px) {
  .assistant-chat-column {
    padding: 0 12px;
  }

  .assistant-chat-msg.user {
    max-width: 90%;
  }
}

.assistant-chat-note {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--text-secondary);
  text-align: center;
}
</style>
