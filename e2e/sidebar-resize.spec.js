import { expect, test } from './workerFixtures.js'

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
