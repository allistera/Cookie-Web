import { defineComponent, ref, watch, nextTick } from 'vue'
import { useInboxStore } from '../stores/inbox'

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

    const handleCitationClick = (actionType) => {
      if (actionType === 'sheets') {
        store.openTodoModal('sheets', 'todo-soccer')
      } else if (actionType === 'waiver') {
        store.openTodoModal('waiver', 'todo-waiver')
      } else if (actionType === 'kitchen') {
        store.openComposer('todo-kitchen')
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
        className={`gemini-chat-drawer ${store.isChatDrawerActive ? 'active' : ''}`}
        id="geminiChatDrawer"
      >
        <div className="drawer-header">
          <div className="drawer-title">
            <span className="material-symbols-outlined gemini-color">auto_awesome</span>
            <span>Gemini Workspace</span>
          </div>
          <button
            className="icon-btn close-drawer-btn"
            onClick={() => {
              store.isChatDrawerActive = false
            }}
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="drawer-content" ref={drawerContentRef}>
          {store.chatHistory.map((msg, index) => (
            <div
              key={index}
              className={`chat-msg ${msg.sender} ${msg.typing ? 'typing-cursor' : ''}`}
            >
              {msg.text}
              {msg.citationLabel && (
                <div
                  className="citation-box"
                  onClick={() => handleCitationClick(msg.citationActionType)}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>
                    open_in_new
                  </span>
                  <span>{msg.citationLabel}</span>
                </div>
              )}
            </div>
          ))}
          {store.isChatLoading && (
            <div className="chat-msg ai typing-cursor">Gemini is searching your workspace...</div>
          )}
        </div>

        <div className="drawer-input-container">
          <input
            type="text"
            className="drawer-input"
            placeholder="Ask Gemini follow up..."
            value={inputVal.value}
            onInput={(e) => {
              inputVal.value = e.target.value
            }}
            onKeypress={handleKeypress}
          />
          <button className="drawer-send-btn" onClick={handleSend}>
            <span className="material-symbols-outlined">send</span>
          </button>
        </div>
      </div>
    )
  },
})
