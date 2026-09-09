import { expect, test } from './workerFixtures.js'
import { TASKS_API_URL } from '../src/lib/apiWorkers.js'

test('Task board groups by priority or labels and keeps the selected view on reload', async ({
  page,
}) => {
  await page.route(`${TASKS_API_URL}/task-items?*`, async (route) => {
    await route.fulfill({
      json: {
        items: [
          {
            id: 'board-a',
            content: 'Review launch plan',
            priority: 1,
            labels: ['Work', 'Calls'],
            projectId: null,
          },
          { id: 'board-b', content: 'Book appointment', priority: 4, labels: [], projectId: null },
        ],
      },
    })
  })
  await page.goto('/tasks?project=inbox')
  await page.getByRole('button', { name: 'Display', exact: true }).click()
  await page.getByRole('button', { name: 'Board', exact: true }).click()
  await expect(page.locator('.task-column')).toHaveCount(4)
  await expect(page.locator('.task-column').first()).toContainText('Review launch plan')
  await expect(page.locator('.task-column').last()).toContainText('Book appointment')
  await page.getByLabel('Group tasks by').selectOption('labels')
  await expect(page.locator('.task-column-title')).toHaveText(['Calls 1', 'Work 1', 'No label 1'])
  await page.reload()
  await page.getByRole('button', { name: 'Display: 2', exact: true }).click()
  await expect(page.getByLabel('Group tasks by')).toHaveValue('labels')
  await page.keyboard.press('Escape')
  await page.getByRole('searchbox', { name: 'Search tasks' }).fill('appointment')
  await expect(page.locator('.task-content')).toHaveText(['Book appointment'])
  await page.getByRole('searchbox', { name: 'Search tasks' }).fill('')
  await page.getByRole('button', { name: 'Display: 2', exact: true }).click()
  await page.getByRole('button', { name: 'List', exact: true }).click()
  await expect(page.locator('.task-content')).toHaveText(['Review launch plan', 'Book appointment'])
})
