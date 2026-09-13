import { afterEach, expect, it, vi } from 'vitest'
import { basicTableEditor, supportsBasicTable } from '../basicTableEditor'
afterEach(() => document.body.replaceChildren())
it('edits plain cells, grows the grid and promotes without losing data', () => {
  const save = vi.fn()
  const open = vi.fn()
  const root = basicTableEditor({ content: [['<b>Keep</b>', 'Text']] }, save, open)
  document.body.append(root)
  expect(root.querySelector('b')).toBeNull()
  const cell = root.querySelector('td')
  cell.textContent = '<script>plain text</script>'
  cell.dispatchEvent(new Event('input'))
  expect(save).toHaveBeenLastCalledWith({
    content: [['&lt;script&gt;plain text&lt;/script&gt;', 'Text']],
  })
  root.querySelectorAll('button')[0].click()
  expect(root.querySelectorAll('tr')).toHaveLength(2)
  root.querySelectorAll('button')[1].click()
  expect(root.querySelectorAll('td')).toHaveLength(6)
  root.querySelectorAll('button')[2].click()
  expect(open).toHaveBeenCalledWith(root)
})
it('keeps formulas and saved workbooks on the full spreadsheet path', () => {
  expect(supportsBasicTable({})).toBe(true)
  expect(supportsBasicTable({ content: [['Text']] })).toBe(true)
  expect(supportsBasicTable({ content: [['=1+1']] })).toBe(false)
  expect(supportsBasicTable({ workbook: {} })).toBe(false)
})
