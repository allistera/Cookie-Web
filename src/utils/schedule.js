const MORNING_HOUR = 8
const LATER_TODAY_HOURS = 3

function atMorning(date) {
  const result = new Date(date)
  result.setHours(MORNING_HOUR, 0, 0, 0)
  return result
}

export function tomorrowMorning(now = new Date()) {
  const result = atMorning(now)
  result.setDate(result.getDate() + 1)
  return result
}

const MINUTE_MS = 60 * 1000

// Returns null in the final minute of the day, when the 23:59 clamp would be
// in the past or no real time away.
export function laterToday(now = new Date()) {
  const result = new Date(now)
  result.setHours(result.getHours() + LATER_TODAY_HOURS, 0, 0, 0)
  if (result.getDate() !== now.getDate()) {
    result.setFullYear(now.getFullYear(), now.getMonth(), now.getDate())
    result.setHours(23, 59, 0, 0)
  }
  return result - now >= MINUTE_MS ? result : null
}

export function thisWeekendMorning(now = new Date()) {
  const result = atMorning(now)
  const daysUntilSaturday = (6 - result.getDay() + 7) % 7
  result.setDate(result.getDate() + daysUntilSaturday)

  // Keep the preset in the future when it is already Saturday morning.
  if (result <= now) result.setDate(result.getDate() + (result.getDay() === 6 ? 1 : 7))
  return result
}

export function nextWeekMorning(now = new Date()) {
  const result = atMorning(now)
  const daysUntilNextMonday = (8 - result.getDay()) % 7 || 7
  result.setDate(result.getDate() + daysUntilNextMonday)
  return result
}

// The presets are relative days, so near the weekend two of them name the same
// date: on a Sunday "Next Week" is the coming Monday, which is also
// "Tomorrow"; on a Friday, and on a Saturday past the morning slot, "This
// weekend" is "Tomorrow". Three days in seven offered the same day twice.
//
// Beyond looking odd, it let a follow-up reminder be set to the same instant
// as the scheduled send it was meant to follow, which the app then refuses
// with "Choose a reminder at least one minute after the scheduled send" — an
// error that reads like a bug when both options were picked from the menu.
//
// Duplicates are dropped rather than nudged to another day, because the label
// that survives is always the plainer name for that same date: on a Sunday
// "Tomorrow" already is next week's Monday, and on a Friday it already is the
// weekend. Nothing becomes unreachable.
export function scheduleChoices(now = new Date()) {
  const choices = [
    { id: 'later-today', label: 'Later today', date: laterToday(now) },
    { id: 'tomorrow', label: 'Tomorrow', date: tomorrowMorning(now) },
    { id: 'this-weekend', label: 'This weekend', date: thisWeekendMorning(now) },
    { id: 'next-week', label: 'Next Week', date: nextWeekMorning(now) },
  ]

  const days = new Set()
  return choices.filter(({ date }) => {
    if (!date) return false
    const day = date.toDateString()
    if (days.has(day)) return false
    days.add(day)
    return true
  })
}
