import { expect, test } from './workerFixtures.js'

test('the panel’s project chip drops a searchable list of the Inbox and nested projects', async ({
  page,
}) => {
  const { project: work } = await (
    await page.request.post('/__e2e__/tasks-api/projects', { data: { name: 'Work' } })
  ).json()
  const { project: api } = await (
    await page.request.post('/__e2e__/tasks-api/projects', {
      data: { name: 'Public API', parentId: work.id },
    })
  ).json()
  const { item } = await (
    await page.request.post('/__e2e__/tasks-api/task-items', {
      data: { content: 'File me', projectId: null },
    })
  ).json()

  await page.goto(`/tasks?project=inbox&task=${item.id}`)
  const panel = page.getByRole('dialog', { name: 'File me' })
  const chip = panel.getByRole('button', { name: 'Project: Inbox' })
  await expect(chip).toBeVisible()
  await chip.click()

  // A search box, the Inbox (marked), then My Projects with the tree indented.
  const search = panel.getByRole('combobox', { name: 'Project' })
  await expect(search).toBeFocused()
  await expect(search).toHaveAttribute('placeholder', 'Type a project name')
  const options = panel.getByRole('option')
  await expect(options).toHaveText(['Inbox', 'Work', 'Public API'])
  await expect(options.first()).toHaveAttribute('aria-selected', 'true')
  await expect(panel.getByText('My Projects')).toBeVisible()
  const nested = panel.getByRole('option', { name: 'Public API' })
  const parent = panel.getByRole('option', { name: 'Work' })
  expect((await nested.boundingBox()).x).toBeGreaterThan((await parent.boundingBox()).x)

  // Typing narrows the list; Enter files the task there and closes the list.
  await search.fill('api')
  await expect(options).toHaveText(['Public API'])
  await search.press('Enter')
  await expect(panel.getByRole('combobox', { name: 'Project' })).toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'Project: Public API' })).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Project: Public API' })).toBeFocused()

  // Escape leaves the list, not the panel.
  await panel.getByRole('button', { name: 'Project: Public API' }).click()
  await panel.getByRole('combobox', { name: 'Project' }).press('Escape')
  await expect(panel.getByRole('combobox', { name: 'Project' })).toHaveCount(0)
  await expect(panel).toBeVisible()

  await page.goto(`/tasks?project=${api.id}`)
  await expect(page.locator('.task-row', { hasText: 'File me' })).toBeVisible()

  await page.request.delete('/__e2e__/tasks-api/task-items', { data: { id: item.id } })
  await page.request.delete('/__e2e__/tasks-api/projects', { data: { id: work.id } })
})
