import { SEARCH_API_URL } from './apiWorkers'

// Helpers for the assistant drawer's conversation with the search
// Worker's POST /chat (Meilisearch conversational search). The Worker owns
// the model and the per-user search scope; the browser owns the transcript.

// How many messages a request may carry. The endpoint is stateless, so every
// turn resends the conversation — the person's questions, the answers, and
// the search tool calls and results Meilisearch hands back to be replayed
// (two or more per search). Thirty keeps several turns of context without
// the request growing without bound; the Worker refuses more than forty.
export const MAX_CONVERSATION_MESSAGES = 30

// Drops the oldest messages until the conversation fits, then keeps dropping
// until it opens with one of the person's questions: a tool result whose
// request was cut away is rejected by the model, and an answer without its
// question is noise.
export function trimConversation(messages, max = MAX_CONVERSATION_MESSAGES) {
  let start = Math.max(0, messages.length - max)
  while (start < messages.length && messages[start].role !== 'user') start += 1
  return messages.slice(start)
}

const SEARCH_LABELS = {
  messages: 'Searching mail…',
  documents: 'Searching documents…',
  task_items: 'Searching tasks…',
}

// What the drawer shows while Meilisearch runs a search for the model.
export function searchingLabel(index) {
  return SEARCH_LABELS[String(index ?? '')] ?? 'Searching…'
}

const SOURCE_ICONS = { messages: 'mail', documents: 'description', task_items: 'task_alt' }

export function sourceIcon(source) {
  return SOURCE_ICONS[String(source?.index ?? '')] ?? 'search'
}

export const MAX_SOURCES = 12

// One answer may come from several searches; the chips show each cited item
// once, in the order it was first cited, capped so a chatty search round does
// not fill the drawer with chips.
export function mergeSources(existing, incoming) {
  const merged = [...existing]
  const seen = new Set(existing.map((source) => `${source.index}/${source.id}`))
  for (const source of incoming ?? []) {
    const key = `${source.index}/${source.id}`
    if (seen.has(key) || merged.length >= MAX_SOURCES) continue
    seen.add(key)
    merged.push(source)
  }
  return merged
}

// Reads the chat Worker's server-sent events (`data: <json>` blocks) from a
// response body and hands each parsed event to `onEvent`, which returns
// false to stop reading early (the caller moved on to a newer question).
export async function readAssistantEvents(body, onEvent) {
  const reader = body?.getReader()
  if (!reader) throw new Error('Assistant stream unavailable')
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) return
    buffer += decoder.decode(value, { stream: true })
    const events = buffer.split('\n\n')
    buffer = events.pop() ?? ''
    for (const event of events) {
      const line = event.split('\n').find((part) => part.startsWith('data: '))
      if (line && onEvent(JSON.parse(line.slice(6))) === false) return
    }
  }
}

// Whether an answer reads as a list: two or more lines that start like list
// items ("1.", "2)", "-", "•"). With two or more cited emails that is the
// assistant enumerating mail, which the inbox list shows better than a
// drawer bubble.
export function isEmailList(text, sources) {
  if (mailSourcesOf(sources).length < 2) return false
  const items = String(text ?? '')
    .split('\n')
    .filter((line) => /^\s*(\d+[.)]|[-•*])\s+\S/.test(line))
  return items.length >= 2
}

export function mailSourcesOf(sources) {
  return (sources ?? []).filter((source) => source.index === 'messages' && source.id)
}

// How many of an answer's cited emails the inbox list shows: the chat Worker
// cites at most ten per search, and the search Worker reads up to twenty ids.
export const MAX_LISTED_EMAILS = 20

// The rows for an answer's listed emails, from the search Worker by id and in
// the order given, in the same shape as a search so the inbox renders them as
// it renders any hit.
export async function loadListedEmails(ids, headers, signal) {
  const wanted = ids.slice(0, MAX_LISTED_EMAILS).join(',')
  const response = await fetch(`${SEARCH_API_URL}/search?ids=${encodeURIComponent(wanted)}`, {
    headers,
    signal,
  })
  if (!response.ok) throw new Error(`GET /search?ids responded ${response.status}`)
  const { emails } = await response.json()
  return emails
}

// One question to the assistant, from the request to the committed
// conversation, run from the inbox store's askAssistant (which owns the
// transcript entry, the abort of the previous question and the loading
// flags). The Worker answers with its own small event vocabulary: `searching`
// and `sources` as the model's searches run, `message` for a message to
// replay next turn, `token` for answer text, `error` when something upstream
// failed, `done`. Resolves true when the answer listed emails and the inbox
// list now shows them.
export async function runAssistantTurn(store, query, { signal, isCurrent, push }) {
  // The conversation the model sees for this turn. It is committed to
  // chatMessages only once the answer has arrived, so an abandoned or failed
  // question is not replayed under the next one.
  const messages = trimConversation([...store.chatMessages, { role: 'user', content: query }])
  const replayed = []
  let activeReply = null
  let failed = false
  let listed = false
  try {
    const headers = await store.authHeaders({ 'Content-Type': 'application/json' })
    if (!isCurrent()) return false
    const response = await fetch(`${SEARCH_API_URL}/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ messages }),
      signal,
    })
    if (!response.ok) {
      throw new Error(`POST /chat responded ${response.status}`, {
        cause: { status: response.status },
      })
    }
    if (!isCurrent()) return false
    activeReply = { text: '', sender: 'ai', sources: [], typing: true }
    push(activeReply)
    await readAssistantEvents(response.body, (data) => {
      if (!isCurrent()) return false
      if (data.type === 'searching') store.chatStatus = searchingLabel(data.index)
      if (data.type === 'sources') {
        activeReply.sources = mergeSources(activeReply.sources, data.sources)
      }
      if (data.type === 'message') replayed.push(data.message)
      if (data.type === 'token') {
        activeReply.text += data.text
        store.chatStatus = ''
      }
      if (data.type === 'error') failed = true
      if (data.type === 'done') activeReply.typing = false
    })
    if (!isCurrent()) return false
    activeReply.typing = false
    // An answer that enumerates emails becomes the inbox list's result set,
    // like a search would, with the question as the search label.
    if (isEmailList(activeReply.text, activeReply.sources)) {
      listed = await store.showAssistantEmails(
        query,
        mailSourcesOf(activeReply.sources).map((source) => source.id),
      )
      if (!isCurrent()) return false
    }
    if (!activeReply.text) {
      activeReply.text = failed
        ? 'Sorry, something went wrong while answering. Please try again.'
        : "I couldn't find anything about that."
    }
    if (!failed) {
      store.chatMessages = trimConversation([
        ...messages,
        ...replayed,
        { role: 'assistant', content: activeReply.text },
      ])
    }
  } catch (error) {
    if (!isCurrent() || error?.name === 'AbortError') return false
    if (activeReply) activeReply.typing = false
    console.error('Ask failed:', error)
    push({
      text:
        error?.cause?.status === 429
          ? 'You are asking faster than the assistant can answer. Give it a minute.'
          : "Sorry, I couldn't reach the assistant. Please try again.",
      sender: 'ai',
      sources: [],
    })
  }
  return listed
}
