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
})
