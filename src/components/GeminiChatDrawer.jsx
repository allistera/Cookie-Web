import { defineComponent, ref, watch, nextTick } from 'vue'
import { useInboxStore } from '../stores/inbox'

// Assistant replies use lightweight markdown (**bold**, newline-separated
// lines). Render it as VNodes — never raw HTML — so message content can't
// inject markup.
const renderBold = (line) =>
  line.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 === 1 ? <strong>{part}</strong> : part))

const renderMessageText = (text) =>
  String(text)
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line, i) => (
      <div class="chat-line" key={i}>
        {renderBold(line)}
      </div>
    ))

export default defineComponent({
  name: 'GeminiChatDrawer',
  setup() {
    const store = useInboxStore()
    const inputVal = ref('')
    const drawerContentRef = ref(null)

    const handleSend = () => {
      const text = inputVal.value.trim()
      if (text) {
        store.askGemini(text)
        inputVal.value = ''
      }
    }

    const handleKeypress = (e) => {
      if (e.key === 'Enter') {
        handleSend()
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

    return () => (
      <div
        class={`gemini-chat-drawer ${store.isChatDrawerActive ? 'active' : ''}`}
        id="geminiChatDrawer"
      >
        <div class="drawer-header">
          <div class="drawer-title">
            <span class="material-symbols-outlined gemini-color">auto_awesome</span>
            <span>Gemini Workspace</span>
          </div>
          <button
            class="icon-btn close-drawer-btn"
            onClick={() => {
              store.isChatDrawerActive = false
            }}
          >
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>

        <div class="drawer-content" ref={drawerContentRef}>
          {store.chatHistory.map((msg, index) => (
            <div
              key={index}
              class={`chat-msg ${msg.sender} ${msg.typing ? 'typing-cursor' : ''}`}
            >
              {renderMessageText(msg.text)}
              {msg.sources?.length > 0 && (
                <div class="citation-box">
                  {msg.sources.map((source) => (
                    <span class="chat-source" key={source.id} title={source.from_name}>
                      <span class="material-symbols-outlined" style={{ fontSize: '14px' }}>
                        mail
                      </span>
                      <span>{source.subject}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
          {store.isChatLoading && (
            <div class="chat-msg ai typing-cursor">Gemini is searching your workspace...</div>
          )}
        </div>

        <div class="drawer-input-container">
          <input
            type="text"
            class="drawer-input"
            placeholder="Ask Gemini follow up..."
            value={inputVal.value}
            onInput={(e) => {
              inputVal.value = e.target.value
            }}
            onKeydown={handleKeypress}
          />
          <button class="drawer-send-btn" onClick={handleSend}>
            <span class="material-symbols-outlined">send</span>
          </button>
        </div>
      </div>
    )
  },
})
