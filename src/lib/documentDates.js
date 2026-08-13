// Date text for the document editor's "/" Date block: "Monday - 4th September".

export function ordinalDay(day) {
  if (day % 100 >= 11 && day % 100 <= 13) return `${day}th`
  return `${day}${['th', 'st', 'nd', 'rd'][day % 10] ?? 'th'}`
}

export function formatInsertedDate(date = new Date()) {
  const weekday = date.toLocaleDateString('en-GB', { weekday: 'long' })
  const month = date.toLocaleDateString('en-GB', { month: 'long' })
  return `${weekday} - ${ordinalDay(date.getDate())} ${month}`
}

// Daily note title, e.g. "13-08-26".
export function formatDailyNoteTitle(date = new Date()) {
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = String(date.getFullYear() % 100).padStart(2, '0')
  return `${day}-${month}-${year}`
}
