import { expect, test } from './workerFixtures.js'
import { EMAILS_API_URL } from '../src/lib/apiWorkers.js'

test('reviewed out-of-office dates persist and End now removes the active banner', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2026-10-25T12:00:00Z'))
  await page.goto('/settings/out-of-office')
  const settings = page.getByTestId('out-of-office-settings')
  await expect(settings.getByText('Current status:', { exact: false })).toContainText('disabled')
  await expect(
    settings.getByRole('checkbox', { name: 'Enable automatic replies' }),
  ).not.toBeChecked()
  await settings.getByLabel('Start date', { exact: true }).fill('2026-10-25')
  await settings.getByLabel('End date (inclusive)').fill('2026-10-25')
  await settings.getByLabel('Timezone', { exact: true }).fill('Europe/London')
  await settings.getByLabel('Reply subject').fill('Out until tomorrow')
  await settings
    .getByLabel('Reply message')
    .fill('Thanks for your message. I will reply tomorrow. <b>Literal text</b>')
  await expect(settings.getByLabel('Automatic reply preview')).toContainText('<b>Literal text</b>')
  await settings.getByRole('checkbox', { name: 'Enable automatic replies' }).check()
  await settings.getByRole('button', { name: 'Save out of office' }).click()
  await expect(settings.getByText('Out-of-office settings saved.')).toBeVisible()
  await expect(settings.getByText('Current status:', { exact: false })).toContainText('active')
  await page.reload()
  await expect(settings.getByLabel('Reply message')).toHaveValue(
    'Thanks for your message. I will reply tomorrow. <b>Literal text</b>',
  )
  await expect(settings.getByLabel('Timezone', { exact: true })).toHaveValue('Europe/London')
  await page.goto('/inbox')
  const banner = page.getByRole('complementary', { name: 'Out-of-office status' })
  await expect(banner).toContainText('active through 2026-10-25 (Europe/London)')
  await banner.getByRole('button', { name: 'End now' }).click()
  await expect(banner).toBeHidden()
  await page.reload()
  await expect(banner).toBeHidden()
  await page.goto('/settings/out-of-office')
  await expect(
    settings.getByRole('checkbox', { name: 'Enable automatic replies' }),
  ).not.toBeChecked()
})

test('out-of-office save conflict retains the draft until explicit reload', async ({ page }) => {
  await page.goto('/settings/out-of-office')
  const settings = page.getByTestId('out-of-office-settings')
  await expect(settings.getByLabel('Reply message')).toBeEnabled()
  await settings.getByLabel('Reply message').fill('Keep my reviewed draft')
  await page.route(`${EMAILS_API_URL}/emails/out-of-office`, async (route) => {
    if (route.request().method() !== 'PUT') return route.fallback()
    await route.fulfill({ status: 409, json: { error: 'Settings changed' } })
  })
  await settings.getByRole('button', { name: 'Save out of office' }).click()
  await expect(settings.getByRole('alert')).toContainText('changed in another browser')
  await expect(settings.getByLabel('Reply message')).toHaveValue('Keep my reviewed draft')
  await expect(settings.getByRole('button', { name: 'Save out of office' })).toBeDisabled()
  await settings.getByRole('button', { name: 'Discard edits and load latest' }).click()
  await expect(settings.getByLabel('Reply message')).toHaveValue('')
  await expect(settings.getByRole('alert')).toHaveCount(0)
})
