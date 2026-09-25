import {
  CODE_LANGUAGES,
  PLAIN_LANGUAGE,
  escapeCode,
  highlightCode,
  loadHighlighter,
  normalizeCodeLanguage,
} from './codeHighlight'

const TOOLBOX_ICON = `
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="16 18 22 12 16 6"/>
    <polyline points="8 6 2 12 8 18"/>
  </svg>`

const INDENT = '  '

/** Plain data for a code block: `{ code, language }`, tolerant of old `{ code }` rows. */
export function normalizeCodeBlock(data) {
  return {
    code: String(data?.code ?? ''),
    language: normalizeCodeLanguage(data?.language),
  }
}

// A "/" menu code block with syntax highlighting and a language dropdown.
// The editing surface is a transparent textarea laid over a <pre> that shows
// the highlighted copy of the same text, so typing stays native (selection,
// undo, IME) while the colours update once per frame of input. Plain DOM, like
// KanbanBlockTool - Editor.js owns and destroys the element itself.
export class CodeBlockTool {
  static get toolbox() {
    return { title: 'Code', icon: TOOLBOX_ICON }
  }

  static get isReadOnlySupported() {
    return true
  }

  // Enter inserts a newline in the textarea instead of splitting the block.
  static get enableLineBreaks() {
    return true
  }

  // Code is saved from the textarea's value, never as markup, so it needs no
  // stripping; the language is validated against the dropdown on save.
  static get sanitize() {
    return { code: true, language: {} }
  }

  // Lets the block-settings menu convert a paragraph to code and back.
  static get conversionConfig() {
    return { import: 'code', export: 'code' }
  }

  static get pasteConfig() {
    return { tags: ['pre'] }
  }

  constructor({ data, block, readOnly, config }) {
    this.data = normalizeCodeBlock(data)
    this.block = block
    this.readOnly = Boolean(readOnly)
    this.placeholder = config?.placeholder ?? 'Write code here…'
    this.wrapper = null
    this.textarea = null
    this.preview = null
    this.select = null
    this.destroyed = false
    this.refreshFrame = null
  }

  render() {
    this.wrapper = document.createElement('div')
    this.wrapper.className = 'code-block'

    const bar = document.createElement('div')
    bar.className = 'code-block__bar'
    this.select = document.createElement('select')
    this.select.className = 'code-block__language'
    this.select.setAttribute('aria-label', 'Code language')
    this.select.disabled = this.readOnly
    for (const language of CODE_LANGUAGES) {
      const option = document.createElement('option')
      option.value = language.id
      option.textContent = language.label
      this.select.append(option)
    }
    this.select.value = this.data.language
    this.select.addEventListener('change', () => {
      this.data.language = normalizeCodeLanguage(this.select.value)
      this.refresh()
      this.loadGrammar()
      this.block?.dispatchChange?.()
    })
    bar.append(this.select)

    const editor = document.createElement('div')
    editor.className = 'code-block__editor'
    this.preview = document.createElement('pre')
    this.preview.className = 'code-block__preview'
    this.preview.setAttribute('aria-hidden', 'true')
    this.textarea = document.createElement('textarea')
    this.textarea.className = 'code-block__textarea'
    this.textarea.placeholder = this.placeholder
    this.textarea.spellcheck = false
    this.textarea.setAttribute('autocapitalize', 'off')
    this.textarea.setAttribute('autocomplete', 'off')
    this.textarea.setAttribute('aria-label', 'Code')
    this.textarea.readOnly = this.readOnly
    this.textarea.value = this.data.code
    this.textarea.addEventListener('input', () => {
      this.data.code = this.textarea.value
      this.scheduleRefresh()
    })
    this.textarea.addEventListener('keydown', (event) => this.onKeydown(event))
    editor.append(this.preview, this.textarea)

    this.wrapper.append(bar, editor)
    this.refresh()
    this.loadGrammar()
    return this.wrapper
  }

  // Fetches the current language's grammar, then re-renders with colours.
  loadGrammar() {
    if (this.data.language === PLAIN_LANGUAGE) return
    loadHighlighter(this.data.language).then(
      () => {
        if (!this.destroyed) this.refresh()
      },
      () => {},
    )
  }

  // Highlighting re-parses the whole block, so bursts of typing are coalesced
  // into one refresh per animation frame.
  scheduleRefresh() {
    if (this.refreshFrame !== null) return
    this.refreshFrame = requestAnimationFrame(() => {
      this.refreshFrame = null
      if (!this.destroyed) this.refresh()
    })
  }

  // Re-renders the highlighted copy. A trailing newline keeps the preview the
  // same height as the textarea, which always reserves the line after the
  // final newline.
  refresh() {
    if (!this.preview) return
    const code = this.data.code
    const html =
      this.data.language === PLAIN_LANGUAGE
        ? escapeCode(code)
        : highlightCode(code, this.data.language)
    this.preview.innerHTML = `<code>${html}\n</code>`
    this.wrapper.dataset.language = this.data.language
  }

  onKeydown(event) {
    if (event.key !== 'Tab' || this.readOnly) return
    event.preventDefault()
    event.stopPropagation()
    const { selectionStart, selectionEnd, value } = this.textarea
    this.textarea.value = `${value.slice(0, selectionStart)}${INDENT}${value.slice(selectionEnd)}`
    this.textarea.selectionStart = this.textarea.selectionEnd = selectionStart + INDENT.length
    this.textarea.dispatchEvent(new Event('input', { bubbles: true }))
  }

  onPaste(event) {
    if (event.type !== 'tag') return
    const pre = event.detail.data
    this.data.code = pre?.textContent ?? ''
    if (this.textarea) this.textarea.value = this.data.code
    this.refresh()
  }

  save() {
    return {
      code: this.textarea ? this.textarea.value : this.data.code,
      language: normalizeCodeLanguage(this.select ? this.select.value : this.data.language),
    }
  }

  destroy() {
    this.destroyed = true
    if (this.refreshFrame !== null) cancelAnimationFrame(this.refreshFrame)
    this.refreshFrame = null
  }
}
