export const dateKey = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

export function normalizeCalendarEvent(event) {
  return {
    ...event,
    allDay:
      event.allDay === true ||
      (String(event.start).startsWith('00:00') && Number(event.duration) >= 24 * 60),
  }
}
