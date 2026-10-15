import { expect, test } from './workerFixtures.js'

// The tasks Worker fixture (scripts/localApi/plugin.js) stands in for
// Todoist: a saved token "connects" the fixture account, and each sync
// mirrors the same small Todoist workspace into the session's projects and
// tasks, the way cookie-web-tasks's todoistSync.js would.
test('Todoist connects from Settings, syncs on demand and shows the mirrored work in Tasks', async ({
  page,
}) => {
  await page.goto('/settings/todoist')

  await expect(page.getByRole('heading', { name: 'Todoist' })).toBeVisible()
  await page.getByLabel('Todoist API token').fill('bad-token')
  await page.getByRole('button', { name: 'Connect Todoist' }).click()
  await expect(page.getByText('Todoist rejected that token')).toBeVisible()

  await page.getByLabel('Todoist API token').fill('fixture-token-1234')
  await page.getByRole('button', { name: 'Connect Todoist' }).click()

  // Connecting runs a first sync straight away.
  await expect(page.locator('.todoist-account').getByText('person@example.com')).toBeVisible()
  await expect(page.getByText('Token ending in 1234')).toBeVisible()
  await expect(page.getByRole('checkbox', { name: 'Sync every hour' })).toBeChecked()
  await expect(page.locator('.todoist-status')).toContainText('1 project, 1 section, 3 open tasks')

  await page.getByRole('checkbox', { name: 'Sync every hour' }).uncheck()
  await expect(page.getByRole('checkbox', { name: 'Sync every hour' })).not.toBeChecked()
  await page.reload()
  await expect(page.getByRole('checkbox', { name: 'Sync every hour' })).not.toBeChecked()

  await page.getByTestId('todoist-sync-now').click()
  await expect(page.locator('.todoist-status')).toContainText('Last synced')

  await page.goto('/tasks?project=inbox')
  const projects = page.getByRole('navigation', { name: 'My projects' })
  await expect(projects.getByText('Todoist Work')).toBeVisible()
  await expect(page.locator('.task-content')).toContainText(['Reply to the landlord'])
  await projects.getByText('Todoist Work').click()
  await expect(page.locator('.task-content')).toHaveText([
    'Write the quarterly report',
    'Book the team lunch',
  ])
  await expect(page.locator('.divider-text')).toContainText(['Next up'])

  await page.goto('/settings/todoist')
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm disconnect' }).click()
  await expect(page.getByRole('button', { name: 'Connect Todoist' })).toBeVisible()
})
