import { afterEach, describe, expect, it } from 'vitest'

import {
  adjustTableFormulaReferences,
  enhanceTableFormulas,
  evaluateTableFormula,
  fillTableCells,
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

  it.each([
    ['=A1+B1', { A1: '£10.50', B1: '£4.25' }, '£14.75'],
    ['=A1-B1', { A1: '$10.50', B1: '$4.25' }, '$6.25'],
    ['=A1*B1', { A1: '€10.50', B1: '2' }, '€21.00'],
    ['=A1/B1', { A1: '£10.50', B1: '2' }, '£5.25'],
    ['=A1+B1', { A1: '£1,200.50', B1: '£4.25' }, '£1,204.75'],
  ])('calculates currency formula %s', (formula, values, expected) => {
    expect(evaluateTableFormula(formula, (reference) => values[reference])).toBe(expected)
  })

  it('does not combine different currencies', () => {
    const values = { A1: '£10', B1: '$5' }
    expect(evaluateTableFormula('=A1+B1', (reference) => values[reference])).toBe('#CURRENCY!')
  })

  it.each([
    ['=A1+B1', 1, 0, '=A2+B2'],
    ['=A1+B1', 0, 1, '=B1+C1'],
    ['=Z1*2', 0, 1, '=AA1*2'],
    ['=A1', -1, 0, '=#REF!'],
  ])('adjusts copied formula references in %s', (formula, rowOffset, columnOffset, expected) => {
    expect(adjustTableFormulaReferences(formula, rowOffset, columnOffset)).toBe(expected)
  })

  it('preserves an invalid shifted reference as a spreadsheet error', () => {
    expect(evaluateTableFormula('=#REF!', () => 0)).toBe('#REF!')
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

  it('recalculates and serializes formulas that reference currency cells', () => {
    const table = createTable([
      ['£10.50', '£4.25'],
      ['=A1+B1', '=A1/2'],
    ])
    const stop = enhanceTableFormulas(table)
    const cells = table.querySelectorAll('.tc-cell')

    expect(cells[2].textContent).toBe('£14.75')
    expect(cells[3].textContent).toBe('£5.25')

    cells[0].textContent = '£20.00'
    cells[0].dispatchEvent(new InputEvent('input', { bubbles: true }))

    expect(cells[2].textContent).toBe('£24.25')
    expect(cells[3].textContent).toBe('£10.00')
    expect(serializeFormulaTable(table)).toEqual([
      ['£20.00', '£4.25'],
      ['=A1+B1', '=A1/2'],
    ])
    stop()
  })

  it('fills a range and adjusts formulas for each destination cell', () => {
    const table = createTable([
      ['£10.50', '£4.25', '=A1+B1'],
      ['£20.00', '£5.00', ''],
    ])
    const stop = enhanceTableFormulas(table)
    const cells = table.querySelectorAll('.tc-cell')

    const filledCells = fillTableCells(table, cells[2], cells[5])

    expect(filledCells).toEqual([cells[5]])
    expect(cells[5].dataset.formula).toBe('=A2+B2')
    expect(cells[5].textContent).toBe('£25.00')
    expect(serializeFormulaTable(table)).toEqual([
      ['£10.50', '£4.25', '=A1+B1'],
      ['£20.00', '£5.00', '=A2+B2'],
    ])
    stop()
  })

  it('copies plain cell content across the selected rectangle', () => {
    const table = createTable([
      ['Tea', ''],
      ['', ''],
    ])
    const stop = enhanceTableFormulas(table)
    const cells = table.querySelectorAll('.tc-cell')

    const filledCells = fillTableCells(table, cells[0], cells[3])

    expect(filledCells).toEqual([cells[1], cells[2], cells[3]])
    expect([...cells].map((cell) => cell.textContent)).toEqual(['Tea', 'Tea', 'Tea', 'Tea'])
    stop()
  })
})
