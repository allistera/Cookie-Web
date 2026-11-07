<script setup>
import { computed, ref, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useInboxStore } from '../stores/inbox'
import { sourceIcon } from '../lib/assistantChat'

const store = useInboxStore()
const router = useRouter()
const inputVal = ref('')
const drawerContentRef = ref(null)

// Assistant replies use lightweight markdown (**bold**, newline-separated
// lines). Parse into plain-text segments the template renders itself — never
// raw HTML — so message content can't inject markup.
function messageLines(text) {
  return String(text)
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) =>
      line.split(/\*\*(.+?)\*\*/g).map((part, i) => ({ text: part, bold: i % 2 === 1 })),
    )
}

function handleSend() {
  const text = inputVal.value.trim()
  if (text) {
    store.askAssistant(text)
    inputVal.value = ''
  }
}

// The status bubble ("Searching mail…", or a plain thinking line before the
// model has said what it is doing) shows until the first answer text lands.
const showStatus = computed(() => {
  if (!store.isChatLoading) return false
  const last = store.chatHistory.at(-1)
  return !(last?.sender === 'ai' && last.text)
})

// A cited document opens in place; mail and tasks have no route of their own
// (the reader and task panel resolve items out of loaded lists), so their
// chips only name the source.
function openSource(source) {
  if (source.index === 'documents' && source.id) router.push(`/documents/${source.id}`)
}

// Streaming assistant replies mutate the last message as tokens arrive.
watch(
  () => [store.chatHistory.length, store.chatHistory.at(-1)?.text, store.chatStatus],
  () => {
    nextTick(() => {
      if (drawerContentRef.value) {
        drawerContentRef.value.scrollTop = drawerContentRef.value.scrollHeight
      }
    })
  },
)
</script>

<template>
  <div
    id="geminiChatDrawer"
    class="gemini-chat-drawer"
    :class="{ active: store.isChatDrawerActive }"
    role="dialog"
    aria-label="Cookie Assistant"
    :inert="store.isChatDrawerActive ? null : true"
  >
    <div class="drawer-header">
      <div class="drawer-title">
        <span class="material-symbols-outlined gemini-color">auto_awesome</span>
        <span>Cookie Assistant</span>
      </div>
      <button
        class="icon-btn close-drawer-btn"
        title="Close"
        aria-label="Close Cookie Assistant"
        @click="store.isChatDrawerActive = false"
      >
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>

    <div class="drawer-content" ref="drawerContentRef">
      <p v-if="store.chatHistory.length === 0 && !store.isChatLoading" class="chat-empty">
        Ask about your mail, documents and tasks. Answers come from a search of your own data, with
        the sources underneath.
      </p>
      <div
        v-for="(msg, index) in store.chatHistory"
        :key="index"
        class="chat-msg"
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
            :class="{ 'chat-source-link': source.index === 'documents' }"
            :type="source.index === 'documents' ? 'button' : null"
            :title="source.subtitle || source.title"
            @click="openSource(source)"
          >
            <span class="material-symbols-outlined" style="font-size: 14px">{{
              sourceIcon(source)
            }}</span>
            <span>{{ source.title }}</span>
          </component>
        </div>
      </div>
      <div v-if="showStatus" class="chat-msg ai typing-cursor chat-status">
        {{ store.chatStatus || 'Thinking…' }}
      </div>
    </div>

    <div class="drawer-input-container">
      <label class="visually-hidden" for="chatDrawerInput">Ask Cookie Assistant</label>
      <input
        id="chatDrawerInput"
        type="text"
        class="drawer-input"
        :placeholder="store.chatHistory.length ? 'Ask a follow-up...' : 'Ask about your mail...'"
        v-model="inputVal"
        @keydown.enter="handleSend"
      />
      <button class="drawer-send-btn" title="Send" aria-label="Send message" @click="handleSend">
        <span class="material-symbols-outlined">send</span>
      </button>
    </div>
  </div>
</template>
