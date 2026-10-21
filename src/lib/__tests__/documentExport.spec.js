import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  convertBlocksToHTML,
  convertBlocksToMarkdown,
  prepareExportBlocks,
  downloadMarkdown,
  sanitizeFilename,
} from '../documentExport'

const block = (type, data) => ({ type, data })

describe('document export', () => {
  it('preserves nested list v2 items, numbering and checklist state', () => {
    const blocks = [
      block('list', {
        style: 'ordered',
        meta: { start: 3 },
        items: [{ content: 'Parent', items: [{ content: 'Child', items: [] }] }],
      }),
      block('list', {
        style: 'checklist',
        items: [
          { content: 'Finished', meta: { checked: true } },
          { content: 'Next', meta: { checked: false } },
        ],
      }),
    ]
    const markdown = convertBlocksToMarkdown(blocks)
    expect(markdown).toContain('3. Parent\n    1. Child')
    expect(markdown).toContain('- [x] Finished\n- [ ] Next')
    const html = convertBlocksToHTML(blocks)
    expect(html).toContain('<ol start="3"><li>Parent<ol start="1"><li>Child</li></ol></li></ol>')
    expect(html).toContain('☑ Finished')
    expect(html).not.toContain('[object Object]')
  })

  it('exports workbook sheets in saved order and keeps zero, false and rich text cells', () => {
    const blocks = [
      block('table', {
        workbook: {
          sheetOrder: ['b', 'a'],
          sheets: {
            a: {
              name: 'Second',
              cellData: {
                0: { 0: { v: 'Name' } },
                1: { 0: { p: { body: { dataStream: 'Rich text\r\n' } } } },
              },
            },
            b: {
              name: 'First',
              cellData: {
                0: { 0: { v: 'Count' }, 1: { v: 'Ready' } },
                1: { 0: { v: 0 }, 1: { v: false } },
              },
            },
          },
        },
      }),
    ]
    const markdown = convertBlocksToMarkdown(blocks)
    expect(markdown.indexOf('First')).toBeLessThan(markdown.indexOf('Second'))
    expect(markdown).toContain('| Count | Ready |\n| --- | --- |\n| 0 | false |')
    expect(markdown).toContain('Rich text')
    expect(convertBlocksToHTML(blocks)).toContain('<td>0</td><td>false</td>')
  })

  it('keeps legacy tables and lists readable', () => {
    const markdown = convertBlocksToMarkdown([
      block('table', {
        content: [
          ['A', 'B'],
          ['C|D', 'E'],
        ],
      }),
      block('list', { style: 'unordered', items: ['One', 'Two'] }),
    ])
    expect(markdown).toContain('| A | B |\n| --- | --- |')
    expect(markdown).toContain('C&#124;D')
    expect(markdown).toContain('- One\n- Two')
  })

  it('tags code blocks with their language and leaves plain text untagged', () => {
    const blocks = [
      block('code', { code: 'const a = 1', language: 'javascript' }),
      block('code', { code: '<b>plain</b>' }),
      block('code', { code: 'x', language: 'not-a-language' }),
    ]
    expect(convertBlocksToMarkdown(blocks)).toBe(
      '```javascript\nconst a = 1\n```\n\n```\n<b>plain</b>\n```\n\n```\nx\n```\n\n',
    )
    const html = convertBlocksToHTML(blocks)
    expect(html).toContain('<pre><code class="language-javascript">const a = 1</code></pre>')
    expect(html).toContain('<pre><code>&lt;b&gt;plain&lt;/b&gt;</code></pre>')
    expect(html).toContain('<pre><code>x</code></pre>')
  })

  it('exports Kanban content and escapes executable HTML', () => {
    const blocks = [
      block('kanban', {
        lanes: [
          {
            title: 'Doing',
            tasks: [{ title: 'Ship', description: '<img src=x onerror=alert(1)>' }],
          },
        ],
      }),
      block('paragraph', {
        text: '<b>Safe</b><script>alert(1)</script><a href="javascript:alert(1)">Link</a>',
      }),
    ]
    const html = convertBlocksToHTML(blocks, '<script>Title</script>')
    expect(html).toContain('<h3>Doing</h3>')
    expect(html).toContain('<strong>Ship</strong>')
    expect(html).toContain('&lt;img')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('href="javascript:')
    expect(html).toContain('<b>Safe</b>')
  })

  it('exports a table of contents that links to each heading', () => {
    const blocks = [
      block('toc', {}),
      block('header', { level: 2, text: 'Getting <b>started</b>' }),
      block('paragraph', { text: 'Body' }),
      block('header', { level: 3, text: 'Install & run' }),
      block('header', { level: 2, text: 'Getting started' }),
      block('header', { level: 2, text: '' }),
    ]

    const markdown = convertBlocksToMarkdown(blocks)
    expect(markdown).toContain(
      '- [Getting started](#getting-started)\n' +
        '  - [Install &amp; run](#install--run)\n' +
        '- [Getting started](#getting-started-1)\n',
    )

    const html = convertBlocksToHTML(blocks)
    expect(html).toContain('<nav aria-label="Table of contents">')
    expect(html).toContain('<a href="#getting-started">Getting started</a>')
    expect(html).toContain('<a href="#install--run">Install &amp; run</a>')
    expect(html).toContain('<h2 id="getting-started">Getting <b>started</b></h2>')
    expect(html).toContain('<h3 id="install--run">')
    expect(html).toContain('<h2 id="getting-started-1">')
  })

  it('exports nothing for a table of contents in a document without headings', () => {
    const blocks = [block('toc', {}), block('paragraph', { text: 'Only text' })]
    expect(convertBlocksToMarkdown(blocks)).toBe('Only text\n\n')
    expect(convertBlocksToHTML(blocks)).not.toContain('<nav')
  })

  it('embeds private document images so exports work outside the app', async () => {
    const privateUrl = 'https://abc.private.blob.vercel-storage.com/documents/u1/pic.png'
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const resolveImage = vi.fn(async () => 'https://signed/pic')

    const [prepared] = await prepareExportBlocks(
      [block('image', { file: { url: privateUrl }, caption: 'Pic' })],
      { resolveImage },
    )

    expect(resolveImage).toHaveBeenCalledWith(privateUrl)
    expect(fetchMock.mock.calls[0][0]).toBe('https://signed/pic')
    expect(prepared.data.file.url).toMatch(/^data:image\/png;base64,/)
    expect(prepared.data.caption).toBe('Pic')
    expect(convertBlocksToHTML([prepared])).toContain('src="data:image/png;base64,')
    vi.unstubAllGlobals()
  })

  it('omits an empty drawing and refuses unsupported content instead of silently losing it', async () => {
    expect(await prepareExportBlocks([block('excalidraw', { elements: [] })])).toEqual([])
    expect(() => convertBlocksToMarkdown([block('unknown', {})])).toThrow('cannot be exported')
    expect(() => convertBlocksToHTML([block('image', { url: 'javascript:alert(1)' })])).toThrow(
      'could not be exported',
    )
  })

  // Spreading a few hundred thousand values into Math.max overflows the stack;
  // a huge sheet should hit the friendly size error instead of a RangeError.
  it('rejects a very large sheet with the size error rather than crashing', () => {
    const cellData = {}
    for (let r = 0; r < 300000; r += 1) cellData[r] = { 0: { v: 'x' } }
    const blocks = [
      block('table', { workbook: { sheetOrder: ['s'], sheets: { s: { cellData } } } }),
    ]
    expect(() => convertBlocksToMarkdown(blocks)).toThrow('too large to export')
  })

  // A legacy table has no workbook and so no size cap before Markdown export.
  // Rendering 300k rows takes several seconds on CI runners, hence the timeout.
  it('exports a very large legacy table without overflowing the stack', () => {
    const content = Array.from({ length: 300000 }, () => ['x'])
    const markdown = convertBlocksToMarkdown([block('table', { content })])
    expect(markdown.startsWith('| x |\n| --- |\n')).toBe(true)
  }, 30_000)

  it('fences a code block with many backtick runs longer than its longest run', () => {
    const code = 'a``'.repeat(300000)
    const markdown = convertBlocksToMarkdown([block('code', { code })])
    expect(markdown.startsWith('```\n')).toBe(true)
  })
})

describe('document export boundaries', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it.each(['-1', '0.5', 'Infinity'])('rejects invalid spreadsheet row %s', (row) => {
    const blocks = [
      block('table', { workbook: { sheets: { s: { cellData: { [row]: { 0: { v: 'x' } } } } } } }),
    ]
    expect(() => convertBlocksToMarkdown(blocks)).toThrow('too large to export')
    expect(() => convertBlocksToHTML(blocks)).toThrow('too large to export')
  })

  it('rejects missing sheets rather than dropping their content', () => {
    const blocks = [block('table', { workbook: { sheetOrder: ['missing'] } })]
    expect(() => convertBlocksToMarkdown(blocks)).toThrow('sheet is missing')
  })

  it('exports empty sheets and formula-only cells', () => {
    const blocks = [
      block('table', {
        workbook: {
          sheets: {
            empty: { name: 'Empty' },
            formula: { cellData: { 0: null, 1: { 0: {}, 1: { f: '=A1+1' } } } },
          },
        },
      }),
    ]
    expect(convertBlocksToMarkdown(blocks)).toContain('### Empty\n\n')
    expect(convertBlocksToHTML(blocks)).toContain('<td>=A1+1</td>')
  })

  it('keeps public images and saved drawings without fetching them', async () => {
    const blocks = [
      block('image', { url: 'https://example.com/image.png' }),
      block('excalidraw', { file: { url: 'https://example.com/drawing.png' } }),
    ]
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await prepareExportBlocks(blocks)).toEqual(blocks)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(convertBlocksToMarkdown(blocks)).toContain('![](https://example.com/image.png)')
  })

  it('reports failed private image downloads', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    const blocks = [
      block('image', {
        file: { url: 'https://abc.private.blob.vercel-storage.com/documents/u1/pic.png' },
      }),
    ]
    await expect(
      prepareExportBlocks(blocks, { resolveImage: async () => 'https://signed/pic' }),
    ).rejects.toThrow('An image could not be exported.')
  })

  it('reports image reader failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['image']) }),
    )
    vi.stubGlobal(
      'FileReader',
      class {
        readAsDataURL() {
          this.onerror()
        }
      },
    )
    const blocks = [
      block('image', {
        file: { url: 'https://abc.private.blob.vercel-storage.com/documents/u1/pic.png' },
      }),
    ]
    await expect(
      prepareExportBlocks(blocks, { resolveImage: async () => 'https://signed/pic' }),
    ).rejects.toThrow('An image could not be exported.')
  })

  it('downloads Markdown with its requested filename and releases the URL', () => {
    const createObjectURL = vi.fn(() => 'blob:export')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    let downloaded
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
      downloaded = {
        name: this.download,
        href: this.getAttribute('href'),
        attached: document.body.contains(this),
      }
    })
    downloadMarkdown('# Title', 'notes')
    expect(downloaded).toEqual({ name: 'notes.md', href: 'blob:export', attached: true })
    expect(createObjectURL.mock.calls[0][0].type).toBe('text/markdown')
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:export')
    expect(document.querySelector('a[download="notes.md"]')).toBeNull()
  })

  it('sanitizes filenames and provides an empty-name fallback', () => {
    expect(sanitizeFilename('A / B:*?')).toBe('A-B')
    expect(sanitizeFilename('<>:*?')).toBe('document')
    expect(sanitizeFilename('a'.repeat(120))).toHaveLength(100)
  })
})
