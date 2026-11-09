// Paper Trail lists receipts, confirmations and other transactional mail.
// Membership is the system label of this name, which the ingest classifier
// attaches (Cookie-Worker shared/paperTrailLabel.js), so the list is that
// label's folder and the mail stays in the inbox too.
export const PAPER_TRAIL_LABEL = 'Paper Trail'

export const PAPER_TRAIL_ROUTE = {
  path: '/inbox',
  query: { filter: 'label', label: PAPER_TRAIL_LABEL },
}
