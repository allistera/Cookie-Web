// Pure helpers for the assistant drawer's conversation with the search
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
