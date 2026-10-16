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
  // An option's text also carries its icon ligature, so read the names.
  const options = panel.getByRole('option')
  const names = panel.locator('.task-project-option-name')
  await expect(names).toHaveText(['Inbox', 'Work', 'Public API'])
  await expect(options.first()).toHaveAttribute('aria-selected', 'true')
  await expect(panel.getByText('My Projects')).toBeVisible()
  const nested = panel.getByRole('option', { name: 'Public API' })
  const parent = panel.getByRole('option', { name: 'Work' })
  // Depth indents the row's content, not the row itself, so compare the names.
  const nestedName = nested.locator('.task-project-option-name')
  const parentName = parent.locator('.task-project-option-name')
  expect((await nestedName.boundingBox()).x).toBeGreaterThan((await parentName.boundingBox()).x)

  // Escape leaves the list, not the panel.
  await search.press('Escape')
  await expect(panel.getByRole('combobox', { name: 'Project' })).toHaveCount(0)
  await expect(panel).toBeVisible()
  await expect(chip).toBeFocused()

  // Typing narrows the list; Enter files the task there and closes the list.
  // The task then leaves the Inbox list, so the move is checked in its project.
  await chip.click()
  await panel.getByRole('combobox', { name: 'Project' }).fill('api')
  await expect(names).toHaveText(['Public API'])
  await panel.getByRole('combobox', { name: 'Project' }).press('Enter')
  await expect(page.getByRole('combobox', { name: 'Project' })).toHaveCount(0)

  await page.goto(`/tasks?project=${api.id}`)
  await expect(page.locator('.task-row', { hasText: 'File me' })).toBeVisible()

  await page.request.delete('/__e2e__/tasks-api/task-items', { data: { id: item.id } })
  await page.request.delete('/__e2e__/tasks-api/projects', { data: { id: work.id } })
})
