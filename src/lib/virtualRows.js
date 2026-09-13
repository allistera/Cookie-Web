// Find the first row whose bottom lies beyond the offset in logarithmic time.
export function rowIndexAtOffset(rows, offset) {
  let low = 0
  let high = rows.length
  while (low < high) {
    const middle = (low + high) >>> 1
    const row = rows[middle]
    if (row.top + row.height <= offset) low = middle + 1
    else high = middle
  }
  return low
}
