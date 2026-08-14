<script setup>
import { ref, watch, nextTick } from 'vue'
import { useInboxStore } from '../stores/inbox'

const store = useInboxStore()
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

// Auto scroll when chat updates
watch(
  () => store.chatHistory,
  () => {
    nextTick(() => {
      if (drawerContentRef.value) {
        drawerContentRef.value.scrollTop = drawerContentRef.value.scrollHeight
      }
    })
  },
  { deep: true },
)
</script>

<template>
  <div
    class="gemini-chat-drawer"
    :class="{ active: store.isChatDrawerActive }"
    id="geminiChatDrawer"
  >
    <div class="drawer-header">
      <div class="drawer-title">
        <span class="material-symbols-outlined gemini-color">auto_awesome</span>
        <span>Cookie Assistant</span>
      </div>
      <button class="icon-btn close-drawer-btn" @click="store.isChatDrawerActive = false">
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>

    <div class="drawer-content" ref="drawerContentRef">
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
          <span
            v-for="source in msg.sources"
            :key="source.id"
            class="chat-source"
            :title="source.from_name"
          >
            <span class="material-symbols-outlined" style="font-size: 14px">mail</span>
            <span>{{ source.subject }}</span>
          </span>
        </div>
      </div>
      <div v-if="store.isChatLoading" class="chat-msg ai typing-cursor">
        Searching your mailbox...
      </div>
    </div>

    <div class="drawer-input-container">
      <input
        type="text"
        class="drawer-input"
        placeholder="Ask a follow-up..."
        v-model="inputVal"
        @keydown.enter="handleSend"
      />
      <button class="drawer-send-btn" @click="handleSend">
        <span class="material-symbols-outlined">send</span>
      </button>
    </div>
  </div>
</template>
