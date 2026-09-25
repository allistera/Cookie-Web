import { describe, expect, it } from 'vitest'
import {
  convertBlocksToHTML,
  convertBlocksToMarkdown,
  prepareExportBlocks,
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
  it('exports a very large legacy table without overflowing the stack', () => {
    const content = Array.from({ length: 300000 }, () => ['x'])
    const markdown = convertBlocksToMarkdown([block('table', { content })])
    expect(markdown.startsWith('| x |\n| --- |\n')).toBe(true)
  })

  it('fences a code block with many backtick runs longer than its longest run', () => {
    const code = 'a``'.repeat(300000)
    const markdown = convertBlocksToMarkdown([block('code', { code })])
    expect(markdown.startsWith('```\n')).toBe(true)
  })
})
