import { expect, test } from './workerFixtures.js'

test('mobile Tasks keeps content full width and exposes navigation on demand', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/tasks?project=inbox')
  const sidebar = page.getByRole('complementary', { name: 'Tasks sidebar' })
  const toggle = page.getByRole('button', { name: 'Show task navigation' })
  await expect(toggle).toBeVisible()
  await expect(sidebar).toBeHidden()
  expect((await page.locator('.main-content').boundingBox()).width).toBeGreaterThan(350)
  const breadcrumb = await page.locator('.tasks-breadcrumb').boundingBox()
  const history = await page.locator('.tasks-history-button').boundingBox()
  expect(breadcrumb.y + breadcrumb.height).toBeLessThanOrEqual(history.y)
  await toggle.click()
  await expect(sidebar).toBeVisible()
  await expect(page.getByRole('button', { name: 'Hide task navigation' })).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  await sidebar
    .getByRole('link', { name: /^Today/ })
    .first()
    .click()
  await expect(page).toHaveURL(/project=today/)
  await expect(sidebar).toBeHidden()
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible()
})

test('the sidebar can be dragged to a temporary width that resets on reload', async ({ page }) => {
  await page.goto('/inbox')
  const sidebar = page.locator('.left-sidebar').first()
  const handle = page.getByRole('separator', { name: 'Resize sidebar' })
  await expect(handle).toBeVisible()
  const before = (await sidebar.boundingBox()).width

  const box = await handle.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2, { steps: 5 })
  await page.mouse.up()
  await expect.poll(async () => (await sidebar.boundingBox()).width).toBeCloseTo(before + 100, -1)

  // The width follows into the other apps' sidebars for this visit...
  await page.getByRole('button', { name: 'Switch Cookie app' }).hover()
  await page.getByRole('menuitem', { name: 'Documents' }).click()
  await expect(page).toHaveURL(/\/documents$/)
  await expect
    .poll(async () => (await page.locator('.documents-sidebar').boundingBox()).width)
    .toBeCloseTo(before + 100, -1)

  // ...and a reload starts from the default again.
  await page.goto('/inbox')
  await expect.poll(async () => (await sidebar.boundingBox()).width).toBeCloseTo(before, 0)

  // Double-click resets straight away too.
  await handle.focus()
  await page.keyboard.press('ArrowRight')
  await expect.poll(async () => (await sidebar.boundingBox()).width).toBeGreaterThan(before)
  await handle.dblclick()
  await expect.poll(async () => (await sidebar.boundingBox()).width).toBeCloseTo(before, 0)
})
