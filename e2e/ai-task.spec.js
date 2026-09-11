import { expect, test } from './workerFixtures.js'
import { TASKS_API_URL } from '../src/lib/apiWorkers.js'

test('AI Task opens a blurred prompt and shows the generated task with subtasks', async ({
  page,
}) => {
  const item = {
    id: 'ai-parent',
    content: 'Plan a day trip to London',
    description: 'Arrange travel and a relaxed itinerary.',
    projectId: null,
    parentId: null,
    priority: 4,
    labels: [],
  }
  const child = {
    ...item,
    id: 'ai-child',
    parentId: item.id,
    content: 'Choose a date',
    description: '',
  }
  let saved = false
  await page.route(`${TASKS_API_URL}/task-items?*`, (route) =>
    route.fulfill({ json: { items: saved ? [item, child] : [] } }),
  )
  await page.route(`${TASKS_API_URL}/task-items/generate`, async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({
      text: 'Plan day trip to london',
      timeZone: expect.any(String),
    })
    saved = true
    await route.fulfill({ status: 201, json: { item, subtasks: [child] } })
  })
  await page.goto('/tasks')
  await page.getByRole('button', { name: 'AI Task', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'AI Task', exact: true })
  await expect(dialog).toBeVisible()
  const position = await dialog.boundingBox()
  const viewport = page.viewportSize()
  expect(Math.abs(position.x + position.width / 2 - viewport.width / 2)).toBeLessThan(2)
  expect(Math.abs(position.y + position.height / 2 - viewport.height / 2)).toBeLessThan(2)
  const input = dialog.getByRole('textbox', { name: 'Describe your task' })
  await expect(input).toBeFocused()
  expect(await dialog.evaluate((el) => getComputedStyle(el, '::backdrop').backdropFilter)).toBe(
    'blur(8px)',
  )
  await input.fill('Plan day trip to london')
  await input.press('Enter')
  await expect(dialog).toBeHidden()
  await expect(page).toHaveURL(/project=inbox&task=ai-parent/)
  await expect(page.getByRole('heading', { name: item.content, exact: true })).toBeVisible()
  await expect(page.getByText(item.description).last()).toBeVisible()
  await expect(page.getByText('Choose a date').first()).toBeVisible()
})

test('AI Task keeps the prompt on failure and supports keyboard dismissal on mobile', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.route(`${TASKS_API_URL}/task-items/generate`, (route) =>
    route.fulfill({ status: 502, json: { error: 'Could not generate task. Try again.' } }),
  )
  await page.goto('/tasks?project=inbox')
  await page.getByRole('button', { name: 'AI Task', exact: true }).click()
  const input = page.getByRole('textbox', { name: 'Describe your task' })
  await input.fill('Plan day trip to london')
  await input.press('Enter')
  await expect(page.getByRole('alert')).toContainText('Could not generate task')
  await expect(input).toHaveValue('Plan day trip to london')
  const dialog = page.getByRole('dialog', { name: 'AI Task', exact: true })
  const bounds = await dialog.boundingBox()
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})
