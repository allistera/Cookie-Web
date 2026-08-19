import Table from '@editorjs/table'

const CELL_SELECTOR = '.tc-cell'
const ROW_SELECTOR = '.tc-row'
const CURRENCY_SYMBOL_PATTERN = /\p{Sc}/gu
const CURRENCY_NUMBER_FORMATTER = new Intl.NumberFormat('en-GB', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

class FormulaError extends Error {
  constructor(code) {
    super(code)
    this.code = code
  }
}

function asNumber(value, currencies = null) {
  if (Number.isFinite(value)) return value

  const text = String(value ?? '').trim()
  if (!text) return 0

  const currencySymbols = text.match(CURRENCY_SYMBOL_PATTERN) ?? []
  if (currencySymbols.length > 1) throw new FormulaError('#VALUE!')
  if (currencySymbols.length) {
    currencies?.add(currencySymbols[0])
    if (currencies?.size > 1) throw new FormulaError('#CURRENCY!')
  }

  const number = Number(
    text.replaceAll(',', '').replace(CURRENCY_SYMBOL_PATTERN, '').replaceAll(' ', ''),
  )
  if (!Number.isFinite(number)) throw new FormulaError('#VALUE!')
  return number
}

function tokenize(expression) {
  const tokens = []
  let remaining = expression

  while (remaining.length) {
    const whitespace = remaining.match(/^\s+/)
    if (whitespace) {
      remaining = remaining.slice(whitespace[0].length)
      continue
    }

    if (remaining.startsWith('#REF!')) {
      tokens.push({ type: 'error', value: '#REF!' })
      remaining = remaining.slice(5)
      continue
    }

    const number = remaining.match(/^(?:\d+(?:\.\d*)?|\.\d+)/)
    if (number) {
      tokens.push({ type: 'number', value: Number(number[0]) })
      remaining = remaining.slice(number[0].length)
      continue
    }

    const reference = remaining.match(/^[A-Za-z]+\d+/)
    if (reference) {
      tokens.push({ type: 'reference', value: reference[0].toUpperCase() })
      remaining = remaining.slice(reference[0].length)
      continue
    }

    const operator = remaining[0]
    if ('+-*/()'.includes(operator)) {
      tokens.push({ type: operator, value: operator })
      remaining = remaining.slice(1)
      continue
    }

    throw new FormulaError('#ERROR!')
  }

  return tokens
}

function calculateFormulaValue(formula, resolveReference, currencies = null) {
  if (!formula.trim().startsWith('=')) throw new FormulaError('#ERROR!')

  const tokens = tokenize(formula.trim().slice(1))
  let position = 0

  const peek = () => tokens[position]
  const consume = (type) => {
    if (peek()?.type !== type) throw new FormulaError('#ERROR!')
    return tokens[position++]
  }

  const parsePrimary = () => {
    const token = peek()
    if (!token) throw new FormulaError('#ERROR!')

    if (token.type === 'number') {
      position += 1
      return token.value
    }

    if (token.type === 'reference') {
      position += 1
      return asNumber(resolveReference(token.value), currencies)
    }

    if (token.type === 'error') throw new FormulaError(token.value)

    if (token.type === '(') {
      position += 1
      const value = parseExpression()
      consume(')')
      return value
    }

    throw new FormulaError('#ERROR!')
  }

  const parseUnary = () => {
    if (peek()?.type === '+') {
      position += 1
      return parseUnary()
    }
    if (peek()?.type === '-') {
      position += 1
      return -parseUnary()
    }
    return parsePrimary()
  }

  const parseTerm = () => {
    let value = parseUnary()
    while (peek()?.type === '*' || peek()?.type === '/') {
      const operator = tokens[position++].type
      const right = parseUnary()
      if (operator === '/' && right === 0) throw new FormulaError('#DIV/0!')
      value = operator === '*' ? value * right : value / right
    }
    return value
  }

  function parseExpression() {
    let value = parseTerm()
    while (peek()?.type === '+' || peek()?.type === '-') {
      const operator = tokens[position++].type
      const right = parseTerm()
      value = operator === '+' ? value + right : value - right
    }
    return value
  }

  const value = parseExpression()
  if (position !== tokens.length || !Number.isFinite(value)) throw new FormulaError('#ERROR!')
  return value
}

function formatFormulaValue(value, currencySymbol = '') {
  if (currencySymbol) {
    const normalizedValue = Object.is(value, -0) ? 0 : value
    const sign = normalizedValue < 0 ? '-' : ''
    return `${sign}${currencySymbol}${CURRENCY_NUMBER_FORMATTER.format(Math.abs(normalizedValue))}`
  }
  if (Object.is(value, -0)) return '0'
  if (Number.isInteger(value)) return String(value)
  return String(Number(value.toPrecision(12)))
}

export function evaluateTableFormula(formula, resolveReference) {
  try {
    const currencies = new Set()
    const value = calculateFormulaValue(formula, resolveReference, currencies)
    return formatFormulaValue(value, currencies.values().next().value)
  } catch (error) {
    return error instanceof FormulaError ? error.code : '#ERROR!'
  }
}

function cellMatrix(tableElement) {
  return [...tableElement.querySelectorAll(ROW_SELECTOR)].map((row) => [
    ...row.querySelectorAll(CELL_SELECTOR),
  ])
}

function formulaForCell(cell) {
  return (
    cell.dataset.formula || (cell.textContent.trim().startsWith('=') ? cell.textContent.trim() : '')
  )
}

function referenceCoordinates(reference) {
  const match = reference.match(/^([A-Z]+)(\d+)$/)
  if (!match) throw new FormulaError('#REF!')

  let column = 0
  for (const letter of match[1]) column = column * 26 + letter.charCodeAt(0) - 64
  return { row: Number(match[2]) - 1, column: column - 1 }
}

export function adjustTableFormulaReferences(formula, rowOffset, columnOffset) {
  return formula.replace(/\b([A-Za-z]+)(\d+)\b/g, (reference) => {
    const { row, column } = referenceCoordinates(reference.toUpperCase())
    const nextRow = row + rowOffset
    const nextColumn = column + columnOffset
    if (nextRow < 0 || nextColumn < 0) return '#REF!'
    return `${columnName(nextColumn)}${nextRow + 1}`
  })
}

function calculateCell(cell, matrix, visiting, currencies) {
  const formula = formulaForCell(cell)
  if (!formula) return asNumber(cell.textContent, currencies)
  if (visiting.has(cell)) throw new FormulaError('#CYCLE!')

  visiting.add(cell)
  try {
    return calculateFormulaValue(
      formula,
      (reference) => {
        const { row, column } = referenceCoordinates(reference)
        const referencedCell = matrix[row]?.[column]
        if (!referencedCell) throw new FormulaError('#REF!')
        return calculateCell(referencedCell, matrix, visiting, currencies)
      },
      currencies,
    )
  } finally {
    visiting.delete(cell)
  }
}

function updateFormulaCells(tableElement, editingCell = null) {
  const matrix = cellMatrix(tableElement)

  for (const row of matrix) {
    for (const cell of row) {
      const formula = formulaForCell(cell)
      if (!formula) continue

      cell.dataset.formula = formula
      cell.classList.add('tc-cell--formula')
      if (cell === editingCell) continue

      let result
      try {
        const currencies = new Set()
        const value = calculateCell(cell, matrix, new Set(), currencies)
        result = formatFormulaValue(value, currencies.values().next().value)
      } catch (error) {
        result = error instanceof FormulaError ? error.code : '#ERROR!'
      }
      cell.textContent = result
      cell.title = `${formula} = ${result}`
      cell.setAttribute('aria-label', `${formula}, result ${result}`)
    }
  }
}

function tableCellCoordinates(matrix, cell) {
  const row = matrix.findIndex((cells) => cells.includes(cell))
  if (row === -1) return null
  return { row, column: matrix[row].indexOf(cell) }
}

function cellsInTableRange(matrix, sourceCell, targetCell) {
  const source = tableCellCoordinates(matrix, sourceCell)
  const target = tableCellCoordinates(matrix, targetCell)
  if (!source || !target) return []

  const cells = []
  const firstRow = Math.min(source.row, target.row)
  const lastRow = Math.max(source.row, target.row)
  const firstColumn = Math.min(source.column, target.column)
  const lastColumn = Math.max(source.column, target.column)
  for (let row = firstRow; row <= lastRow; row += 1) {
    for (let column = firstColumn; column <= lastColumn; column += 1) {
      const cell = matrix[row]?.[column]
      if (cell) cells.push(cell)
    }
  }
  return cells
}

export function fillTableCells(tableElement, sourceCell, targetCell, editingCell = null) {
  const matrix = cellMatrix(tableElement)
  const source = tableCellCoordinates(matrix, sourceCell)
  if (!source || !tableCellCoordinates(matrix, targetCell)) return []

  const sourceFormula = formulaForCell(sourceCell)
  const sourceContent = sourceCell.innerHTML
  const destinationCells = cellsInTableRange(matrix, sourceCell, targetCell).filter(
    (cell) => cell !== sourceCell,
  )

  for (const cell of destinationCells) {
    const destination = tableCellCoordinates(matrix, cell)
    if (sourceFormula) {
      cell.textContent = adjustTableFormulaReferences(
        sourceFormula,
        destination.row - source.row,
        destination.column - source.column,
      )
    } else {
      cell.innerHTML = sourceContent
    }
    syncEditedFormula(cell)
  }

  updateFormulaCells(tableElement, editingCell)
  return destinationCells
}

function syncEditedFormula(cell) {
  const formula = cell.textContent.trim()
  if (formula.startsWith('=')) {
    cell.dataset.formula = formula
    cell.classList.add('tc-cell--formula')
    return
  }

  delete cell.dataset.formula
  cell.classList.remove('tc-cell--formula', 'tc-cell--formula-editing')
  cell.removeAttribute('title')
  cell.removeAttribute('aria-label')
}

function placeCaretAtEnd(cell) {
  const selection = window.getSelection?.()
  if (!selection) return
  const range = document.createRange()
  range.selectNodeContents(cell)
  range.collapse(false)
  selection.removeAllRanges()
  selection.addRange(range)
}

function columnName(index) {
  let name = ''
  for (let column = index + 1; column > 0; column = Math.floor((column - 1) / 26)) {
    name = String.fromCharCode(((column - 1) % 26) + 65) + name
  }
  return name
}

export function tableCellReference(tableElement, cell) {
  const rows = [...tableElement.querySelectorAll(ROW_SELECTOR)]
  const row = rows.findIndex((candidate) => candidate.contains(cell))
  if (row === -1) return ''

  const column = [...rows[row].querySelectorAll(CELL_SELECTOR)].indexOf(cell)
  return column === -1 ? '' : `${columnName(column)}${row + 1}`
}

export function enhanceTableFormulas(
  tableElement,
  { readOnly = false, onActiveCellChange = () => {} } = {},
) {
  for (const cell of tableElement.querySelectorAll(CELL_SELECTOR)) {
    const formula = cell.textContent.trim()
    if (formula.startsWith('=')) cell.dataset.formula = formula
  }
  updateFormulaCells(tableElement)

  if (readOnly) return () => {}

  const fillHandleContainer = tableElement.closest('.tc-wrap')
  const fillHandle = fillHandleContainer ? document.createElement('button') : null
  if (fillHandle) {
    fillHandle.type = 'button'
    fillHandle.className = 'formula-table-fill-handle'
    fillHandle.setAttribute('aria-label', 'Drag to fill cells')
    fillHandle.contentEditable = 'false'
    fillHandle.hidden = true
    fillHandleContainer.appendChild(fillHandle)
  }

  let activeCell = null
  let editingCell = null
  let fillSource = null
  let fillTarget = null
  let previewCells = []
  let isFilling = false

  const positionFillHandle = () => {
    if (!fillHandle || !fillHandleContainer) return
    if (!activeCell || !tableElement.contains(activeCell)) {
      fillHandle.hidden = true
      return
    }

    const containerBounds = fillHandleContainer.getBoundingClientRect()
    const cellBounds = activeCell.getBoundingClientRect()
    fillHandle.style.left = `${cellBounds.right - containerBounds.left}px`
    fillHandle.style.top = `${cellBounds.bottom - containerBounds.top}px`
    fillHandle.hidden = false
  }
  const setActiveCell = (cell) => {
    activeCell?.classList.remove('tc-cell--active')
    activeCell = cell
    activeCell?.classList.add('tc-cell--active')
    onActiveCellChange(cell ? tableCellReference(tableElement, cell) : '')
    positionFillHandle()
  }
  const clearFillPreview = () => {
    for (const cell of previewCells) cell.classList.remove('tc-cell--fill-preview')
    previewCells = []
  }
  const showFillPreview = (targetCell) => {
    clearFillPreview()
    previewCells = cellsInTableRange(cellMatrix(tableElement), fillSource, targetCell).filter(
      (cell) => cell !== fillSource,
    )
    for (const cell of previewCells) cell.classList.add('tc-cell--fill-preview')
  }
  const stopFillDrag = () => {
    clearFillPreview()
    fillHandle?.classList.remove('formula-table-fill-handle--dragging')
    window.removeEventListener('pointermove', onFillPointerMove)
    window.removeEventListener('pointerup', onFillPointerUp)
    window.removeEventListener('pointercancel', onFillPointerCancel)
  }
  const onFillPointerMove = (event) => {
    event.preventDefault()
    const cell =
      event.target.closest?.(CELL_SELECTOR) ??
      document.elementFromPoint(event.clientX, event.clientY)?.closest?.(CELL_SELECTOR)
    if (!cell || !tableElement.contains(cell)) return
    fillTarget = cell
    showFillPreview(cell)
  }
  const onFillPointerUp = (event) => {
    event.preventDefault()
    const sourceCell = fillSource
    const targetCell = fillTarget
    fillSource = null
    fillTarget = null
    stopFillDrag()
    if (!sourceCell || !targetCell || sourceCell === targetCell) return

    isFilling = true
    const filledCells = fillTableCells(
      tableElement,
      sourceCell,
      targetCell,
      editingCell === sourceCell ? sourceCell : null,
    )
    for (const cell of filledCells) cell.dispatchEvent(new Event('input', { bubbles: true }))
    isFilling = false
    targetCell.focus({ preventScroll: true })
  }
  const onFillPointerCancel = () => {
    fillSource = null
    fillTarget = null
    stopFillDrag()
  }
  const onFillPointerDown = (event) => {
    if (!activeCell || !fillHandle) return
    event.preventDefault()
    event.stopPropagation()
    fillSource = activeCell
    fillTarget = activeCell
    fillHandle.classList.add('formula-table-fill-handle--dragging')
    window.addEventListener('pointermove', onFillPointerMove)
    window.addEventListener('pointerup', onFillPointerUp)
    window.addEventListener('pointercancel', onFillPointerCancel)
  }

  const onFocusIn = (event) => {
    const cell = event.target.closest?.(CELL_SELECTOR)
    if (!cell || !tableElement.contains(cell)) return
    setActiveCell(cell)
    editingCell = cell
    if (!cell.dataset.formula) return
    cell.textContent = cell.dataset.formula
    cell.classList.add('tc-cell--formula-editing')
    placeCaretAtEnd(cell)
  }
  const onInput = (event) => {
    if (isFilling) return
    const cell = event.target.closest?.(CELL_SELECTOR)
    if (!cell || !tableElement.contains(cell)) return
    syncEditedFormula(cell)
    updateFormulaCells(tableElement, cell === editingCell ? cell : null)
  }
  const onFocusOut = (event) => {
    const cell = event.target.closest?.(CELL_SELECTOR)
    if (!cell || !tableElement.contains(cell)) return
    syncEditedFormula(cell)
    cell.classList.remove('tc-cell--formula-editing')
    if (editingCell === cell) editingCell = null
    updateFormulaCells(tableElement)
  }

  fillHandle?.addEventListener('pointerdown', onFillPointerDown)
  tableElement.addEventListener('focusin', onFocusIn)
  tableElement.addEventListener('input', onInput)
  tableElement.addEventListener('focusout', onFocusOut)
  window.addEventListener('resize', positionFillHandle)
  window.addEventListener('scroll', positionFillHandle, true)

  const observer = new MutationObserver((mutations) => {
    const structureChanged = mutations.some(
      (mutation) =>
        mutation.type === 'childList' &&
        (mutation.target === tableElement || mutation.target.classList?.contains('tc-row')),
    )
    if (structureChanged) {
      updateFormulaCells(tableElement, editingCell)
      if (activeCell && tableElement.contains(activeCell)) {
        onActiveCellChange(tableCellReference(tableElement, activeCell))
        positionFillHandle()
      } else if (activeCell) {
        setActiveCell(null)
      }
    }
  })
  observer.observe(tableElement, { childList: true, subtree: true })

  return () => {
    observer.disconnect()
    stopFillDrag()
    activeCell?.classList.remove('tc-cell--active')
    fillHandle?.removeEventListener('pointerdown', onFillPointerDown)
    fillHandle?.remove()
    tableElement.removeEventListener('focusin', onFocusIn)
    tableElement.removeEventListener('input', onInput)
    tableElement.removeEventListener('focusout', onFocusOut)
    window.removeEventListener('resize', positionFillHandle)
    window.removeEventListener('scroll', positionFillHandle, true)
  }
}

export function serializeFormulaTable(tableElement) {
  const content = []
  for (const row of tableElement.querySelectorAll(ROW_SELECTOR)) {
    const cells = [...row.querySelectorAll(CELL_SELECTOR)]
    if (cells.every((cell) => !formulaForCell(cell) && !cell.textContent.trim())) continue
    content.push(cells.map((cell) => formulaForCell(cell) || cell.innerHTML))
  }
  return content
}

export class FormulaTableTool extends Table {
  render() {
    this.stopFormulaEnhancement?.()
    const container = super.render()
    this.formulaTableElement = container.querySelector('.tc-table')

    if (!this.readOnly) {
      const footer = document.createElement('div')
      footer.className = 'formula-table-footer'

      const help = document.createElement('div')
      help.className = 'formula-table-help'
      help.textContent = 'Maths: =A1+B1 · =A1-B1 · =A1*B1 · =A1/B1'

      this.activeCellElement = document.createElement('output')
      this.activeCellElement.className = 'formula-table-cell-reference'
      this.activeCellElement.setAttribute('aria-label', 'Current table cell')
      this.activeCellElement.hidden = true

      footer.append(help, this.activeCellElement)
      container.appendChild(footer)
    }

    this.stopFormulaEnhancement = enhanceTableFormulas(this.formulaTableElement, {
      readOnly: this.readOnly,
      onActiveCellChange: (reference) => {
        if (!this.activeCellElement) return
        this.activeCellElement.value = reference
        this.activeCellElement.hidden = !reference
      },
    })

    return container
  }

  save() {
    return {
      withHeadings: this.data.withHeadings,
      stretched: this.data.stretched,
      content: serializeFormulaTable(this.formulaTableElement),
    }
  }

  destroy() {
    this.stopFormulaEnhancement?.()
    super.destroy()
  }
}
