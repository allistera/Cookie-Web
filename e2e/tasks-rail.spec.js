import { expect, test } from './workerFixtures.js'

test('the tasks sidebar opens from the header, adds and completes tasks, and stays open', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date(2026, 10, 27, 10, 30))
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/inbox')

  const rail = page.getByRole('complementary', { name: 'Tasks', exact: true })
  const today = rail.getByRole('region', { name: 'Today' })
  const inbox = rail.getByRole('region', { name: 'Inbox' })
  await expect(rail).toBeHidden()

  await page.getByRole('button', { name: 'Show tasks' }).click()
  await expect(rail).toBeVisible()
  await expect(rail.getByRole('heading', { level: 2 })).toHaveText('Tasks · Fri 27 Nov')
  await expect(today).toContainText('Nothing due today.')
  await expect(inbox).toContainText('Your inbox is clear.')

  // A task added under Today is due today; one added under Inbox has no day.
  await today.getByRole('button', { name: 'Add task' }).click()
  await today.getByRole('textbox', { name: 'Task name' }).fill('Renew car insurance')
  await page.keyboard.press('Enter')
  await expect(today.getByRole('link', { name: 'Renew car insurance' })).toBeVisible()
  await expect(today).toContainText('Today · 1')
  await expect(inbox).toContainText('Your inbox is clear.')

  await inbox.getByRole('button', { name: 'Add task' }).click()
  await inbox.getByRole('textbox', { name: 'Task name' }).fill('Return the library books')
  await page.keyboard.press('Enter')
  await expect(inbox.getByRole('link', { name: 'Return the library books' })).toBeVisible()
  await expect(today.getByRole('link')).toHaveCount(1)

  await inbox.getByRole('button', { name: 'Complete Return the library books' }).click()
  await expect(inbox).toContainText('Your inbox is clear.')

  // One sidebar at a time: the calendar takes the place of the tasks.
  await page.getByRole('button', { name: 'Show calendar' }).click()
  await expect(page.getByRole('complementary', { name: 'Calendar' })).toBeVisible()
  await expect(rail).toBeHidden()
  await page.keyboard.press('[')
  await expect(rail).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Calendar' })).toBeHidden()

  // Remembered in this browser across a reload, and on Documents too.
  await page.reload()
  await expect(today.getByRole('link', { name: 'Renew car insurance' })).toBeVisible()
  await page.goto('/documents')
  await expect(rail).toBeVisible()

  // Tasks is the full view, so the sidebar and its button leave there.
  await rail.getByRole('link', { name: 'Open Tasks' }).click()
  await expect(page).toHaveURL(/\/tasks$/)
  await expect(rail).toBeHidden()
  await expect(page.getByRole('button', { name: 'Hide tasks', exact: true })).toBeHidden()
})
