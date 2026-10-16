import { expect, test } from './workerFixtures.js'
import { TASKS_API_URL } from '../src/lib/apiWorkers.js'

test('Select all gathers the list and the bulk bar marks the selection done', async ({ page }) => {
  const completed = []
  await page.route(`${TASKS_API_URL}/task-items?*`, async (route) => {
    await route.fulfill({
      json: {
        items: [
          { id: 'bulk-a', content: 'Water the plants', projectId: null },
          { id: 'bulk-b', content: 'Book the dentist', projectId: null },
          { id: 'bulk-c', content: 'Renew the passport', projectId: null },
        ],
      },
    })
  })
  await page.route(`${TASKS_API_URL}/task-items`, async (route) => {
    const body = route.request().postDataJSON()
    completed.push(body)
    await route.fulfill({
      json: { item: { id: body.id, projectId: null, completedAt: '2026-10-16T10:00:00.000Z' } },
    })
  })

  await page.goto('/tasks?project=inbox')
  await expect(page.locator('.task-content')).toHaveCount(3)
  const bar = page.getByRole('toolbar', { name: 'Selected tasks' })
  await expect(bar).toHaveCount(0)

  await page.getByRole('button', { name: 'Select all', exact: true }).click()
  await expect(bar).toContainText('3 selected')
  await expect(bar.getByRole('button', { name: 'Select all', exact: true })).toHaveCount(0)

  // Taking one back out brings Select all into the bar.
  await page.getByRole('button', { name: 'Book the dentist', exact: true }).click()
  await expect(bar).toContainText('2 selected')
  await bar.getByRole('button', { name: 'Select all', exact: true }).click()
  await expect(bar).toContainText('3 selected')

  await bar.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(page.locator('.task-content')).toHaveCount(0)
  await expect(bar).toHaveCount(0)
  await expect(page.getByText('Completed 3 tasks.')).toBeVisible()
  expect(completed.map((body) => body.id).sort()).toEqual(['bulk-a', 'bulk-b', 'bulk-c'])
  expect(completed.every((body) => body.completed === true)).toBe(true)
})
