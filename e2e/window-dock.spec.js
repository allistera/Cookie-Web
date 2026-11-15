import { expect, test } from './workerFixtures.js'

test('several messages stay open as tabs along the bottom, titled by subject', async ({ page }) => {
  await page.goto('/inbox')
  const composer = page.locator('#composerToast')
  const subject = composer.locator('.composer-subject-inline')
  const dock = page.getByRole('navigation', { name: 'Open windows' })

  // One message on its own needs no tab under it.
  await page.locator('.compose-btn').click()
  await subject.fill('Quarterly numbers')
  await expect(dock).toBeHidden()

  // Compose again: the first message waits in a tab while the second is
  // written, and the open tab is titled as its subject is typed.
  await page.locator('.compose-btn').click()
  await expect(subject).toHaveValue('')
  await expect(dock.getByRole('button', { name: 'Quarterly numbers', exact: true })).toBeVisible()
  await expect(dock.getByRole('button', { name: 'New message', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await subject.fill('Lunch on Friday')
  const lunch = dock.getByRole('button', { name: 'Lunch on Friday', exact: true })
  await expect(lunch).toHaveAttribute('aria-pressed', 'true')

  // A tab brings its message back; the one it replaces keeps its tab.
  const numbers = dock.getByRole('button', { name: 'Quarterly numbers', exact: true })
  await numbers.click()
  await expect(subject).toHaveValue('Quarterly numbers')
  await expect(numbers).toHaveAttribute('aria-pressed', 'true')
  await expect(lunch).toHaveAttribute('aria-pressed', 'false')

  // Minimising puts the open message away without closing either.
  await composer.getByRole('button', { name: 'Minimise composer' }).click()
  await expect(composer).toBeHidden()
  await expect(numbers).toHaveAttribute('aria-pressed', 'false')
  await expect(lunch).toBeVisible()

  // Closing a tab leaves the other, which reopens with what was typed.
  await dock.getByRole('button', { name: 'Close Quarterly numbers' }).click()
  await expect(numbers).toHaveCount(0)
  await lunch.click()
  await expect(subject).toHaveValue('Lunch on Friday')
  await expect(dock).toBeHidden()
})

test('emails minimised from the reader are tabs that open them again', async ({ page }) => {
  await page.goto('/inbox')
  const reader = page.locator('.ni-reader')
  const readerSubject = reader.locator('.ni-reader-subject-text')
  const minimise = reader.getByRole('button', { name: 'Minimise to a tab' })
  const dock = page.getByRole('navigation', { name: 'Open windows' })

  await page.locator('.ni-row', { hasText: 'City Construction' }).click()
  await expect(readerSubject).toContainText('Revised Floor Plan')
  await minimise.click()
  await expect(reader).toBeHidden()
  const plan = dock.getByRole('button', { name: /^Revised Floor Plan/ })
  await expect(plan).toHaveAttribute('aria-pressed', 'false')

  // A second email is read and kept beside the first.
  await page.locator('.ni-group-header', { hasText: 'Yesterday' }).click()
  await page.locator('.ni-row').nth(1).click()
  await expect(readerSubject).not.toContainText('Revised Floor Plan')
  await minimise.click()
  await expect(reader).toBeHidden()
  await expect(dock.locator('.window-dock-tab')).toHaveCount(2)

  // A tab opens its email, and the open tab puts it away again.
  await plan.click()
  await expect(readerSubject).toContainText('Revised Floor Plan')
  await expect(plan).toHaveAttribute('aria-pressed', 'true')
  await plan.click()
  await expect(reader).toBeHidden()

  // The route is already this email's, and the tab still opens it.
  await plan.click()
  await expect(readerSubject).toContainText('Revised Floor Plan')

  // Closing the other tab leaves only the open email, which needs no tab.
  await dock
    .locator('.window-dock-tab')
    .nth(1)
    .getByRole('button', { name: /^Close/ })
    .click()
  await expect(dock).toBeHidden()
  await expect(reader).toBeVisible()
})
