import { expect, test } from './workerFixtures.js'
import { CALENDAR_API_URL } from '../src/lib/apiWorkers.js'

const calendarId = '11111111-1111-1111-1111-111111111111'
const feedId = '22222222-2222-2222-2222-222222222222'

async function calendarFixtures(page, { incomplete = false } = {}) {
  await page.clock.setFixedTime(new Date('2030-01-01T12:00:00Z'))
  await page.route(`${CALENDAR_API_URL}/calendars`, (route) =>
    route.fulfill({
      json: {
        calendars: [
          { id: calendarId, name: 'Work' },
          {
            id: feedId,
            name: 'Travel',
            subscriptionUrl: 'https://calendar.google.com/fixture.ics',
            subscriptionSyncedAt: '2020-01-01T00:00:00Z',
            subscriptionError: 'Old sync failed',
          },
        ],
      },
    }),
  )
  await page.route(`${CALENDAR_API_URL}/calendar-availability`, (route) => {
    const request = route.request().postDataJSON()
    expect(request).toMatchObject({
      calendarIds: [calendarId, feedId],
      interpretationTimeZone: 'UTC',
      confirmFloatingTimes: true,
      from: '2030-01-02',
      to: '2030-01-02',
    })
    return route.fulfill({
      json: {
        complete: !incomplete,
        busy: incomplete
          ? []
          : [{ start: Date.parse('2030-01-02T09:00Z'), end: Date.parse('2030-01-02T10:00Z') }],
        window: { start: Date.parse('2030-01-02T00:00Z'), end: Date.parse('2030-01-03T00:00Z') },
        checkedAt: '2030-01-01T12:00:00Z',
        sources: [
          { id: calendarId, complete: true },
          {
            id: feedId,
            complete: !incomplete,
            checkedAt: incomplete ? null : '2030-01-01T12:00:00Z',
          },
        ],
        error: incomplete ? 'Availability is incomplete. No times can be suggested.' : undefined,
      },
    })
  })
}

async function findTimes(page, surface) {
  await surface.getByRole('button', { name: 'Share availability' }).click()
  const dialog = page.getByRole('dialog', { name: 'Share availability' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('(stale)')
  await expect(dialog.getByRole('button', { name: 'Find available times' })).toBeDisabled()
  await dialog.getByLabel('From date', { exact: true }).fill('2030-01-02')
  await dialog.getByLabel('Through date', { exact: true }).fill('2030-01-02')
  await dialog
    .getByRole('combobox', { name: 'Proposal and working-hours timezone' })
    .selectOption('UTC')
  await dialog
    .getByRole('combobox', { name: 'Calendar interpretation timezone' })
    .selectOption('UTC')
  await dialog.getByLabel('I confirm this timezone', { exact: false }).check()
  await dialog.getByRole('button', { name: 'Find available times' }).click()
  return dialog
}

test('new mail reviews, edits and inserts proposed times while protecting the existing draft', async ({
  page,
}) => {
  await calendarFixtures(page)
  await page.goto('/')
  await page.locator('.compose-btn').click()
  const composer = page.locator('#composerToast')
  await composer.locator('.composer-editor').fill('Existing draft')
  const dialog = await findTimes(page, composer)
  await expect(dialog).toContainText('Selected range freshly checked')
  await expect(composer.locator('.composer-send-btn-split')).toBeDisabled()
  await expect(dialog.locator('.availability-slots label').first()).toContainText('10:00 GMT')
  await dialog.locator('.availability-slots input').first().check()
  await dialog.getByRole('button', { name: 'Review selected times' }).click()
  const text = dialog.getByLabel('Proposal text')
  await expect(text).toBeFocused()
  expect(await text.inputValue()).toContain('30 minutes each; timezone: UTC')
  await text.fill(`${await text.inputValue()}\n\nHappy to discuss <other times>.`)
  await dialog.getByRole('button', { name: 'Insert proposed times' }).click()
  await expect(dialog).toHaveCount(0)
  const editor = composer.locator('.composer-editor')
  await expect(editor).toContainText('Existing draft')
  await expect(editor).toContainText('proposals only, not reserved times')
  await expect(editor).toContainText('Happy to discuss <other times>.')
  await expect(editor).not.toContainText('Travel')
})

test('inline replies can insert the same reviewed proposal text', async ({ page }) => {
  await calendarFixtures(page)
  await page.goto('/inbox')
  // The fixed 2030 clock puts the mailbox fixture in its collapsed Earlier group.
  await page.getByRole('button', { name: /Earlier/ }).click()
  await page.locator('.ni-row', { hasText: 'City Construction' }).click()
  const reader = page.locator('.ni-reader')
  await reader.locator('.ni-reader-footer .ni-pill-btn', { hasText: 'Reply' }).click()
  const reply = reader.locator('.ni-reply-box')
  await reply.locator('.composer-editor').fill('Thanks for your message.')
  const dialog = await findTimes(page, reply)
  await dialog.locator('.availability-slots input').first().check()
  await dialog.getByRole('button', { name: 'Review selected times' }).click()
  await dialog.getByRole('button', { name: 'Insert proposed times' }).click()
  await expect(reply.locator('.composer-editor')).toContainText('Thanks for your message.')
  await expect(reply.locator('.composer-editor')).toContainText('Proposed meeting times')
  await expect(page.locator('#composerToast.active')).toHaveCount(0)
})

test('failed or incomplete checks cannot produce slots and Escape preserves the draft', async ({
  page,
}) => {
  await calendarFixtures(page, { incomplete: true })
  await page.goto('/')
  await page.locator('.compose-btn').click()
  const composer = page.locator('#composerToast')
  await composer.locator('.composer-editor').fill('Keep this draft')
  const dialog = await findTimes(page, composer)
  await expect(dialog.getByRole('alert')).toContainText('Availability is incomplete')
  await expect(dialog.getByRole('button', { name: 'Review selected times' })).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Find available times' }).press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(composer.getByRole('button', { name: 'Share availability' })).toBeFocused()
  await expect(composer.locator('.composer-editor')).toHaveText('Keep this draft')
})
