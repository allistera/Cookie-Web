import { expect, test } from './workerFixtures.js'

// Sarah Miller's Block Party mail carries a calendar invitation to the
// fixture mailbox (scripts/localApi/fixtures/invitations.js).
const INVITATION_MAIL = '/inbox?open=fixture-7'
const INVITATION_ID = 'fixture-invitation-block-party'

// The calendar entries the answers below have left behind, read from the
// same fixture session the page uses.
async function invitationEntries(page) {
  const today = new Date()
  const key = (date) => date.toISOString().slice(0, 10)
  const from = key(new Date(today.getTime() - 24 * 60 * 60 * 1000))
  const to = key(new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000))
  const response = await page.request.get(
    `/__e2e__/calendar-api/calendar-events?from=${from}&to=${to}`,
  )
  const { events } = await response.json()
  return events.filter((event) => event.invitationId === INVITATION_ID)
}

test('an invitation is answered from the reader, and the calendar follows each answer', async ({
  page,
}) => {
  const replies = []
  page.on('request', (request) => {
    if (request.url().endsWith('/send/invitation-reply')) replies.push(request.postDataJSON())
  })

  await page.goto(INVITATION_MAIL)
  const card = page.getByRole('region', { name: 'Calendar invitation' })
  await expect(card).toContainText('Sarah Miller invited you')
  await expect(card).toContainText('Neighborhood Block Party')
  await expect(card).toContainText('Maple Street')
  const accept = card.getByRole('button', { name: 'Accept' })
  const maybe = card.getByRole('button', { name: 'Maybe' })
  const decline = card.getByRole('button', { name: 'Decline' })
  await expect(accept).toHaveAttribute('aria-pressed', 'false')
  // The invitation card stands in for the plain "Add to calendar" offer.
  await expect(page.getByRole('region', { name: 'Calendar suggestion' })).toHaveCount(0)
  // Reading the invitation tells the organiser nothing.
  expect(replies).toEqual([])
  expect(await invitationEntries(page)).toEqual([])

  await accept.click()
  await expect(accept).toHaveAttribute('aria-pressed', 'true')
  await expect(card).toContainText('You accepted. Sarah Miller was told on')
  expect(replies).toHaveLength(1)
  expect(replies[0]).toMatchObject({ invitationId: INVITATION_ID, response: 'accepted' })
  expect(replies[0].timeZone).toBeTruthy()
  expect(await invitationEntries(page)).toHaveLength(1)

  // The answer is the mailbox's, not this page's: it is still there on reload.
  await page.reload()
  await expect(accept).toHaveAttribute('aria-pressed', 'true')
  await expect(card).toContainText('You accepted.')

  // Changing the answer tells the organiser again and keeps the one entry.
  await maybe.click()
  await expect(maybe).toHaveAttribute('aria-pressed', 'true')
  await expect(accept).toHaveAttribute('aria-pressed', 'false')
  await expect(card).toContainText('You answered maybe.')
  expect(replies.map((reply) => reply.response)).toEqual(['accepted', 'tentative'])
  expect(await invitationEntries(page)).toHaveLength(1)

  // The entry opens from the card.
  await card.getByRole('button', { name: 'Go to event' }).click()
  await expect(page).toHaveURL(
    new RegExp(`/calendar\\?date=\\d{4}-\\d{2}-\\d{2}&event=stub-event-${INVITATION_ID}`),
  )
  const editDialog = page.getByRole('dialog', { name: 'Edit event' })
  await expect(editDialog.getByRole('textbox', { name: 'Event title' })).toHaveValue(
    'Neighborhood Block Party',
  )

  // Declining takes it off the calendar.
  await page.goto(INVITATION_MAIL)
  await decline.click()
  await expect(decline).toHaveAttribute('aria-pressed', 'true')
  await expect(card).toContainText('You declined.')
  await expect(card.getByRole('button', { name: 'Go to event' })).toHaveCount(0)
  expect(replies.map((reply) => reply.response)).toEqual(['accepted', 'tentative', 'declined'])
  expect(await invitationEntries(page)).toEqual([])
})

test('a reply the Worker could not send is reported, and the invitation stays unanswered', async ({
  page,
}) => {
  await page.route('**/send/invitation-reply', (route) =>
    route.fulfill({
      status: 503,
      json: {
        error: 'The reply is still being sent. Try again shortly.',
        code: 'DELIVERY_PENDING',
      },
    }),
  )

  await page.goto(INVITATION_MAIL)
  const card = page.getByRole('region', { name: 'Calendar invitation' })
  const accept = card.getByRole('button', { name: 'Accept' })
  await accept.click()

  await expect(card.getByRole('alert')).toHaveText(
    'The reply is still being sent. Try again shortly.',
  )
  await expect(accept).toHaveAttribute('aria-pressed', 'false')
  await expect(accept).toBeEnabled()
  expect(await invitationEntries(page)).toEqual([])
})
