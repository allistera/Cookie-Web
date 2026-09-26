import { expect, test } from './workerFixtures.js'

async function screening(page, enabled) {
  const saved = page.waitForResponse(
    (response) =>
      response.url().includes('/emails/senders') && response.request().method() === 'PUT',
  )
  await page.locator('.sender-settings').getByRole('checkbox').setChecked(enabled)
  expect((await saved).ok()).toBe(true)
}

test('reader block is recoverable and screening decisions stay explicit across reloads', async ({
  page,
}) => {
  await page.goto('/inbox')
  await page.getByText('Revised Floor Plan - Natural Light adjustments', { exact: true }).click()
  const controls = page.locator('.sender-controls')
  await controls.locator('summary').click()
  await expect(controls).toContainText('updates@cityconstruction.com')
  await controls.getByRole('button', { name: 'Block sender', exact: true }).click()
  await page.getByRole('link', { name: 'Blocked', exact: true }).click()
  await page.getByText('Revised Floor Plan - Natural Light adjustments', { exact: true }).click()
  await expect(controls.getByRole('button', { name: 'Unblock sender', exact: true })).toBeEnabled()
  await page.goto('/settings/senders')
  const settings = page.locator('.sender-settings')
  await expect(settings.getByRole('checkbox')).not.toBeChecked()
  await screening(page, true)
  await page.reload()
  await expect(settings.getByRole('checkbox')).toBeChecked()
  await settings.getByRole('button', { name: 'Unblock', exact: true }).click()
  await page.getByRole('link', { name: 'New senders', exact: true }).first().click()
  await page.getByText('Revised Floor Plan - Natural Light adjustments', { exact: true }).click()
  await expect(controls).toContainText('Review new sender')
  // Controls own their keyboard events: reader shortcuts must not archive or close mail.
  await controls.getByRole('button', { name: 'Accept sender', exact: true }).focus()
  await page.keyboard.press('e')
  await page.keyboard.press('Escape')
  await expect(controls).toBeVisible()
  await page.goto('/settings/senders')
  await screening(page, false)
  await page.getByRole('link', { name: 'New senders', exact: true }).first().click()
  await page.getByText('Revised Floor Plan - Natural Light adjustments', { exact: true }).click()
  await controls.getByRole('button', { name: 'Accept sender', exact: true }).click()
  await expect(page.getByText('No senders awaiting review.', { exact: true })).toBeVisible()
  await page.goto('/settings/senders')
  await expect(settings).toContainText('updates@cityconstruction.com — accepted')
  await expect(settings.getByRole('checkbox')).not.toBeChecked()
})
