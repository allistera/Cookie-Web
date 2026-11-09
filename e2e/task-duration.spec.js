import { expect, test } from './workerFixtures.js'

test('a task estimate survives reload and controls its calendar width', async ({ page }) => {
  const today = new Date()
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const { item } = await (
    await page.request.post('/__e2e__/tasks-api/task-items', {
      data: { content: 'Plan the release', dueDate: date, dueTime: '12:00', timeZone: 'UTC' },
    })
  ).json()
  await page.goto(`/tasks?project=inbox&task=${item.id}`)
  await page.getByRole('button', { name: 'Custom', exact: true }).click()
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
  // The day view runs left to right, so an event is as wide as its share of
  // the 11 visible hours (660 minutes).
  const laneShare = async () => {
    const eventBox = await event.boundingBox()
    const laneBox = await page.locator('.day-event-lane').boundingBox()
    return eventBox.width / laneBox.width
  }
  await expect.poll(laneShare).toBeCloseTo(90 / 660, 2)

  await page.goto(`/tasks?project=inbox&task=${item.id}`)
  await input.fill('')
  const cleared = page.waitForResponse(
    (response) => response.url().includes('/task-items') && response.request().method() === 'PATCH',
  )
  await input.press('Tab')
  expect((await cleared).ok()).toBeTruthy()
  await page.reload()
  await expect(input).toHaveCount(0)
  await expect(page.locator('.task-panel-field-summary').first()).toHaveText('Not set')
  await page.goto('/calendar')
  await page.getByRole('button', { name: 'Day', exact: true }).click()
  await expect.poll(laneShare).toBeCloseTo(30 / 660, 2)
})
