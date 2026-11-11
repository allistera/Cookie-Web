// The free time between a day's timed items, so a view can say how long each
// break is. Items are `{ start, end }` in minutes. Items that overlap or touch
// make one busy stretch, and the time before the first item or after the last
// is not between anything, so neither is a gap.
export function gapsBetween(items) {
  const sorted = [...items].sort((a, b) => a.start - b.start)
  const gaps = []
  let busyUntil = null
  for (const { start, end } of sorted) {
    if (busyUntil !== null && start > busyUntil) gaps.push({ start: busyUntil, end: start })
    busyUntil = Math.max(busyUntil ?? end, end)
  }
  return gaps
}

// "2hrs", "1hr 30m".
export function gapLabel(minutes) {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  const whole = `${hours}hr${hours === 1 ? '' : 's'}`
  return rest ? `${whole} ${rest}m` : whole
}
