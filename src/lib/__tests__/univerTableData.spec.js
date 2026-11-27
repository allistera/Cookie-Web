import { describe, expect, it } from 'vitest'

import { contentGridToWorkbookData, flattenWorkbookCellText } from '../univerTableData'

describe('contentGridToWorkbookData', () => {
  it('places plain and formula cells into sparse cellData by row/column', () => {
    const workbook = contentGridToWorkbookData([
      ['10', '5'],
      ['=A1+B1', ''],
    ])
    const cellData = workbook.sheets.sheet1.cellData
    expect(cellData[0][0]).toEqual({ v: '10' })
    expect(cellData[0][1]).toEqual({ v: '5' })
    expect(cellData[1][0]).toEqual({ f: '=A1+B1' })
    expect(cellData[1][1]).toBeUndefined()
  })

  it('strips HTML markup and entities from non-formula cells', () => {
    const workbook = contentGridToWorkbookData([['<b>Ada</b> &amp; Grace']])
    expect(workbook.sheets.sheet1.cellData[0][0]).toEqual({ v: 'Ada & Grace' })
  })

  // A cell that literally reads "&lt;b&gt;" is stored as "&amp;lt;b&amp;gt;";
  // decoding it twice would turn the text into markup-looking "<b>".
  it('decodes an escaped entity only once', () => {
    const workbook = contentGridToWorkbookData([['&amp;lt;b&amp;gt;']])
    expect(workbook.sheets.sheet1.cellData[0][0]).toEqual({ v: '&lt;b&gt;' })
  })

  it('pads row/column counts to a sensible minimum for a small or blank grid', () => {
    const blank = contentGridToWorkbookData(undefined)
    expect(blank.sheets.sheet1.rowCount).toBeGreaterThanOrEqual(8)
    expect(blank.sheets.sheet1.columnCount).toBeGreaterThanOrEqual(6)
    expect(blank.sheets.sheet1.cellData).toEqual({})

    const wide = contentGridToWorkbookData([Array.from({ length: 10 }, (_, i) => String(i))])
    expect(wide.sheets.sheet1.columnCount).toBe(10)
  })
})

describe('flattenWorkbookCellText', () => {
  it('reads cell values in row-major order across sheetOrder', () => {
    const workbook = {
      sheetOrder: ['sheet1'],
      sheets: {
        sheet1: {
          cellData: {
            0: { 0: { v: 'Name' }, 1: { v: 'Role' } },
            1: { 0: { v: 'Ada' }, 1: { v: 'Engineer' } },
          },
        },
      },
    }
    expect(flattenWorkbookCellText(workbook)).toEqual(['Name', 'Role', 'Ada', 'Engineer'])
  })

  it('skips empty cells and tolerates a missing workbook', () => {
    const workbook = {
      sheetOrder: ['sheet1'],
      sheets: { sheet1: { cellData: { 0: { 0: { v: '' }, 1: { v: 'Only this' } } } } },
    }
    expect(flattenWorkbookCellText(workbook)).toEqual(['Only this'])
    expect(flattenWorkbookCellText(null)).toEqual([])
  })
})
