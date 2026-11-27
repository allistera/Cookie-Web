// The Feed lists the newsletters received today, whether or not they have
// been marked done. Membership is the Newsletters label, so the list is that
// label's folder (which spans Done) narrowed to today's mail.
const FEED_LABEL = 'Newsletters'

export const FEED_ROUTE = {
  path: '/inbox',
  query: { filter: 'label', label: FEED_LABEL, received: 'today' },
}

export function isFeedQuery(query) {
  return query.filter === 'label' && query.label === FEED_LABEL && query.received === 'today'
}

// Whether the email is dated on the viewer's current calendar day.
export function isFromToday(email, now = new Date()) {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  return Boolean(email) && new Date(email.sentAt).getTime() >= startOfToday
}
