import { describe, expect, it, vi } from 'vitest'

import { CodeBlockTool, normalizeCodeBlock } from '../codeBlockTool.js'
import { CODE_LANGUAGES, loadHighlighter } from '../codeHighlight.js'

function type(textarea, value) {
  textarea.value = value
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('CodeBlockTool', () => {
  it('tolerates legacy { code } rows and unknown languages', () => {
    expect(normalizeCodeBlock({ code: 'x' })).toEqual({ code: 'x', language: 'plaintext' })
    expect(normalizeCodeBlock({ code: 'x', language: 'nope' })).toEqual({
      code: 'x',
      language: 'plaintext',
    })
    expect(normalizeCodeBlock(undefined)).toEqual({ code: '', language: 'plaintext' })
  })

  it('renders a language dropdown over an editable textarea and saves both', () => {
    const tool = new CodeBlockTool({ data: { code: 'print(1)', language: 'python' } })
    const el = tool.render()

    const select = el.querySelector('select.code-block__language')
    expect(select.value).toBe('python')
    expect([...select.options].map((option) => option.value)).toEqual(
      CODE_LANGUAGES.map((language) => language.id),
    )
    const textarea = el.querySelector('textarea.code-block__textarea')
    expect(textarea.value).toBe('print(1)')
    expect(el.querySelector('.code-block__preview').textContent).toBe('print(1)\n')

    type(textarea, 'print(2)')
    select.value = 'javascript'
    select.dispatchEvent(new Event('change'))
    expect(el.dataset.language).toBe('javascript')
    expect(tool.save()).toEqual({ code: 'print(2)', language: 'javascript' })
  })

  it('highlights the preview once the grammars load and escapes markup in the meantime', async () => {
    const tool = new CodeBlockTool({
      data: { code: 'const a = "<i>";', language: 'javascript' },
    })
    const el = tool.render()
    const preview = el.querySelector('.code-block__preview')
    expect(preview.querySelector('i')).toBeNull()
    expect(preview.textContent).toContain('<i>')

    await loadHighlighter('javascript')
    await vi.waitFor(() => expect(preview.querySelector('.hljs-keyword')).not.toBeNull())
    expect(preview.querySelector('i')).toBeNull()
  })

  it('coalesces typing into one preview refresh per animation frame', () => {
    const frames = []
    vi.stubGlobal('requestAnimationFrame', (callback) => frames.push(callback))
    vi.stubGlobal('cancelAnimationFrame', () => {})
    try {
      const tool = new CodeBlockTool({ data: { code: 'a' } })
      const el = tool.render()
      const textarea = el.querySelector('textarea')
      const preview = el.querySelector('.code-block__preview')

      type(textarea, 'ab')
      type(textarea, 'abc')
      expect(frames).toHaveLength(1)
      expect(preview.textContent).toBe('a\n')
      expect(tool.save().code).toBe('abc')

      frames[0]()
      expect(preview.textContent).toBe('abc\n')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('notifies the editor when only the language changes', () => {
    const block = { dispatchChange: vi.fn() }
    const tool = new CodeBlockTool({ data: { code: 'x' }, block })
    const el = tool.render()
    const select = el.querySelector('select')
    select.value = 'go'
    select.dispatchEvent(new Event('change'))
    expect(block.dispatchChange).toHaveBeenCalledTimes(1)
  })

  it('inserts two spaces on Tab instead of leaving the block', () => {
    const tool = new CodeBlockTool({ data: { code: 'ab' } })
    const textarea = tool.render().querySelector('textarea')
    textarea.selectionStart = textarea.selectionEnd = 1
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    textarea.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(textarea.value).toBe('a  b')
    expect(textarea.selectionStart).toBe(3)
    expect(tool.save().code).toBe('a  b')
  })

  it('takes pasted <pre> content as code and respects read-only mode', () => {
    const tool = new CodeBlockTool({ data: {} })
    const el = tool.render()
    const pre = document.createElement('pre')
    pre.innerHTML = 'a &lt; b'
    tool.onPaste({ type: 'tag', detail: { data: pre } })
    expect(el.querySelector('textarea').value).toBe('a < b')
    expect(tool.save().code).toBe('a < b')

    const readOnly = new CodeBlockTool({ data: { code: 'x' }, readOnly: true }).render()
    expect(readOnly.querySelector('textarea').readOnly).toBe(true)
    expect(readOnly.querySelector('select').disabled).toBe(true)
  })
})
