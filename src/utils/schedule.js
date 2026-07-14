const MORNING_HOUR = 8

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

export function nextWeekMorning(now = new Date()) {
  const result = atMorning(now)
  const daysUntilNextMonday = ((8 - result.getDay()) % 7) || 7
  result.setDate(result.getDate() + daysUntilNextMonday)
  return result
}

export function scheduleChoices(now = new Date()) {
  return [
    { id: 'tomorrow', label: 'Tomorrow', date: tomorrowMorning(now) },
    { id: 'next-week', label: 'Next Week', date: nextWeekMorning(now) },
  ]
}
