import { expect, test } from './workerFixtures.js'

test('a task estimate survives reload and controls its calendar height', async ({ page }) => {
  const today = new Date()
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const { item } = await (
    await page.request.post('/__e2e__/tasks-api/task-items', {
      data: { content: 'Plan the release', dueDate: date, dueTime: '12:00', timeZone: 'UTC' },
    })
  ).json()
  await page.goto(`/tasks?project=inbox&task=${item.id}`)
  const input = page.getByRole('spinbutton', { name: 'Estimated duration in minutes' })
  await input.fill('90')
  const saved = page.waitForResponse(
    (response) => response.url().includes('/task-items') && response.request().method() === 'PATCH',
  )
  await input.press('Tab')
  expect((await saved).ok()).toBeTruthy()
  await page.reload()
  await expect(input).toHaveValue('90')

  await page.goto('/calendar')
  await page.getByRole('button', { name: 'Day', exact: true }).click()
  const event = page.locator('.day-event.task-event', { hasText: 'Plan the release' })
  await expect(event).toBeVisible()
  await expect(event).toHaveCSS('height', '144px')

  await page.goto(`/tasks?project=inbox&task=${item.id}`)
  await input.fill('')
  const cleared = page.waitForResponse(
    (response) => response.url().includes('/task-items') && response.request().method() === 'PATCH',
  )
  await input.press('Tab')
  expect((await cleared).ok()).toBeTruthy()
  await page.reload()
  await expect(input).toHaveValue('')
  await page.goto('/calendar')
  await page.getByRole('button', { name: 'Day', exact: true }).click()
  await expect(event).toHaveCSS('height', '48px')
})
