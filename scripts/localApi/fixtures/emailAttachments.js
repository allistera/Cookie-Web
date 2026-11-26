// Fixture files for GET /messages/attachments (cookie-web-messages), in the
// shape that Worker returns. The floor plan is the attachment of fixture-1 in
// fixtures/messages.js, the one file /messages/attachment can download; the
// others exist only here.
import { fixtureNow } from './emails.js'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

const files = [
  {
    id: 'fixture-1-attachment-1',
    filename: 'Revised-Floor-Plan.pdf',
    contentType: 'application/pdf',
    sizeBytes: 245_760,
    direction: 'received',
    messageId: 'fixture-1',
    subject: 'Revised Floor Plan - Natural Light adjustments',
    correspondent: {
      name: 'City Construction',
      address: 'updates@cityconstruction.com',
      others: 0,
    },
    ageMs: 0.5 * HOUR,
    unread: true,
  },
  {
    id: 'fixture-attachment-contract',
    filename: 'Signed-Contract.pdf',
    contentType: 'application/pdf',
    sizeBytes: 412_300,
    direction: 'sent',
    messageId: 'fixture-attachment-message-contract',
    subject: 'Signed contract for the extension',
    correspondent: { name: 'Sam Carter', address: 'sam@cityconstruction.com', others: 2 },
    ageMs: 2 * DAY,
  },
  {
    id: 'fixture-attachment-logo',
    filename: 'image001.png',
    contentType: 'image/png',
    sizeBytes: 8_412,
    direction: 'received',
    embedded: true,
    messageId: 'fixture-attachment-message-budget',
    subject: 'Kitchen budget, second pass',
    correspondent: { name: 'Priya Nair', address: 'priya@nairdesign.example', others: 0 },
    ageMs: 3 * DAY,
  },
  {
    id: 'fixture-attachment-budget',
    filename: 'Kitchen-Budget.xlsx',
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    sizeBytes: 58_200,
    direction: 'received',
    messageId: 'fixture-attachment-message-budget',
    subject: 'Kitchen budget, second pass',
    correspondent: { name: 'Priya Nair', address: 'priya@nairdesign.example', others: 0 },
    ageMs: 3 * DAY,
  },
  {
    id: 'fixture-attachment-invite',
    filename: 'invite.ics',
    contentType: 'text/calendar',
    sizeBytes: 1_420,
    direction: 'received',
    messageId: 'fixture-attachment-message-invite',
    subject: 'Invitation: Site walkthrough',
    correspondent: { name: null, address: 'calendar@cityconstruction.com', others: 0 },
    ageMs: 40 * DAY,
  },
  {
    id: 'fixture-attachment-photo',
    filename: 'bay-window.jpg',
    contentType: 'image/jpeg',
    sizeBytes: 1_843_200,
    direction: 'sent',
    messageId: 'fixture-attachment-message-photo',
    subject: 'Photo of the bay window',
    correspondent: { name: 'Priya Nair', address: 'priya@nairdesign.example', others: 0 },
    ageMs: 41 * DAY,
  },
  {
    // Its bytes were never stored, so it is listed but cannot be downloaded.
    id: 'fixture-attachment-survey',
    filename: 'Site-Survey.pdf',
    contentType: 'application/pdf',
    sizeBytes: 3_302_400,
    direction: 'received',
    downloadable: false,
    messageId: 'fixture-attachment-message-survey',
    subject: null,
    correspondent: null,
    ageMs: 75 * DAY,
  },
]

// `direction` keeps one side ('received' or 'sent'); `embedded` also lists the
// pictures that belong to an email's body. The fixture never fills a page.
export function fixtureEmailAttachments({ direction = '', embedded = false } = {}) {
  const now = fixtureNow()
  return {
    attachments: files
      .filter((file) => !direction || file.direction === direction)
      .filter((file) => embedded || !file.embedded)
      .map(({ ageMs, ...file }) => ({
        downloadable: true,
        embedded: false,
        unread: false,
        starred: false,
        archived: false,
        ...file,
        date: new Date(now - ageMs).toISOString(),
      })),
    nextCursor: null,
  }
}
