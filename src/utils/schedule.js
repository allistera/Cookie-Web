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

export function laterToday(now = new Date()) {
  const result = new Date(now)
  result.setHours(result.getHours() + LATER_TODAY_HOURS, 0, 0, 0)
  if (result.getDate() !== now.getDate()) {
    result.setFullYear(now.getFullYear(), now.getMonth(), now.getDate())
    result.setHours(23, 59, 0, 0)
  }
  return result
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

export function scheduleChoices(now = new Date()) {
  return [
    { id: 'later-today', label: 'Later today', date: laterToday(now) },
    { id: 'tomorrow', label: 'Tomorrow', date: tomorrowMorning(now) },
    { id: 'this-weekend', label: 'This weekend', date: thisWeekendMorning(now) },
    { id: 'next-week', label: 'Next Week', date: nextWeekMorning(now) },
  ]
}
