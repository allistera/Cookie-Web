const STORAGE_PREFIX = 'cookie:collapsed-headings:'

// Expanded shows ">" (collapse), collapsed shows a down arrow (expand).
const COLLAPSE_ICON = `
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <polyline points="9 6 15 12 9 18"/>
  </svg>`
const EXPAND_ICON = `
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <polyline points="6 9 12 15 18 9"/>
  </svg>`

/** @param {string | null | undefined} docId */
export function loadCollapsedHeadings(docId) {
  if (!docId) return new Set()
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_PREFIX + docId) ?? '[]')
    return new Set(Array.isArray(stored) ? stored.map(String) : [])
  } catch {
    return new Set()
  }
}

/**
 * @param {string | null | undefined} docId
 * @param {Set<string>} collapsed
 */
export function saveCollapsedHeadings(docId, collapsed) {
  if (!docId) return
  try {
    if (collapsed.size) localStorage.setItem(STORAGE_PREFIX + docId, JSON.stringify([...collapsed]))
    else localStorage.removeItem(STORAGE_PREFIX + docId)
  } catch {
    // Blocked or full storage: collapsing still works for this visit.
  }
}

/**
 * Works out which blocks a set of collapsed headings hides. A collapsed
 * heading hides everything after it up to the next heading of the same or a
 * higher level (a smaller number); headings inside a hidden range are hidden
 * with it whatever their own state.
 *
 * @param {{ id: string, level: number | null }[]} outline blocks in order; level is null for non-headings
 * @param {Set<string>} collapsed
 * @returns {Map<string, string>} hidden block id -> id of the heading hiding it
 */
export function hiddenBlocks(outline, collapsed) {
  const hidden = new Map()
  let owner = null
  let ownerLevel = null
  for (const { id, level } of outline) {
    if (owner !== null) {
      if (level !== null && level <= ownerLevel) owner = null
      else {
        hidden.set(id, owner)
        continue
      }
    }
    if (level !== null && collapsed.has(id)) {
      owner = id
      ownerLevel = level
    }
  }
  return hidden
}

function blockOutline(editor) {
  const outline = []
  const count = editor.blocks.getBlocksCount()
  for (let index = 0; index < count; index += 1) {
    const block = editor.blocks.getBlockByIndex(index)
    if (!block) continue
    const heading =
      block.name === 'header' ? block.holder?.querySelector('h1, h2, h3, h4, h5, h6') : null
    outline.push({
      id: block.id,
      holder: block.holder,
      level: heading ? Number(heading.tagName.slice(1)) : null,
    })
  }
  return outline
}

/**
 * Adds a collapse toggle to Editor.js's hover toolbar, left of "+", shown
 * while the pointer is over a heading, and hides the blocks under collapsed
 * headings. Collapsing is a view preference: blocks stay in the document and
 * are saved, exported and searched as usual.
 *
 * @param {{ editor: any, holder: HTMLElement, docId?: string | null }} options
 */
export function createHeadingCollapse({ editor, holder, docId }) {
  const collapsed = loadCollapsedHeadings(docId)
  let hoveredId = null

  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'ce-toolbar__collapse'
  button.hidden = true
  // Keep the caret where it is; Editor.js would otherwise treat the press as
  // a click into the editor and move focus or close its toolbar.
  button.addEventListener('mousedown', (event) => {
    event.preventDefault()
    event.stopPropagation()
  })
  button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    if (!hoveredId) return
    if (collapsed.has(hoveredId)) collapsed.delete(hoveredId)
    else collapsed.add(hoveredId)
    saveCollapsedHeadings(docId, collapsed)
    apply()
  })
  // Editor.js builds one toolbar per editor, lazily after it reports ready,
  // and moves it to the hovered block; the toggle rides along as its first
  // action, left of "+". Attached on first use since it may not exist yet.
  function attach() {
    if (button.isConnected) return
    holder.querySelector('.ce-toolbar__actions')?.prepend(button)
  }

  function updateButton() {
    attach()
    const block = hoveredId ? editor.blocks.getById?.(hoveredId) : null
    const isHeading = block?.name === 'header'
    button.hidden = !isHeading
    if (!isHeading) return
    const isCollapsed = collapsed.has(hoveredId)
    button.innerHTML = isCollapsed ? EXPAND_ICON : COLLAPSE_ICON
    button.setAttribute('aria-expanded', String(!isCollapsed))
    const label = isCollapsed ? 'Expand section' : 'Collapse section'
    button.setAttribute('aria-label', label)
    button.title = label
  }

  function onPointerMove(event) {
    const blockElement = event.target instanceof Element ? event.target.closest('.ce-block') : null
    // Moving onto the toolbar itself keeps the heading it belongs to.
    if (!blockElement || !holder.contains(blockElement)) return
    const id = blockElement.dataset.id ?? null
    if (id === hoveredId) return
    hoveredId = id
    updateButton()
  }
  holder.addEventListener('mousemove', onPointerMove)

  function apply() {
    const outline = blockOutline(editor)
    // Forget headings that no longer exist so storage doesn't grow forever.
    const ids = new Set(outline.map((block) => block.id))
    let pruned = false
    for (const id of collapsed) {
      if (!ids.has(id)) {
        collapsed.delete(id)
        pruned = true
      }
    }
    if (pruned) saveCollapsedHeadings(docId, collapsed)

    const hidden = hiddenBlocks(outline, collapsed)
    for (const block of outline) {
      const element = block.holder
      if (!element) continue
      element.classList.toggle('ce-block--collapsed-hidden', hidden.has(block.id))
      element.classList.toggle(
        'ce-block--collapsed',
        block.level !== null && collapsed.has(block.id),
      )
    }
    updateButton()
    return hidden
  }

  // Expands whatever hides a block, e.g. the caret moved into a collapsed
  // section, or the table of contents jumped to a heading inside one.
  function reveal(blockId) {
    let hidden = hiddenBlocks(blockOutline(editor), collapsed)
    let changed = false
    while (hidden.has(blockId)) {
      collapsed.delete(hidden.get(blockId))
      changed = true
      hidden = hiddenBlocks(blockOutline(editor), collapsed)
    }
    if (!changed) return
    saveCollapsedHeadings(docId, collapsed)
    apply()
  }

  function onReveal(event) {
    if (event.detail?.id) reveal(event.detail.id)
  }
  holder.addEventListener('cookie:reveal-block', onReveal)

  function refresh() {
    const hidden = apply()
    // Typing into a hidden block (Enter at the end of a collapsed heading
    // adds one right under it) reveals its section instead of vanishing.
    const index = editor.blocks.getCurrentBlockIndex?.() ?? -1
    const current = index >= 0 ? editor.blocks.getBlockByIndex(index) : null
    if (current && hidden.has(current.id)) reveal(current.id)
  }

  apply()

  return {
    refresh,
    reveal,
    destroy() {
      holder.removeEventListener('mousemove', onPointerMove)
      holder.removeEventListener('cookie:reveal-block', onReveal)
      button.remove()
    },
  }
}
