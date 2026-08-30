// The local calendar date, as YYYY-MM-DD. en-CA formats in exactly that
// order, which avoids building the string out of a Date's UTC parts — at
// 23:30 in a zone behind UTC, toISOString() already says tomorrow.
const LOCAL_DATE = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function localToday() {
  return LOCAL_DATE.format(new Date())
}
