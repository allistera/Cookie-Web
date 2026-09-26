import { describe, expect, it, vi } from 'vitest'

import {
  attachCodePaste,
  codeLanguageFromHint,
  languageFromElement,
  preText,
  readCodePaste,
} from '../codePaste.js'

function clipboard(data) {
  return { getData: (type) => data[type] ?? '' }
}

function html(markup) {
  return new DOMParser().parseFromString(markup, 'text/html').body
}

describe('codeLanguageFromHint', () => {
  it('maps common aliases and falls back to plain text', () => {
    expect(codeLanguageFromHint('typescriptreact')).toBe('typescript')
    expect(codeLanguageFromHint('JS')).toBe('javascript')
    expect(codeLanguageFromHint('shellscript')).toBe('bash')
    expect(codeLanguageFromHint('yml')).toBe('yaml')
    expect(codeLanguageFromHint('c++')).toBe('cpp')
    expect(codeLanguageFromHint('python')).toBe('python')
    expect(codeLanguageFromHint('cobol')).toBe('plaintext')
    expect(codeLanguageFromHint('')).toBe('plaintext')
  })
})

describe('languageFromElement', () => {
  it('reads language classes on the pre, its code child, or a wrapper', () => {
    expect(languageFromElement(html('<pre class="language-rust">x</pre>').firstChild)).toBe('rust')
    expect(languageFromElement(html('<pre><code class="lang-py">x</code></pre>').firstChild)).toBe(
      'python',
    )
    const github = html('<div class="highlight highlight-source-js"><pre>x</pre></div>')
    expect(languageFromElement(github.querySelector('pre'))).toBe('javascript')
    expect(languageFromElement(html('<pre data-lang="go">x</pre>').firstChild)).toBe('go')
    expect(languageFromElement(html('<pre>x</pre>').firstChild)).toBe('plaintext')
  })
})

describe('preText', () => {
  it('keeps <br> line breaks and drops the trailing newline', () => {
    expect(preText(html('<pre>a<br>b<br>\n</pre>').firstChild)).toBe('a\nb')
  })
})

describe('readCodePaste', () => {
  it('uses the language VS Code attaches to a multi-line copy', () => {
    const pasted = readCodePaste(
      clipboard({
        'text/plain': 'const a = 1\r\nconst b = 2\r\n',
        'text/html': '<div style="white-space: pre; font-family: Menlo, monospace">…</div>',
        'vscode-editor-data': JSON.stringify({ mode: 'typescriptreact' }),
      }),
    )
    expect(pasted).toEqual({ code: 'const a = 1\nconst b = 2', language: 'typescript' })
  })

  it('leaves a few words copied from one line of VS Code as ordinary text', () => {
    expect(
      readCodePaste(
        clipboard({
          'text/plain': 'useState',
          'vscode-editor-data': JSON.stringify({ mode: 'javascript' }),
        }),
      ),
    ).toBeNull()
  })

  it('turns a Markdown code fence into a code block', () => {
    expect(readCodePaste(clipboard({ 'text/plain': '```py title="x"\nprint(1)\n```\n' }))).toEqual({
      code: 'print(1)',
      language: 'python',
    })
    expect(readCodePaste(clipboard({ 'text/plain': '~~~\nplain\n~~~' }))).toEqual({
      code: 'plain',
      language: 'plaintext',
    })
  })

  it('takes a lone <pre> from a web page with its language', () => {
    const pasted = readCodePaste(
      clipboard({
        'text/plain': 'fn main() {}',
        'text/html':
          '<meta charset="utf-8"><div class="highlight highlight-source-rust"><pre><span>fn</span> main() {}</pre></div>',
      }),
    )
    expect(pasted).toEqual({ code: 'fn main() {}', language: 'rust' })
  })

  it('takes monospace pre-formatted HTML from an IDE, using the plain text', () => {
    const pasted = readCodePaste(
      clipboard({
        'text/plain': 'SELECT 1\n  FROM t',
        'text/html':
          '<meta charset="utf-8"><div style="color:#ddd;font-family:\'JetBrains Mono\',monospace;white-space:pre"><div><span>SELECT</span> 1</div><div>  FROM t</div></div>',
      }),
    )
    expect(pasted).toEqual({ code: 'SELECT 1\n  FROM t', language: 'plaintext' })
  })

  it('leaves prose, and prose mixed with code, to the editor', () => {
    expect(readCodePaste(clipboard({ 'text/plain': 'Just a sentence.' }))).toBeNull()
    expect(
      readCodePaste(
        clipboard({
          'text/plain': 'Intro\ncode',
          'text/html': '<p>Intro</p><pre class="language-js">code</pre>',
        }),
      ),
    ).toBeNull()
    expect(
      readCodePaste(clipboard({ 'text/plain': 'Bold', 'text/html': '<p><b>Bold</b></p>' })),
    ).toBeNull()
    expect(readCodePaste(null)).toBeNull()
  })
})

describe('attachCodePaste', () => {
  function setup({ isEmpty }) {
    const holder = document.createElement('div')
    const paragraph = document.createElement('div')
    paragraph.className = 'ce-paragraph'
    paragraph.contentEditable = 'true'
    holder.append(paragraph)
    document.body.append(holder)
    const editor = {
      blocks: {
        getCurrentBlockIndex: () => 2,
        getBlockByIndex: () => ({ isEmpty }),
        insert: vi.fn(),
      },
    }
    const detach = attachCodePaste({ editor, holder })
    return { holder, paragraph, editor, detach }
  }

  function paste(target, data) {
    const event = new Event('paste', { bubbles: true, cancelable: true })
    event.clipboardData = clipboard(data)
    target.dispatchEvent(event)
    return event
  }

  it('replaces an empty paragraph with the code block and stops Editor.js seeing the paste', () => {
    const { holder, paragraph, editor } = setup({ isEmpty: true })
    const editorHandler = vi.fn()
    paragraph.addEventListener('paste', editorHandler)

    const event = paste(paragraph, { 'text/plain': '```js\nx()\n```' })

    expect(event.defaultPrevented).toBe(true)
    expect(editorHandler).not.toHaveBeenCalled()
    expect(editor.blocks.insert).toHaveBeenCalledWith(
      'code',
      { code: 'x()', language: 'javascript' },
      undefined,
      2,
      true,
      true,
    )
    holder.remove()
  })

  it('inserts after a paragraph that has text, and ignores ordinary pastes', () => {
    const { holder, paragraph, editor, detach } = setup({ isEmpty: false })
    paste(paragraph, { 'text/plain': '```\nx\n```' })
    expect(editor.blocks.insert).toHaveBeenCalledWith(
      'code',
      { code: 'x', language: 'plaintext' },
      undefined,
      3,
      true,
      false,
    )

    const plain = paste(paragraph, { 'text/plain': 'hello' })
    expect(plain.defaultPrevented).toBe(false)

    detach()
    const after = paste(paragraph, { 'text/plain': '```\ny\n```' })
    expect(after.defaultPrevented).toBe(false)
    holder.remove()
  })
})
