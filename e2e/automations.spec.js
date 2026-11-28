import { expect, test } from './workerFixtures.js'

test('Automations opens from the app switcher and shows an empty page per sidebar item', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Switch Cookie app' }).hover()
  await page.getByRole('menuitem', { name: 'Automations' }).click()

  await expect(page).toHaveURL(/\/automations$/)
  await expect(page.locator('.logo-suffix')).toHaveText('Automations')
  const sidebar = page.getByRole('complementary', { name: 'Automations sidebar' })
  const title = page.getByTestId('automations-view').getByRole('heading')
  await expect(title).toHaveText('Dashboard')

  for (const name of ['Connections', 'Templates', 'Chat', 'Dashboard']) {
    await sidebar.getByRole('link', { name, exact: true }).click()
    await expect(title).toHaveText(name)
  }

  await sidebar.getByRole('link', { name: 'Create Automation' }).click()
  await expect(page).toHaveURL(/\/automations\/new$/)
  await expect(title).toHaveText('Create Automation')
})
