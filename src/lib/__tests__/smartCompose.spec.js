import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setAuth0Client } from '../../auth0-client'
import { AI_API_URL } from '../apiWorkers'
import {
  SMART_COMPOSE_STORAGE_KEY,
  SUGGEST_DELAY_MS,
  SUGGEST_PAUSE_MS,
  createSmartCompose,
  requestSuggestion,
  setSmartComposeEnabled,
  smartComposeEnabled,
} from '../smartCompose'

function setCaret(node, offset) {
  const range = document.createRange()
  range.setStart(node, offset)
  range.collapse(true)
  const selection = window.getSelection()
  selection.removeAllRanges()
  selection.addRange(range)
}

// The events a browser fires around one typed run of characters.
function type(editor, text) {
  editor.dispatchEvent(new Event('beforeinput', { bubbles: true }))
  const { startContainer: node, startOffset: offset } = window.getSelection().getRangeAt(0)
  node.insertData(offset, text)
  setCaret(node, offset + text.length)
  editor.dispatchEvent(new Event('input', { bubbles: true }))
}

function press(editor, key, init = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  editor.dispatchEvent(event)
  return event
}

const pause = () => vi.advanceTimersByTimeAsync(SUGGEST_DELAY_MS)
const ghostOf = (editor) => editor.querySelector('.composer-ghost')

describe('writing suggestions', () => {
  let editor
  let compose
  let request
  let insertText

  // Mounts an editor holding `html` with the caret at the end of its last
  // text node, as if the writer had just typed it.
  function write(html, options = {}) {
    editor = document.createElement('div')
    editor.contentEditable = 'true'
    editor.innerHTML = html
    document.body.append(editor)
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
    let last = null
    for (let node = walker.nextNode(); node; node = walker.nextNode()) last = node
    if (last) setCaret(last, last.data.length)
    compose = createSmartCompose({
      editor,
      context: () => ({ subject: 'Kitchen', to: 'sam@example.com', replyToMessageId: 'm1' }),
      insertText,
      request,
      ...options,
    })
    return editor
  }

  async function suggested(html, options) {
    write(html, options)
    editor.dispatchEvent(new Event('input', { bubbles: true }))
    await pause()
    return editor
  }

  beforeEach(() => {
    vi.useFakeTimers()
    request = vi.fn().mockResolvedValue(' your email.')
    insertText = vi.fn()
  })

  afterEach(() => {
    compose?.destroy()
    compose = null
    editor?.remove()
    localStorage.clear()
    vi.useRealTimers()
  })

  it('offers the next words after a pause, without adding them to the text', async () => {
    write('<div>Hi Sam,</div><div>Thanks for</div>')
    editor.dispatchEvent(new Event('input', { bubbles: true }))
    expect(request).not.toHaveBeenCalled()

    await pause()

    expect(request).toHaveBeenCalledWith(
      {
        text: 'Hi Sam,\nThanks for',
        subject: 'Kitchen',
        to: 'sam@example.com',
        replyToMessageId: 'm1',
      },
      expect.any(AbortSignal),
    )
    expect(ghostOf(editor).dataset.suggestion).toBe(' your email.')
    expect(ghostOf(editor).previousSibling.data).toBe('Thanks for')
    expect(editor.textContent).toBe('Hi Sam,Thanks for')
  })

  it('waits for the writer to stop before asking', async () => {
    write('Thanks')
    type(editor, ' f')
    await vi.advanceTimersByTimeAsync(SUGGEST_DELAY_MS - 1)
    type(editor, 'or')
    await vi.advanceTimersByTimeAsync(SUGGEST_DELAY_MS - 1)
    expect(request).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)

    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0][0].text).toBe('Thanks for')
  })

  it('reads a typed trailing space and an empty line as the writer left them', async () => {
    await suggested('Thanks for\u00a0')
    expect(request.mock.calls[0][0].text).toBe('Thanks for ')
    compose.destroy()
    editor.remove()
    request.mockClear()

    write('<div>Hi Sam,</div><div><br></div>')
    setCaret(editor.lastChild, 0)
    editor.dispatchEvent(new Event('input', { bubbles: true }))
    await pause()

    expect(request.mock.calls[0][0].text).toBe('Hi Sam,\n')
    expect(editor.lastChild.firstChild).toBe(ghostOf(editor))
  })

  it('sends only the end of a long message', async () => {
    await suggested(`${'a'.repeat(2000)} Thanks for`)

    const { text } = request.mock.calls[0][0]
    expect(text).toHaveLength(1500)
    expect(text.endsWith(' Thanks for')).toBe(true)
  })

  it('puts the suggestion in the message when Tab is pressed', async () => {
    await suggested('Thanks for')

    const event = press(editor, 'Tab')

    expect(event.defaultPrevented).toBe(true)
    expect(insertText).toHaveBeenCalledWith(' your email.')
    expect(ghostOf(editor)).toBeNull()
  })

  it('leaves Tab alone when nothing is suggested', async () => {
    request.mockResolvedValue('')
    await suggested('Thanks for')

    expect(ghostOf(editor)).toBeNull()
    expect(press(editor, 'Tab').defaultPrevented).toBe(false)
    expect(insertText).not.toHaveBeenCalled()
  })

  it('leaves Shift+Tab to move focus back', async () => {
    await suggested('Thanks for')

    expect(press(editor, 'Tab', { shiftKey: true }).defaultPrevented).toBe(false)
    expect(insertText).not.toHaveBeenCalled()
  })

  it('puts the suggestion in the message when it is clicked', async () => {
    await suggested('Thanks for')

    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    ghostOf(editor).dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(insertText).toHaveBeenCalledWith(' your email.')
  })

  it('keeps the rest of the suggestion while the writer types its letters', async () => {
    await suggested('Thanks for')

    type(editor, ' yo')

    expect(ghostOf(editor).dataset.suggestion).toBe('ur email.')
    expect(editor.textContent).toBe('Thanks for yo')
    await pause()
    expect(request).toHaveBeenCalledTimes(1)

    press(editor, 'Tab')
    expect(insertText).toHaveBeenCalledWith('ur email.')
  })

  it('drops the suggestion and asks again when the writer types something else', async () => {
    await suggested('Thanks for')
    request.mockResolvedValue(' week.')

    type(editor, ' last')

    expect(ghostOf(editor)).toBeNull()
    await pause()
    expect(request).toHaveBeenCalledTimes(2)
    expect(ghostOf(editor).dataset.suggestion).toBe(' week.')
  })

  it('drops the suggestion once the writer has typed all of it', async () => {
    await suggested('Thanks for')

    type(editor, ' your email.')

    expect(ghostOf(editor)).toBeNull()
  })

  it('does not replace a selection made after the suggestion appeared', async () => {
    await suggested('Thanks for')
    window.getSelection().selectAllChildren(editor)

    const event = press(editor, 'Tab')

    expect(event.defaultPrevented).toBe(false)
    expect(insertText).not.toHaveBeenCalled()
    expect(ghostOf(editor)).toBeNull()
  })

  it('does not write the suggestion when it is clicked with the caret elsewhere', async () => {
    await suggested('Thanks for')
    setCaret(editor.firstChild, 3)

    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    ghostOf(editor).dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    expect(insertText).not.toHaveBeenCalled()
    expect(ghostOf(editor)).toBeNull()
  })

  it('puts the suggestion away on Escape without closing what is around it', async () => {
    await suggested('Thanks for')
    const outer = vi.fn()
    document.body.addEventListener('keydown', outer)

    const event = press(editor, 'Escape')
    document.body.removeEventListener('keydown', outer)

    expect(ghostOf(editor)).toBeNull()
    expect(event.defaultPrevented).toBe(true)
    expect(outer).not.toHaveBeenCalled()
    // Put away for good: typing its letters does not bring it back.
    type(editor, ' y')
    expect(ghostOf(editor)).toBeNull()
  })

  it.each(['ArrowLeft', 'ArrowUp', 'Home'])('puts the suggestion away on %s', async (key) => {
    await suggested('Thanks for')

    expect(press(editor, key).defaultPrevented).toBe(false)
    expect(ghostOf(editor)).toBeNull()
  })

  it('puts the suggestion away when the editor loses focus or is clicked', async () => {
    await suggested('Thanks for')
    editor.dispatchEvent(new Event('blur'))
    expect(ghostOf(editor)).toBeNull()

    type(editor, ' ')
    await pause()
    expect(ghostOf(editor)).not.toBeNull()
    editor.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    expect(ghostOf(editor)).toBeNull()
    expect(insertText).not.toHaveBeenCalled()
  })

  it('hides the suggestion on request and leaves the message as it was', async () => {
    const html = '<div>Hi Sam,</div><div>Thanks <b>for</b></div>'
    await suggested(html)
    expect(editor.innerHTML).not.toBe(html)

    compose.hide()

    expect(editor.innerHTML).toBe(html)
  })

  it.each([
    ['in the middle of a line', 'Thanks for your email', (root) => setCaret(root.firstChild, 6)],
    [
      'before more text in the same line',
      '<div><b>Thanks</b> for</div>',
      (root) => setCaret(root.querySelector('b').firstChild, 6),
    ],
    ['before an image', 'Thanks <img alt="">', (root) => setCaret(root.firstChild, 7)],
    ['inside a code block', '<pre>Thanks for</pre>', () => {}],
    ['with text selected', 'Thanks for', (root) => window.getSelection().selectAllChildren(root)],
    [
      'with the caret outside the editor',
      'Thanks for',
      () => window.getSelection().removeAllRanges(),
    ],
    ['after only a character or two', 'Hi', () => {}],
  ])('does not ask %s', async (_name, html, place) => {
    write(html)
    place(editor)
    editor.dispatchEvent(new Event('input', { bubbles: true }))
    await pause()

    expect(request).not.toHaveBeenCalled()
  })

  it('asks at the end of a line that has other lines below it', async () => {
    write('<div>Thanks for</div><div>-- <br>Allister</div>')
    setCaret(editor.firstChild.firstChild, 10)
    editor.dispatchEvent(new Event('input', { bubbles: true }))
    await pause()

    expect(request.mock.calls[0][0].text).toBe('Thanks for')
    expect(ghostOf(editor).parentNode).toBe(editor.firstChild)
  })

  it('asks at the end of a line written straight into the editor', async () => {
    write('Thanks for<br>Allister')
    setCaret(editor.firstChild, 10)
    editor.dispatchEvent(new Event('input', { bubbles: true }))
    await pause()

    expect(request.mock.calls[0][0].text).toBe('Thanks for')
    expect(ghostOf(editor).nextSibling.nodeName).toBe('BR')
  })

  it('ignores an answer that arrives after the writer typed on', async () => {
    let answer
    request.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve
        }),
    )
    write('Thanks for')
    editor.dispatchEvent(new Event('input', { bubbles: true }))
    await pause()
    const [, signal] = request.mock.calls[0]

    type(editor, ' the')
    answer(' your email.')
    await vi.advanceTimersByTimeAsync(0)

    expect(signal.aborted).toBe(true)
    expect(ghostOf(editor)).toBeNull()
  })

  it('does not show an answer after the caret has moved away', async () => {
    let answer
    request.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve
        }),
    )
    write('Thanks for')
    editor.dispatchEvent(new Event('input', { bubbles: true }))
    await pause()

    setCaret(editor.firstChild, 3)
    answer(' your email.')
    await vi.advanceTimersByTimeAsync(0)

    expect(ghostOf(editor)).toBeNull()
  })

  it('stops asking for a minute after a refusal, then asks again', async () => {
    request.mockRejectedValueOnce(new Error('POST /compose-suggest responded 429'))
    await suggested('Thanks for')
    expect(request).toHaveBeenCalledTimes(1)
    expect(ghostOf(editor)).toBeNull()

    type(editor, ' ')
    await pause()
    expect(request).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(SUGGEST_PAUSE_MS)
    type(editor, 'y')
    await pause()
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('does not ask while writing suggestions are switched off', async () => {
    setSmartComposeEnabled(false)
    await suggested('Thanks for')
    expect(request).not.toHaveBeenCalled()

    setSmartComposeEnabled(true)
    type(editor, ' ')
    await pause()
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('does not ask or show while something else owns the keys', async () => {
    let blocked = true
    await suggested('Thanks for', { blocked: () => blocked })
    expect(request).not.toHaveBeenCalled()

    blocked = false
    type(editor, ' ')
    await pause()
    expect(ghostOf(editor)).not.toBeNull()
    blocked = true
    type(editor, 'y')
    expect(ghostOf(editor)).toBeNull()
  })

  it('stops listening once destroyed', async () => {
    await suggested('Thanks for')

    compose.destroy()

    expect(ghostOf(editor)).toBeNull()
    type(editor, ' ')
    await pause()
    expect(request).toHaveBeenCalledTimes(1)
  })
})

describe('writing suggestions setting', () => {
  afterEach(() => localStorage.clear())

  it('is on until switched off, and remembers the choice in this browser', () => {
    expect(smartComposeEnabled()).toBe(true)

    setSmartComposeEnabled(false)
    expect(smartComposeEnabled()).toBe(false)
    expect(localStorage.getItem(SMART_COMPOSE_STORAGE_KEY)).toBe('1')

    setSmartComposeEnabled(true)
    expect(smartComposeEnabled()).toBe(true)
    expect(localStorage.getItem(SMART_COMPOSE_STORAGE_KEY)).toBeNull()
  })
})

describe('requestSuggestion', () => {
  beforeEach(() => setAuth0Client({ getAccessTokenSilently: async () => 'token' }))

  afterEach(() => {
    setAuth0Client(null)
    vi.unstubAllGlobals()
  })

  it('posts the text before the caret and returns the suggestion', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ suggestion: ' your email.' }))
    vi.stubGlobal('fetch', fetchMock)
    const { signal } = new AbortController()

    await expect(
      requestSuggestion({ text: 'Thanks for', subject: 'Kitchen' }, signal),
    ).resolves.toBe(' your email.')

    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe(`${AI_API_URL}/compose-suggest`)
    expect(options.method).toBe('POST')
    expect(options.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer token',
    })
    expect(options.signal).toBe(signal)
    expect(JSON.parse(options.body)).toEqual({ text: 'Thanks for', subject: 'Kitchen' })
  })

  it('fails on a refusal so the editor can stop asking', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ error: 'slow down' }, { status: 429 })),
    )

    await expect(requestSuggestion({ text: 'Thanks for' })).rejects.toThrow('responded 429')
  })
})
