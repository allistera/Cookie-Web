import Table from '@editorjs/table'

const CELL_SELECTOR = '.tc-cell'
const ROW_SELECTOR = '.tc-row'

class FormulaError extends Error {
  constructor(code) {
    super(code)
    this.code = code
  }
}

function asNumber(value) {
  if (Number.isFinite(value)) return value

  const text = String(value ?? '').trim()
  if (!text) return 0

  const number = Number(text.replaceAll(',', ''))
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

function calculateFormulaValue(formula, resolveReference) {
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
      return asNumber(resolveReference(token.value))
    }

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

function formatFormulaValue(value) {
  if (Object.is(value, -0)) return '0'
  if (Number.isInteger(value)) return String(value)
  return String(Number(value.toPrecision(12)))
}

export function evaluateTableFormula(formula, resolveReference) {
  try {
    return formatFormulaValue(calculateFormulaValue(formula, resolveReference))
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

function calculateCell(cell, matrix, visiting) {
  const formula = formulaForCell(cell)
  if (!formula) return asNumber(cell.textContent)
  if (visiting.has(cell)) throw new FormulaError('#CYCLE!')

  visiting.add(cell)
  try {
    return calculateFormulaValue(formula, (reference) => {
      const { row, column } = referenceCoordinates(reference)
      const referencedCell = matrix[row]?.[column]
      if (!referencedCell) throw new FormulaError('#REF!')
      return calculateCell(referencedCell, matrix, visiting)
    })
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
        result = formatFormulaValue(calculateCell(cell, matrix, new Set()))
      } catch (error) {
        result = error instanceof FormulaError ? error.code : '#ERROR!'
      }
      cell.textContent = result
      cell.title = `${formula} = ${result}`
      cell.setAttribute('aria-label', `${formula}, result ${result}`)
    }
  }
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

export function enhanceTableFormulas(tableElement, { readOnly = false } = {}) {
  for (const cell of tableElement.querySelectorAll(CELL_SELECTOR)) {
    const formula = cell.textContent.trim()
    if (formula.startsWith('=')) cell.dataset.formula = formula
  }
  updateFormulaCells(tableElement)

  if (readOnly) return () => {}

  let editingCell = null
  const onFocusIn = (event) => {
    const cell = event.target.closest?.(CELL_SELECTOR)
    if (!cell || !tableElement.contains(cell)) return
    editingCell = cell
    if (!cell.dataset.formula) return
    cell.textContent = cell.dataset.formula
    cell.classList.add('tc-cell--formula-editing')
    placeCaretAtEnd(cell)
  }
  const onInput = (event) => {
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

  tableElement.addEventListener('focusin', onFocusIn)
  tableElement.addEventListener('input', onInput)
  tableElement.addEventListener('focusout', onFocusOut)

  const observer = new MutationObserver((mutations) => {
    const structureChanged = mutations.some(
      (mutation) =>
        mutation.type === 'childList' &&
        (mutation.target === tableElement || mutation.target.classList?.contains('tc-row')),
    )
    if (structureChanged) updateFormulaCells(tableElement, editingCell)
  })
  observer.observe(tableElement, { childList: true, subtree: true })

  return () => {
    observer.disconnect()
    tableElement.removeEventListener('focusin', onFocusIn)
    tableElement.removeEventListener('input', onInput)
    tableElement.removeEventListener('focusout', onFocusOut)
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
    this.stopFormulaEnhancement = enhanceTableFormulas(this.formulaTableElement, {
      readOnly: this.readOnly,
    })

    if (!this.readOnly) {
      const help = document.createElement('div')
      help.className = 'formula-table-help'
      help.textContent = 'Maths: =A1+B1 · =A1-B1 · =A1*B1 · =A1/B1'
      container.appendChild(help)
    }

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
