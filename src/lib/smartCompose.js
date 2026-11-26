import { AI_API_URL } from './apiWorkers'
import { authHeaders } from './authHeaders'

// Writing suggestions for the message editor: when the writer pauses at the
// end of a line, the words most likely to come next appear greyed out after
// the caret, and Tab (or a click on them) puts them in the message.
//
// The suggestion is drawn by CSS from an attribute on an empty <span>, so it
// is never part of the editor's text, cannot be selected or typed into, and
// the editor takes the span out before it reads its own HTML. Unaccepted
// words therefore cannot reach a draft or a sent message.

// On unless switched off in Settings. Kept in this browser only, like the
// other per-device display choices.
export const SMART_COMPOSE_STORAGE_KEY = 'cookie.smartCompose.off'

export function smartComposeEnabled() {
  try {
    return globalThis.localStorage?.getItem(SMART_COMPOSE_STORAGE_KEY) !== '1'
  } catch {
    return true
  }
}

export function setSmartComposeEnabled(enabled) {
  try {
    if (enabled) globalThis.localStorage?.removeItem(SMART_COMPOSE_STORAGE_KEY)
    else globalThis.localStorage?.setItem(SMART_COMPOSE_STORAGE_KEY, '1')
  } catch {
    // Storage can be blocked; the choice then lasts for this page load only.
  }
}

export async function requestSuggestion(body, signal) {
  const response = await fetch(`${AI_API_URL}/compose-suggest`, {
    method: 'POST',
    headers: await authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
    signal,
  })
  if (!response.ok) throw new Error(`POST /compose-suggest responded ${response.status}`)
  const { suggestion } = await response.json()
  return String(suggestion ?? '')
}

// How long the writer has to stop typing before a suggestion is asked for.
export const SUGGEST_DELAY_MS = 400
// After a refusal (the per-minute allowance, an outage, no connection) the
// editor stops asking for a while rather than failing on every pause.
export const SUGGEST_PAUSE_MS = 60_000
const MIN_TEXT_CHARS = 3
const MAX_TEXT_CHARS = 1500

const LINE_BLOCKS = 'div, p, li, h1, h2, h3, h4, blockquote, pre, td'
const BLOCK_NAME = /^(DIV|P|LI|UL|OL|H[1-6]|BLOCKQUOTE|PRE|HR|TABLE|TR|TD)$/
const CARET_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
])

// The text before the caret with a line break where a block or a <br> ends a
// line, so the model sees the message's lines rather than one run of words.
// `fragment` is a copy of everything up to the caret, so the blocks the caret
// is inside are its last children, and those have not ended.
function linesOf(fragment) {
  let text = ''
  let breakPending = false
  const visit = (parent, caretInside) => {
    for (const node of parent.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        if (!node.data) continue
        if (breakPending) text += '\n'
        breakPending = false
        text += node.data
      } else if (node.nodeName === 'BR') {
        text += '\n'
        breakPending = false
      } else {
        const isBlock = BLOCK_NAME.test(node.nodeName)
        const open = caretInside && node === parent.lastChild
        if (isBlock && text && !text.endsWith('\n')) breakPending = true
        visit(node, open)
        if (isBlock && !open && text && !text.endsWith('\n')) breakPending = true
      }
    }
  }
  visit(fragment, true)
  // Browsers keep a typed trailing space as a non-breaking one.
  return (breakPending ? `${text}\n` : text).replace(/\u00a0/g, ' ')
}

/**
 * @param {{
 *   editor: HTMLElement,
 *   context: () => ({ subject?: string, to?: string, replyToMessageId?: string | null } | null),
 *   blocked?: () => boolean,
 *   insertText: (text: string) => void,
 *   request?: typeof requestSuggestion,
 * }} options `blocked` is true while something else owns the keys (the slash
 *   menu); `insertText` is the editor's own insertion, used where the browser
 *   has no insertText command.
 */
export function createSmartCompose({
  editor,
  context,
  blocked = () => false,
  insertText,
  request = requestSuggestion,
}) {
  let timer = null
  let pending = null
  // The suggestion as it arrived, and the text before the caret it follows.
  let suggestion = ''
  let anchor = ''
  let ghost = null
  let pausedUntil = 0

  // Where the caret is, when it is somewhere a suggestion may be shown: a
  // collapsed caret with nothing after it on its line, outside a code block.
  function caret() {
    const selection = window.getSelection()
    if (!selection?.rangeCount || !selection.isCollapsed) return null
    const range = selection.getRangeAt(0)
    const { startContainer: node, startOffset: offset } = range
    if (!editor.contains(node)) return null
    if (node.nodeType === Node.TEXT_NODE && offset < node.data.length) return null
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement
    if (element.closest('pre')) return null
    const line = element.closest(LINE_BLOCKS)
    const block = line && editor.contains(line) ? line : editor
    const rest = range.cloneRange()
    rest.setEnd(block, block.childNodes.length)
    const walker = document.createTreeWalker(
      rest.cloneContents(),
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
    )
    for (let next = walker.nextNode(); next; next = walker.nextNode()) {
      if (next.nodeName === 'BR' || BLOCK_NAME.test(next.nodeName)) break
      if (next.nodeName === 'IMG' || (next.nodeType === Node.TEXT_NODE && next.data.trim())) {
        return null
      }
    }
    const before = range.cloneRange()
    before.setStart(editor, 0)
    return { node, offset, text: linesOf(before.cloneContents()) }
  }

  // Takes the suggestion off the page but remembers it, so it can come back
  // shortened when the writer types its first letters.
  function hide() {
    if (!ghost) return
    // Unwrap rather than remove: anything a browser managed to put inside is
    // the writer's and stays.
    ghost.replaceWith(...ghost.childNodes)
    ghost = null
  }

  function cancel() {
    clearTimeout(timer)
    timer = null
    pending?.abort()
    pending = null
  }

  function dismiss() {
    cancel()
    hide()
    suggestion = ''
  }

  // Shows what is left of the suggestion at the caret, or forgets it when
  // the caret has moved or the writer typed something else.
  function show() {
    hide()
    const at = suggestion && !blocked() ? caret() : null
    const typed = at?.text.startsWith(anchor) ? at.text.slice(anchor.length) : null
    if (typed === null || !suggestion.startsWith(typed) || suggestion.length === typed.length) {
      suggestion = ''
      return false
    }
    ghost = document.createElement('span')
    ghost.className = 'composer-ghost'
    ghost.setAttribute('aria-hidden', 'true')
    ghost.dataset.suggestion = suggestion.slice(typed.length)
    if (at.node.nodeType === Node.TEXT_NODE) at.node.after(ghost)
    else at.node.insertBefore(ghost, at.node.childNodes[at.offset] ?? null)
    return true
  }

  async function ask() {
    timer = null
    if (!smartComposeEnabled() || Date.now() < pausedUntil || blocked()) return
    const at = caret()
    if (!at || at.text.trim().length < MIN_TEXT_CHARS) return
    const mine = new AbortController()
    pending = mine
    try {
      const { subject, to, replyToMessageId } = context() ?? {}
      const text = await request(
        { text: at.text.slice(-MAX_TEXT_CHARS), subject, to, replyToMessageId },
        mine.signal,
      )
      if (mine.signal.aborted) return
      suggestion = text
      anchor = at.text
      show()
    } catch {
      // Suggestions are a convenience: a failure shows nothing rather than
      // an error in the middle of writing.
      if (!mine.signal.aborted) pausedUntil = Date.now() + SUGGEST_PAUSE_MS
    } finally {
      if (pending === mine) pending = null
    }
  }

  function schedule() {
    cancel()
    // Typing the suggestion's own letters keeps it, without asking again.
    if (show()) return
    timer = setTimeout(ask, SUGGEST_DELAY_MS)
  }

  // Whether the caret still sits right before the suggestion. A selection
  // made since (Select All, a drag) must not be replaced by it.
  function caretAtGhost() {
    const selection = window.getSelection()
    if (!selection?.rangeCount || !selection.isCollapsed) return false
    const { startContainer: node, startOffset: offset } = selection.getRangeAt(0)
    return node.nodeType === Node.TEXT_NODE
      ? node.nextSibling === ghost && offset === node.data.length
      : node.childNodes[offset] === ghost
  }

  function accept() {
    const text = ghost.dataset.suggestion
    dismiss()
    // The browser's own command keeps the insertion in its undo history.
    if (!document.execCommand?.('insertText', false, text)) {
      insertText(text)
      schedule()
    }
  }

  function onInput(event) {
    if (event.isComposing) dismiss()
    else schedule()
  }

  function onKeydown(event) {
    if (!ghost) return
    if (!caretAtGhost()) {
      dismiss()
    } else if (event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault()
      event.stopPropagation()
      accept()
    } else if (event.key === 'Escape') {
      // Escape puts the suggestion away; the composer stays open.
      event.preventDefault()
      event.stopPropagation()
      dismiss()
    } else if (CARET_KEYS.has(event.key)) {
      dismiss()
    }
  }

  function onMousedown(event) {
    if (!ghost) return
    if (event.target === ghost && caretAtGhost()) {
      event.preventDefault()
      accept()
    } else {
      dismiss()
    }
  }

  const listeners = [
    ['beforeinput', hide],
    ['input', onInput],
    ['keydown', onKeydown],
    ['mousedown', onMousedown],
    ['compositionstart', dismiss],
    ['blur', dismiss],
  ]
  for (const [type, listener] of listeners) editor.addEventListener(type, listener)

  return {
    hide,
    destroy() {
      dismiss()
      for (const [type, listener] of listeners) editor.removeEventListener(type, listener)
    },
  }
}
