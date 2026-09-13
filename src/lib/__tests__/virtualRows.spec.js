import { expect, it } from 'vitest'
import { rowIndexAtOffset } from '../virtualRows'
it.each([1000, 10000])(
  'finds rows at boundaries and beyond the end of %i variable-height rows',
  (count) => {
    let top = 0
    const rows = Array.from({ length: count }, (_, i) => {
      const row = { top, height: 20 + (i % 3) }
      top += row.height
      return row
    })
    for (const offset of [0, 21, top / 2, top - 1, top, top + 100]) {
      const expected = rows.findIndex((row) => row.top + row.height > offset)
      expect(rowIndexAtOffset(rows, offset)).toBe(expected === -1 ? count : expected)
    }
  },
)
