const TOOLBOX_ICON = `
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <line x1="4" y1="6" x2="20" y2="6"/>
    <line x1="8" y1="12" x2="20" y2="12"/>
    <line x1="8" y1="18" x2="20" y2="18"/>
  </svg>`

// Keys Editor.js's own BlockEvents handler would otherwise act on
// block-wide (Enter splitting or adding a block, Backspace/Delete merging or
// removing it) while focus is on one of the entry buttons.
const GUARDED_KEYS = new Set(['Backspace', 'Delete', 'Enter'])

/**
 * Lists the header blocks currently in the editor, in document order.
 *
 * @param {{ getBlocksCount(): number, getBlockByIndex(index: number): any }} blocks
 * @returns {{ index: number, level: number, text: string, element: HTMLElement }[]}
 */
export function collectHeadings(blocks) {
  const headings = []
  const count = blocks.getBlocksCount()
  for (let index = 0; index < count; index += 1) {
    const block = blocks.getBlockByIndex(index)
    if (block?.name !== 'header') continue
    const element = block.holder?.querySelector('h1, h2, h3, h4, h5, h6')
    const text = element?.textContent?.trim()
    if (!text) continue
    headings.push({ id: block.id, index, level: Number(element.tagName.slice(1)), text, element })
  }
  return headings
}

// A "/" menu block that shows the document's headings as a clickable
// outline. It stores no data of its own: the list is rebuilt from the header
// blocks whenever the editor content changes, so it can never go stale, and
// exports rebuild it from the saved blocks the same way (documentExport.js).
export class TocBlockTool {
  static get toolbox() {
    return { title: 'Table of contents', icon: TOOLBOX_ICON }
  }

  static get enableLineBreaks() {
    return true
  }

  constructor({ api }) {
    this.api = api
    this.wrapper = null
    this.list = null
    this.observer = null
    this.frame = null
    this.signature = null
  }

  render() {
    this.wrapper = document.createElement('nav')
    this.wrapper.className = 'toc-block'
    this.wrapper.setAttribute('aria-label', 'Table of contents')
    this.wrapper.contentEditable = 'false'
    this.wrapper.addEventListener('keydown', (event) => {
      if (GUARDED_KEYS.has(event.key)) event.stopPropagation()
    })

    const heading = document.createElement('div')
    heading.className = 'toc-block__title'
    heading.textContent = 'Contents'
    this.list = document.createElement('ol')
    this.list.className = 'toc-block__list'
    this.wrapper.append(heading, this.list)

    this.refresh()
    return this.wrapper
  }

  // Called by Editor.js once the block is in the DOM, so the observer can
  // attach to the editor's content area.
  rendered() {
    this.scheduleRefresh()
    const root = this.wrapper?.closest('.codex-editor__redactor') ?? this.wrapper?.parentElement
    if (!root || this.observer) return
    this.observer = new MutationObserver((mutations) => {
      // Ignore the list re-rendering itself, or it would refresh forever.
      if (mutations.every((mutation) => this.wrapper.contains(mutation.target))) return
      this.scheduleRefresh()
    })
    this.observer.observe(root, { childList: true, subtree: true, characterData: true })
  }

  scheduleRefresh() {
    if (this.frame !== null) return
    this.frame = requestAnimationFrame(() => {
      this.frame = null
      this.refresh()
    })
  }

  refresh() {
    if (!this.list) return
    const headings = collectHeadings(this.api.blocks)
    // Skip the DOM rewrite when nothing visible changed (most edits happen
    // in paragraphs), so typing elsewhere doesn't churn this block.
    const signature = JSON.stringify(headings.map(({ level, text }) => [level, text]))
    if (signature === this.signature) return
    this.signature = signature

    this.list.replaceChildren()
    if (!headings.length) {
      const empty = document.createElement('li')
      empty.className = 'toc-block__empty'
      empty.textContent = 'Add headings to build the table of contents.'
      this.list.append(empty)
      return
    }
    const topLevel = Math.min(...headings.map((entry) => entry.level))
    const seen = new Map()
    for (const entry of headings) {
      // Which same-text heading this is, so duplicates each jump to their own.
      const key = `${entry.level}:${entry.text}`
      const occurrence = seen.get(key) ?? 0
      seen.set(key, occurrence + 1)
      const item = document.createElement('li')
      item.className = 'toc-block__item'
      item.style.setProperty('--toc-depth', String(entry.level - topLevel))
      const link = document.createElement('button')
      link.type = 'button'
      link.className = 'toc-block__link'
      link.textContent = entry.text
      link.addEventListener('click', () => this.goTo(entry.text, entry.level, occurrence))
      item.append(link)
      this.list.append(item)
    }
  }

  // Looks the heading up again at click time: blocks may have moved since
  // the list was built.
  goTo(text, level, occurrence = 0) {
    const target = collectHeadings(this.api.blocks).filter(
      (entry) => entry.text === text && entry.level === level,
    )[occurrence]
    if (!target) return
    // Lets the editor expand a collapsed section hiding this heading first
    // (see headingCollapse.js), so there is something to scroll to.
    this.wrapper?.dispatchEvent(
      new CustomEvent('cookie:reveal-block', { bubbles: true, detail: { id: target.id } }),
    )
    target.element.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
    this.api.caret?.setToBlock?.(target.index, 'end')
  }

  save() {
    return {}
  }

  destroy() {
    this.observer?.disconnect()
    this.observer = null
    if (this.frame !== null) cancelAnimationFrame(this.frame)
    this.frame = null
  }

  removed() {
    this.destroy()
  }
}
