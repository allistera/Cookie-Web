import { afterEach, describe, expect, it } from 'vitest'

import {
  enhanceTableFormulas,
  evaluateTableFormula,
  serializeFormulaTable,
  tableCellReference,
} from '../formulaTableTool'

function createTable(rows) {
  const table = document.createElement('div')
  table.className = 'tc-table'
  for (const values of rows) {
    const row = document.createElement('div')
    row.className = 'tc-row'
    for (const value of values) {
      const cell = document.createElement('div')
      cell.className = 'tc-cell'
      cell.contentEditable = 'true'
      cell.textContent = value
      row.appendChild(cell)
    }
    table.appendChild(row)
  }
  document.body.appendChild(table)
  return table
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('table maths formulas', () => {
  it.each([
    ['=A1+B1', '15'],
    ['=A1-B1', '5'],
    ['=A1*B1', '50'],
    ['=A1/B1', '2'],
    ['=(A1+B1)*2', '30'],
    ['=-A1+B1', '-5'],
  ])('calculates %s', (formula, expected) => {
    const values = { A1: 10, B1: 5 }
    expect(evaluateTableFormula(formula, (reference) => values[reference])).toBe(expected)
  })

  it('returns useful errors without executing arbitrary text', () => {
    expect(evaluateTableFormula('=A1/0', () => 10)).toBe('#DIV/0!')
    expect(evaluateTableFormula('=unknown()', () => 10)).toBe('#ERROR!')
  })

  it('shows results, reveals formulas for editing, and recalculates dependent cells', () => {
    const table = createTable([
      ['10', '5'],
      ['=A1+B1', '=A2/B1'],
    ])
    const stop = enhanceTableFormulas(table)
    const cells = table.querySelectorAll('.tc-cell')

    expect(cells[2].textContent).toBe('15')
    expect(cells[3].textContent).toBe('3')
    expect(cells[2].dataset.formula).toBe('=A1+B1')

    cells[2].dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    expect(cells[2].textContent).toBe('=A1+B1')

    cells[0].textContent = '20'
    cells[0].dispatchEvent(new InputEvent('input', { bubbles: true }))
    expect(cells[3].textContent).toBe('5')

    cells[2].dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    expect(cells[2].textContent).toBe('25')
    stop()
  })

  it('reports the focused cell using spreadsheet coordinates', () => {
    const table = createTable([
      ['Name', 'Amount'],
      ['Tea', '4'],
    ])
    const activeCells = []
    const stop = enhanceTableFormulas(table, {
      onActiveCellChange: (reference) => activeCells.push(reference),
    })
    const cells = table.querySelectorAll('.tc-cell')

    cells[0].dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    cells[2].dispatchEvent(new FocusEvent('focusin', { bubbles: true }))

    expect(activeCells).toEqual(['A1', 'A2'])
    expect(tableCellReference(table, cells[3])).toBe('B2')
    stop()
  })

  it('preserves formulas when serializing displayed results', () => {
    const table = createTable([
      ['1,200', '4'],
      ['=A1/B1', '=B2'],
    ])
    const stop = enhanceTableFormulas(table)

    expect(table.querySelectorAll('.tc-cell')[2].textContent).toBe('300')
    expect(table.querySelectorAll('.tc-cell')[3].textContent).toBe('#CYCLE!')
    expect(serializeFormulaTable(table)).toEqual([
      ['1,200', '4'],
      ['=A1/B1', '=B2'],
    ])
    stop()
  })
})
