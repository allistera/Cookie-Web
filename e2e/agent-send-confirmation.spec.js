import { expect, test } from './workerFixtures.js'

test('Connections creates a one-use send confirmation from the send Worker', async ({ page }) => {
  // The old Settings address still leads here.
  await page.goto('/settings/mcp-clients')
  await expect(page).toHaveURL(/\/automations\/connections$/)
  const section = page.getByRole('region', { name: 'Send confirmations' })
  await section.getByRole('button', { name: 'Create send confirmation' }).click()
  await expect(section.locator('code')).toHaveText(/^[0-9a-f]{64}$/)
  await expect(section).toContainText('Expires')
})
