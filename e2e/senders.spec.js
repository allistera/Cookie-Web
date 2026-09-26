import { expect, test } from './workerFixtures.js'

async function saveSender(page, action, interact) {
  const saved = page.waitForResponse(
    (response) =>
      response.url().includes('/emails/senders') &&
      response.request().method() === 'PUT' &&
      response.request().postDataJSON()?.action === action,
  )
  await interact()
  expect((await saved).ok()).toBe(true)
}

async function screening(page, enabled) {
  const toggle = page.locator('.sender-settings').getByRole('checkbox')
  await saveSender(page, 'settings', () => toggle.setChecked(enabled))
  // The response must also have been applied by the store before reload.
  await expect(toggle).toBeEnabled()
  await expect(toggle).toHaveJSProperty('checked', enabled)
}

test('reader block is recoverable and screening decisions stay explicit across reloads', async ({
  page,
}) => {
  await page.goto('/inbox')
  await page.getByText('Revised Floor Plan - Natural Light adjustments', { exact: true }).click()
  const controls = page.locator('.sender-controls')
  await controls.locator('summary').click()
  await expect(controls).toContainText('updates@cityconstruction.com')
  await saveSender(page, 'block', () =>
    controls.getByRole('button', { name: 'Block sender', exact: true }).click(),
  )
  await expect(controls).toBeHidden()
  await page.getByRole('link', { name: 'Blocked', exact: true }).click()
  await page.getByText('Revised Floor Plan - Natural Light adjustments', { exact: true }).click()
  await expect(controls.getByRole('button', { name: 'Unblock sender', exact: true })).toBeEnabled()
  await page.goto('/settings/senders')
  const settings = page.locator('.sender-settings')
  await expect(settings.getByRole('checkbox')).not.toBeChecked()
  await screening(page, true)
  await page.reload()
  await expect(settings.getByRole('checkbox')).toBeChecked()
  await saveSender(page, 'unblock', () =>
    settings.getByRole('button', { name: 'Unblock', exact: true }).click(),
  )
  await expect(settings.getByRole('button', { name: 'Unblock', exact: true })).toHaveCount(0)
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
  await saveSender(page, 'accept', () =>
    controls.getByRole('button', { name: 'Accept sender', exact: true }).click(),
  )
  await expect(page.getByText('No senders awaiting review.', { exact: true })).toBeVisible()
  await page.goto('/settings/senders')
  await expect(settings).toContainText('updates@cityconstruction.com — accepted')
  await expect(settings.getByRole('checkbox')).not.toBeChecked()
})
