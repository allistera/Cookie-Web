import { expect, test } from './workerFixtures.js'
import { CALENDAR_API_URL } from '../src/lib/apiWorkers.js'

test('pressing B on an open email makes the bucket, which keeps the email across a reload', async ({
  page,
}) => {
  await page.goto('/inbox')
  const bucketButton = page.getByRole('button', { name: /^Open bucket/ })
  await expect(bucketButton).toBeHidden()

  await page.locator('.ni-row', { hasText: 'City Construction' }).click()
  await expect(page.locator('.ni-reader-topbar')).toBeVisible()
  await page.keyboard.press('b')
  await expect(page.getByText('Pinned to the bucket.')).toBeVisible()
  await expect(bucketButton).toBeVisible()

  await bucketButton.click()
  const panel = page.getByRole('dialog', { name: 'Bucket' })
  await expect(panel).toBeVisible()
  await expect(panel).toContainText('1 item')
  await expect(panel).toContainText('Clears in 3 days')
  const item = panel.getByRole('link', { name: /Revised Floor Plan/ })
  await expect(item).toContainText('City Construction')

  // The title is already focused: typing names the bucket.
  await page.keyboard.type('Floor plan review')
  await expect(panel.getByRole('textbox', { name: 'Bucket name' })).toHaveValue('Floor plan review')
  await panel.getByRole('button', { name: 'Close bucket' }).click()
  await expect(panel).toBeHidden()

  // A reload keeps the bucket but closes the reader; the bucket's row opens
  // the email again.
  await page.reload()
  await expect(page.getByRole('button', { name: 'Open bucket: Floor plan review' })).toBeVisible()
  await page.getByRole('button', { name: 'Open bucket: Floor plan review' }).click()
  await panel.getByRole('link', { name: /Revised Floor Plan/ }).click()
  await expect(panel).toBeHidden()
  await expect(page).toHaveURL(/\/inbox\?open=/)
  await expect(page.locator('.ni-reader-topbar')).toBeVisible()

  // The same key on the same email takes it out again.
  await page.keyboard.press('b')
  await expect(page.getByText('Removed from the bucket.')).toBeVisible()
  await page.getByRole('button', { name: 'Open bucket: Floor plan review' }).click()
  await expect(panel).toContainText('0 items')

  // Done finishes with the bucket: it and its button go, and a reload does
  // not bring them back.
  await panel.getByRole('button', { name: 'Done' }).click()
  await expect(panel).toBeHidden()
  await expect(bucketButton).toBeHidden()
  await expect(page.getByText('Bucket cleared.')).toBeVisible()
  await page.reload()
  await expect(bucketButton).toBeHidden()
})

test('the event dialog has a pin button, and the bucket opens the event again', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date(2026, 9, 9, 10, 0))
  await page.route(`${CALENDAR_API_URL}/calendar-events?*`, (route) =>
    route.fulfill({
      json: {
        events: [
          {
            id: 'legal-sync',
            title: 'Acme legal sync',
            date: '2026-10-09',
            start: '14:00',
            duration: 30,
            calendar: 'work',
          },
        ],
      },
    }),
  )
  await page.goto('/calendar?date=2026-10-09&event=legal-sync')
  await expect(page.getByRole('textbox', { name: 'Event title', exact: true })).toHaveValue(
    'Acme legal sync',
  )
  await page.getByRole('button', { name: 'Pin to bucket' }).click()
  await expect(page.getByRole('button', { name: 'Unpin from bucket' })).toBeVisible()
  await page.getByRole('button', { name: 'Close', exact: true }).click()

  await page.getByRole('button', { name: /^Open bucket/ }).click()
  const panel = page.getByRole('dialog', { name: 'Bucket' })
  const item = panel.getByRole('link', { name: /Acme legal sync/ })
  await expect(item).toContainText('14:00-14:30')
  await item.click()
  await expect(page).toHaveURL(/\/calendar\?date=2026-10-09&event=legal-sync/)
  await expect(page.getByRole('textbox', { name: 'Event title', exact: true })).toHaveValue(
    'Acme legal sync',
  )
})
