// Converts between the two shapes a document's `table` block has ever
// stored, plus flattening either shape to plain text for search indexing.
// No DOM, no Univer runtime import — safe to use from the browser tool
// (univerSheetTool.js), the server (api/_lib/documentText.js), and the
// one-time DB migration script (scripts/migrate-table-blocks-to-univer.js).
//
// Legacy shape (pre-Univer @editorjs/table tool, now removed):
//   { withHeadings, stretched, content: string[][] } — each cell is either
//   HTML (from a contentEditable cell) or a raw "=A1+B1" formula.
// Current shape: { workbook: IWorkbookData } — a full Univer snapshot from
// FWorkbook.save().

const DEFAULT_SHEET_ID = 'sheet1'
const MIN_ROWS = 8
const MIN_COLUMNS = 6
const DEFAULT_COLUMN_WIDTH = 93
const DEFAULT_ROW_HEIGHT = 27

// Local copy of documentText.js's identical helper: that file explains why a
// 6-line string utility isn't worth coupling two unrelated modules over, and
// the same reasoning applies here.
function stripHtml(html) {
  // &amp; is decoded last so an escaped entity like "&amp;lt;" stays "&lt;".
  return String(html ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim()
}

// A formula cell keeps its raw "=..." text in `f`; Univer recalculates `v`
// (the displayed result) itself once the sheet loads. Everything else is a
// plain value in `v`. Empty cells are omitted from cellData entirely, same
// as Univer's own sparse convention.
function cellDataFor(rawCell) {
  const text = stripHtml(rawCell)
  if (!text) return null
  return text.startsWith('=') ? { f: text } : { v: text }
}

// Builds a Univer IWorkbookData snapshot from a legacy content grid (or no
// grid at all, for a brand-new blank table insert).
export function contentGridToWorkbookData(content) {
  const rows = Array.isArray(content) ? content : []
  const rowCount = Math.max(rows.length, MIN_ROWS)
  const columnCount = Math.max(
    rows.reduce((max, row) => Math.max(max, row?.length ?? 0), 0),
    MIN_COLUMNS,
  )

  const cellData = {}
  rows.forEach((row, rowIndex) => {
    for (const [columnIndex, rawCell] of (row ?? []).entries()) {
      const cell = cellDataFor(rawCell)
      if (!cell) continue
      cellData[rowIndex] ??= {}
      cellData[rowIndex][columnIndex] = cell
    }
  })

  return {
    sheetOrder: [DEFAULT_SHEET_ID],
    name: '',
    locale: 'enGB',
    styles: {},
    sheets: {
      [DEFAULT_SHEET_ID]: {
        id: DEFAULT_SHEET_ID,
        name: 'Sheet1',
        tabColor: '',
        hidden: 0,
        rowCount,
        columnCount,
        zoomRatio: 1,
        freeze: { startRow: -1, startColumn: -1, ySplit: 0, xSplit: 0 },
        scrollTop: 0,
        scrollLeft: 0,
        defaultColumnWidth: DEFAULT_COLUMN_WIDTH,
        defaultRowHeight: DEFAULT_ROW_HEIGHT,
        mergeData: [],
        cellData,
        rowData: {},
        columnData: {},
        showGridlines: 1,
        rowHeader: { width: 46, hidden: 0 },
        columnHeader: { height: 20, hidden: 0 },
        rightToLeft: 0,
      },
    },
    resources: [],
  }
}

// Best-effort plain text out of a Univer snapshot's cell values, in reading
// order, for search indexing. Rich text cells (`p`) and anything else beyond
// a plain `v`/`f` are skipped rather than guessed at.
export function flattenWorkbookCellText(workbook) {
  const sheets = workbook?.sheets ?? {}
  const sheetIds = Array.isArray(workbook?.sheetOrder) ? workbook.sheetOrder : Object.keys(sheets)

  const lines = []
  for (const sheetId of sheetIds) {
    const cellData = sheets[sheetId]?.cellData ?? {}
    for (const row of Object.values(cellData)) {
      for (const cell of Object.values(row ?? {})) {
        const text = String(cell?.v ?? '').trim()
        if (text) lines.push(text)
      }
    }
  }
  return lines
}
