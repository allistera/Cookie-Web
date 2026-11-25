// Fixture senders for GET /messages/subscriptions (cookie-web-messages), in
// the shape that Worker returns. Daily Bites is the newsletter in
// fixtures/emails.js (fixture-15); the others exist only here.
const DAY = 24 * 60 * 60 * 1000

// A sender that cannot be unsubscribed automatically: the unsubscribe action
// answers ai_failed with this page for the person to finish on.
export const FIXTURE_MANUAL_SUBSCRIPTION_ID = 'fixture-subscription-manual'
export const FIXTURE_MANUAL_UNSUBSCRIBE_URL = 'https://account.gadgetweekly.example/preferences'

const senders = [
  {
    address: 'newsletter@dailybites.example',
    name: 'Daily Bites',
    messageId: 'fixture-15',
    messageCount: 12,
    ageMs: 3 * DAY,
  },
  {
    address: 'deals@gadgetweekly.example',
    name: 'Gadget Weekly',
    messageId: FIXTURE_MANUAL_SUBSCRIPTION_ID,
    messageCount: 4,
    ageMs: 9 * DAY,
  },
  {
    address: 'updates@cityrunners.example',
    name: null,
    messageId: 'fixture-subscription-runners',
    messageCount: 1,
    ageMs: 40 * DAY,
  },
  {
    address: 'digest@oldforum.example',
    name: 'Old Forum Digest',
    messageId: 'fixture-subscription-forum',
    messageCount: 27,
    ageMs: 200 * DAY,
    unsubscribedAgeMs: 180 * DAY,
  },
]

// `unsubscribed` maps a sender address to when this session unsubscribed.
export function fixtureSubscriptions(unsubscribed = new Map(), now = Date.now()) {
  return senders.map(({ ageMs, unsubscribedAgeMs, ...sender }) => ({
    ...sender,
    lastReceivedAt: new Date(now - ageMs).toISOString(),
    unsubscribedAt:
      unsubscribed.get(sender.address) ??
      (unsubscribedAgeMs ? new Date(now - unsubscribedAgeMs).toISOString() : null),
  }))
}
