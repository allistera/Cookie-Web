import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TocBlockTool, collectHeadings } from '../tocBlockTool.js'

// A stand-in for Editor.js's blocks API over plain DOM holders, the same
// shape the real BlockAPI exposes (name + holder).
function editorWith(specs) {
  const root = document.createElement('div')
  root.className = 'codex-editor__redactor'
  document.body.append(root)
  const blocks = specs.map(([name, tag, text]) => {
    const holder = document.createElement('div')
    if (tag) {
      const element = document.createElement(tag)
      element.textContent = text
      holder.append(element)
    }
    root.append(holder)
    return { name, holder }
  })
  const api = {
    blocks: {
      getBlocksCount: () => blocks.length,
      getBlockByIndex: (index) => blocks[index],
    },
    caret: { setToBlock: vi.fn() },
  }
  return { root, blocks, api }
}

function mount(api, root) {
  const tool = new TocBlockTool({ api })
  const element = tool.render()
  const holder = document.createElement('div')
  holder.append(element)
  root.prepend(holder)
  return { tool, element }
}

const links = (element) =>
  [...element.querySelectorAll('.toc-block__link')].map((link) => link.textContent)

describe('TocBlockTool', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback) => setTimeout(callback, 0))
    vi.stubGlobal('cancelAnimationFrame', (id) => clearTimeout(id))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    document.body.replaceChildren()
  })

  it('lists non-empty headings in document order, indented by level', () => {
    const { root, api } = editorWith([
      ['header', 'h2', 'Intro'],
      ['paragraph', 'p', 'Body'],
      ['header', 'h3', 'Detail'],
      ['header', 'h2', '   '],
      ['header', 'h2', 'Wrap up'],
    ])
    const { element } = mount(api, root)

    expect(links(element)).toEqual(['Intro', 'Detail', 'Wrap up'])
    const depths = [...element.querySelectorAll('.toc-block__item')].map((item) =>
      item.style.getPropertyValue('--toc-depth'),
    )
    expect(depths).toEqual(['0', '1', '0'])
    expect(element.getAttribute('aria-label')).toBe('Table of contents')
  })

  it('shows a hint when the document has no headings', () => {
    const { root, api } = editorWith([['paragraph', 'p', 'Just text']])
    const { element } = mount(api, root)
    expect(element.querySelector('.toc-block__empty').textContent).toContain('Add headings')
  })

  it('scrolls to the clicked heading and places the caret there, duplicates included', () => {
    const { root, blocks, api } = editorWith([
      ['header', 'h2', 'Notes'],
      ['paragraph', 'p', 'x'],
      ['header', 'h2', 'Notes'],
    ])
    const scrolled = []
    for (const block of blocks) {
      const heading = block.holder.firstElementChild
      heading.scrollIntoView = () => scrolled.push(block)
    }
    const { element } = mount(api, root)

    element.querySelectorAll('.toc-block__link')[1].click()

    expect(scrolled).toEqual([blocks[2]])
    expect(api.caret.setToBlock).toHaveBeenCalledWith(2, 'end')
  })

  it('refreshes when headings change elsewhere in the editor', async () => {
    const { root, blocks, api } = editorWith([['header', 'h2', 'Before']])
    const { tool, element } = mount(api, root)
    tool.rendered()

    blocks[0].holder.firstElementChild.textContent = 'After'
    await vi.waitFor(() => expect(links(element)).toEqual(['After']))
    tool.destroy()
  })

  it('keeps Enter and Backspace on its buttons away from Editor.js', () => {
    const { root, api } = editorWith([['header', 'h2', 'Intro']])
    const { element } = mount(api, root)
    const bubbled = vi.fn()
    root.addEventListener('keydown', bubbled)

    const link = element.querySelector('.toc-block__link')
    link.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    link.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }))

    expect(bubbled).not.toHaveBeenCalled()
  })

  it('saves no data of its own', () => {
    const { root, api } = editorWith([])
    const { tool } = mount(api, root)
    expect(tool.save()).toEqual({})
  })
})

describe('collectHeadings', () => {
  it('reads level and trimmed text from each header block', () => {
    const { api } = editorWith([
      ['header', 'h1', ' Title '],
      ['list', 'ul', 'item'],
      ['header', 'h3', 'Sub'],
    ])
    expect(
      collectHeadings(api.blocks).map(({ index, level, text }) => [index, level, text]),
    ).toEqual([
      [0, 1, 'Title'],
      [2, 3, 'Sub'],
    ])
  })
})
