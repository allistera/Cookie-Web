// "Someday" is a due date of its own: the task is put off with no day in
// mind. It is stored as the last calendar date the tasks API accepts, so it
// sorts after every real date and never reads as due, overdue or upcoming,
// and nothing but the places that name a date needs to know about it.
//
// Kept apart from taskSchedule.js so the startup bundle, which names dates
// in the bucket, does not carry the schedule picker's helpers.
export const SOMEDAY = '9999-12-31'

export function isSomeday(iso) {
  return iso === SOMEDAY
}
