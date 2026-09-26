import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createHeadingCollapse,
  hiddenBlocks,
  loadCollapsedHeadings,
  saveCollapsedHeadings,
} from '../headingCollapse.js'

const outline = (...specs) => specs.map(([id, level = null]) => ({ id, level }))

describe('hiddenBlocks', () => {
  it('hides everything under a collapsed heading until one of the same or higher level', () => {
    const blocks = outline(['h1', 2], ['p1'], ['h2', 3], ['p2'], ['h3', 2], ['p3'])
    expect([...hiddenBlocks(blocks, new Set(['h1'])).keys()]).toEqual(['p1', 'h2', 'p2'])
  })

  it('collapses only the sub-section for a lower-level heading', () => {
    const blocks = outline(['h1', 2], ['p1'], ['h2', 3], ['p2'], ['h3', 2], ['p3'])
    expect([...hiddenBlocks(blocks, new Set(['h2'])).entries()]).toEqual([['p2', 'h2']])
  })

  it('reports the outermost collapsed heading as the owner of nested content', () => {
    const blocks = outline(['h1', 1], ['h2', 2], ['p'])
    expect(hiddenBlocks(blocks, new Set(['h1', 'h2'])).get('p')).toBe('h1')
  })

  it('ignores collapsed ids that are not headings', () => {
    expect(hiddenBlocks(outline(['p1'], ['p2']), new Set(['p1'])).size).toBe(0)
  })
})

describe('collapsed heading storage', () => {
  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('round-trips per document and clears the key when empty', () => {
    saveCollapsedHeadings('doc-1', new Set(['a', 'b']))
    expect([...loadCollapsedHeadings('doc-1')]).toEqual(['a', 'b'])
    expect(loadCollapsedHeadings('doc-2').size).toBe(0)
    saveCollapsedHeadings('doc-1', new Set())
    expect(localStorage.getItem('cookie:collapsed-headings:doc-1')).toBeNull()
  })

  it('survives blocked or corrupt storage', () => {
    localStorage.setItem('cookie:collapsed-headings:doc-1', '{not json')
    expect(loadCollapsedHeadings('doc-1').size).toBe(0)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => saveCollapsedHeadings('doc-1', new Set(['a']))).not.toThrow()
  })
})

// Mirrors the Editor.js DOM this module touches: one toolbar with an
// actions row, and a .ce-block per block carrying data-id.
function fakeEditor(specs) {
  const holder = document.createElement('div')
  const toolbar = document.createElement('div')
  toolbar.className = 'ce-toolbar__actions'
  toolbar.append(Object.assign(document.createElement('span'), { className: 'ce-toolbar__plus' }))
  holder.append(toolbar)
  document.body.append(holder)
  const blocks = specs.map(([id, tag]) => {
    const element = document.createElement('div')
    element.className = 'ce-block'
    element.dataset.id = id
    const content = document.createElement(tag)
    content.textContent = id
    element.append(content)
    holder.append(element)
    return { id, name: tag.startsWith('h') ? 'header' : 'paragraph', holder: element }
  })
  let current = -1
  const editor = {
    blocks: {
      getBlocksCount: () => blocks.length,
      getBlockByIndex: (index) => blocks[index],
      getById: (id) => blocks.find((block) => block.id === id) ?? null,
      getCurrentBlockIndex: () => current,
    },
  }
  return { holder, toolbar, blocks, editor, setCurrent: (index) => (current = index) }
}

function hover(element) {
  element.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
}

describe('createHeadingCollapse', () => {
  afterEach(() => {
    localStorage.clear()
    document.body.replaceChildren()
  })

  it('shows the toggle left of "+" only while a heading is hovered', () => {
    const { holder, toolbar, blocks, editor } = fakeEditor([
      ['intro', 'h2'],
      ['body', 'p'],
    ])
    createHeadingCollapse({ editor, holder, docId: 'doc-1' })
    const toggle = toolbar.firstElementChild

    expect(toggle.className).toBe('ce-toolbar__collapse')
    expect(toggle.nextElementSibling.className).toBe('ce-toolbar__plus')
    expect(toggle.hidden).toBe(true)

    hover(blocks[0].holder)
    expect(toggle.hidden).toBe(false)
    expect(toggle.getAttribute('aria-label')).toBe('Collapse section')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')

    hover(blocks[1].holder)
    expect(toggle.hidden).toBe(true)
  })

  it('collapses and expands a section, remembering it per document', () => {
    const { holder, toolbar, blocks, editor } = fakeEditor([
      ['intro', 'h2'],
      ['body', 'p'],
      ['next', 'h2'],
    ])
    const collapse = createHeadingCollapse({ editor, holder, docId: 'doc-1' })
    const toggle = toolbar.firstElementChild

    hover(blocks[0].holder)
    toggle.click()
    expect(blocks[1].holder.classList.contains('ce-block--collapsed-hidden')).toBe(true)
    expect(blocks[2].holder.classList.contains('ce-block--collapsed-hidden')).toBe(false)
    expect(blocks[0].holder.classList.contains('ce-block--collapsed')).toBe(true)
    expect(toggle.getAttribute('aria-label')).toBe('Expand section')
    expect(JSON.parse(localStorage.getItem('cookie:collapsed-headings:doc-1'))).toEqual(['intro'])

    // A fresh mount (reload) restores the collapsed state.
    collapse.destroy()
    blocks[1].holder.classList.remove('ce-block--collapsed-hidden')
    createHeadingCollapse({ editor, holder, docId: 'doc-1' })
    expect(blocks[1].holder.classList.contains('ce-block--collapsed-hidden')).toBe(true)

    hover(blocks[0].holder)
    toolbar.firstElementChild.click()
    expect(blocks[1].holder.classList.contains('ce-block--collapsed-hidden')).toBe(false)
    expect(localStorage.getItem('cookie:collapsed-headings:doc-1')).toBeNull()
  })

  it('reveals a section when the caret lands inside it or the table of contents asks', () => {
    const { holder, blocks, editor, setCurrent } = fakeEditor([
      ['intro', 'h2'],
      ['body', 'p'],
      ['sub', 'h3'],
    ])
    saveCollapsedHeadings('doc-1', new Set(['intro']))
    const collapse = createHeadingCollapse({ editor, holder, docId: 'doc-1' })
    expect(blocks[2].holder.classList.contains('ce-block--collapsed-hidden')).toBe(true)

    holder.dispatchEvent(
      new CustomEvent('cookie:reveal-block', { bubbles: true, detail: { id: 'sub' } }),
    )
    expect(blocks[2].holder.classList.contains('ce-block--collapsed-hidden')).toBe(false)

    saveCollapsedHeadings('doc-1', new Set(['intro']))
    collapse.destroy()
    const again = createHeadingCollapse({ editor, holder, docId: 'doc-1' })
    setCurrent(1)
    again.refresh()
    expect(blocks[1].holder.classList.contains('ce-block--collapsed-hidden')).toBe(false)
  })

  it('forgets collapsed headings that were deleted', () => {
    const { holder, editor } = fakeEditor([['intro', 'h2']])
    saveCollapsedHeadings('doc-1', new Set(['intro', 'gone']))
    createHeadingCollapse({ editor, holder, docId: 'doc-1' })
    expect(JSON.parse(localStorage.getItem('cookie:collapsed-headings:doc-1'))).toEqual(['intro'])
  })
})
