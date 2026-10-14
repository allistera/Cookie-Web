import { expect, test } from './workerFixtures.js'

// The tasks Worker fixture (scripts/localApi/plugin.js) keeps projects,
// tasks and the saved-filter document per session, so the filter made here
// survives a reload the way the real one does.
const api = '/__e2e__/tasks-api'

test('Saved filters gather matching tasks across projects and can be edited, renamed and deleted', async ({
  page,
}) => {
  const { project: work } = await (
    await page.request.post(`${api}/projects`, { data: { name: 'Work', parentId: null } })
  ).json()
  for (const task of [
    { content: 'Urgent in Work', projectId: work.id, priority: 1 },
    { content: 'Urgent in Inbox', projectId: null, priority: 1 },
    { content: 'Later in Inbox', projectId: null, priority: 4 },
  ]) {
    await page.request.post(`${api}/task-items`, { data: task })
  }

  await page.goto('/tasks?project=inbox')
  await expect(page.locator('.tasks-filters-nav')).toContainText('No filters yet')

  await page.getByRole('button', { name: 'New filter', exact: true }).click()
  const editor = page.getByRole('dialog', { name: 'New filter' })
  await expect(editor.getByLabel('Filter name')).toBeFocused()
  await editor.getByLabel('Filter name').fill('Urgent')
  await editor.getByLabel('Rule 1 field').selectOption('priority')
  await editor.getByLabel('Rule 1 priority').selectOption({ label: 'Priority 1' })
  await editor.getByRole('button', { name: 'Save filter' }).click()

  await expect(editor).toBeHidden()
  await expect(page).toHaveURL(/project=filter(?:%3A|:)/)
  await expect(page.getByRole('heading', { level: 1, name: 'Urgent' })).toBeVisible()
  await expect(page.locator('.tasks-filter-chip')).toHaveText([/Priority is\s+P1/])
  await expect(page.locator('.task-content')).toHaveText(['Urgent in Work', 'Urgent in Inbox'])
  await expect(page.locator('.task-home')).toHaveText(['Work', 'Inbox'])
  await expect(page.locator('.add-task-btn')).toHaveCount(0)
  const row = page.locator('.tasks-filters-nav .filter-item')
  await expect(row).toHaveCount(1)
  await expect(row).toHaveClass(/active/)

  // Exclude the Work project: only the Inbox task is left.
  await page.getByRole('button', { name: 'Edit filter', exact: true }).click()
  const edit = page.getByRole('dialog', { name: 'Edit filter' })
  await edit.getByRole('button', { name: 'Add rule' }).click()
  await edit.getByLabel('Rule 2 field').selectOption('project')
  await edit.getByLabel('Rule 2 includes or excludes').selectOption({ label: 'is not' })
  await edit.getByLabel('Rule 2 project').selectOption({ label: 'Work' })
  await edit.getByRole('button', { name: 'Save changes' }).click()
  await expect(edit).toBeHidden()
  await expect(page.locator('.tasks-filter-chip')).toHaveText([
    /Priority is\s+P1/,
    /Project is not\s+Work/,
  ])
  await expect(page.locator('.task-content')).toHaveText(['Urgent in Inbox'])

  // Rename in place from the sidebar; the definition is on the server, so
  // a reload shows the new name.
  await row.dblclick()
  await page.getByLabel('Rename Urgent').fill('Urgent inbox')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { level: 1, name: 'Urgent inbox' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'Urgent inbox' })).toBeVisible()
  await expect(page.locator('.task-content')).toHaveText(['Urgent in Inbox'])

  // Delete leaves the view, and Undo brings the filter back.
  await row.hover()
  await row.getByRole('button', { name: 'Delete filter Urgent inbox' }).click()
  await expect(page).toHaveURL(/project=inbox/)
  await expect(page.locator('.tasks-filters-nav')).toContainText('No filters yet')
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.locator('.tasks-filters-nav .filter-item .nav-text')).toHaveText([
    'Urgent inbox',
  ])
})
