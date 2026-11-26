import { expect, test } from './workerFixtures.js'

test('Connected agents creates a one-use send confirmation from the send Worker', async ({
  page,
}) => {
  await page.goto('/settings/mcp-clients')
  const section = page.getByTestId('agent-section')
  await expect(section.getByRole('heading', { name: 'Connected agents' })).toBeVisible()
  await section.getByRole('button', { name: 'Create send confirmation' }).click()
  await expect(section.locator('code')).toHaveText(/^[0-9a-f]{64}$/)
  await expect(section).toContainText('Expires')
})
