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

test('settings block is recoverable and screening decisions stay explicit across reloads', async ({
  page,
}) => {
  await page.goto('/inbox')
  await page.getByText('Revised Floor Plan - Natural Light adjustments', { exact: true }).click()
  const controls = page.locator('.sender-controls')
  await expect(controls).toHaveCount(0)
  await page.goto('/settings/senders')
  const settings = page.locator('.sender-settings')
  await settings.getByLabel('Email address or domain').fill('updates@cityconstruction.com')
  await settings.getByLabel('Decision').selectOption('block')
  await saveSender(page, 'block', () =>
    settings.getByRole('button', { name: 'Save sender', exact: true }).click(),
  )
  await expect(settings).toContainText('updates@cityconstruction.com — blocked')
  await page.reload()
  await expect(settings).toContainText('updates@cityconstruction.com — blocked')
  await expect(settings.getByRole('checkbox')).not.toBeChecked()
  await screening(page, true)
  await page.reload()
  await expect(settings.getByRole('checkbox')).toBeChecked()
  await saveSender(page, 'unblock', () =>
    settings.getByRole('button', { name: 'Unblock', exact: true }).click(),
  )
  await expect(settings.getByRole('button', { name: 'Unblock', exact: true })).toHaveCount(0)
  await screening(page, false)
  await settings.getByLabel('Email address or domain').fill('updates@cityconstruction.com')
  await settings.getByLabel('Decision').selectOption('accept')
  await saveSender(page, 'accept', () =>
    settings.getByRole('button', { name: 'Save sender', exact: true }).click(),
  )
  await page.getByRole('link', { name: 'New senders', exact: true }).first().click()
  await expect(page.getByText('No senders awaiting review.', { exact: true })).toBeVisible()
  await page.goto('/settings/senders')
  await expect(settings).toContainText('updates@cityconstruction.com — accepted')
  await expect(settings.getByRole('checkbox')).not.toBeChecked()
})

test('New senders restores one selected message without accepting the sender', async ({ page }) => {
  await page.goto('/settings/senders')
  await screening(page, true)
  // Seed two held messages from the same unknown sender using fixture-only
  // actions. Unblock with screening enabled returns blocked mail to review.
  const address = 'no-reply@resalemarketplace.com'
  for (const messageId of ['fixture-5', 'fixture-13']) {
    const result = await page.request.put('/__e2e__/emails-api/emails/senders', {
      data: { action: 'block', address, messageId },
    })
    expect(result.ok()).toBe(true)
  }
  const result = await page.request.put('/__e2e__/emails-api/emails/senders', {
    data: { action: 'unblock', address },
  })
  expect(result.ok()).toBe(true)
  await page.goto('/inbox?filter=screening')
  await expect(page.locator('.ni-row')).toHaveCount(2)
  await page
    .locator('.ni-row')
    .filter({ hasText: 'Item Sold! Baby winter coat bundle' })
    .locator('.ni-checkbox')
    .click()
  await saveSender(page, 'restore', () =>
    page.getByRole('button', { name: 'Restore this message only', exact: true }).click(),
  )
  await expect(page.locator('.ni-row')).toHaveCount(1)
  await expect(page.locator('.ni-row')).toContainText('Inquiry: Toddler shoe lot availability')
  await page.reload()
  await expect(page.locator('.ni-row')).toHaveCount(1)
  await page.goto('/settings/senders')
  await expect(page.locator('.sender-settings')).not.toContainText(`${address} — accepted`)
  await expect(page.locator('.sender-settings').getByRole('checkbox')).toBeChecked()
})
