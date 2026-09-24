import { test, expect } from './workerFixtures.js'

test('signature and snippets sync across tabs and survive reload', async ({ page }) => {
  await page.goto('/settings/signature')
  const signature = page.locator('.settings-signature-editor .composer-editor')
  await expect(signature).toBeVisible()
  await signature.fill('Regards, Cookie')
  await page.getByRole('button', { name: 'Save signature' }).click()
  await expect(page.getByRole('button', { name: 'Save signature' })).toBeDisabled()

  await page.goto('/settings/snippets')
  await page.locator('.snippet-editor-form > .label-input').fill('hello-world')
  await page.locator('.snippet-editor .composer-editor').fill('Hello there')
  await page.getByRole('button', { name: 'Add snippet' }).click()
  await expect(page.locator('.snippet-trigger')).toHaveText('/hello-world')

  const secondTab = await page.context().newPage()
  await secondTab.goto('/settings/signature')
  await expect(secondTab.locator('.settings-signature-editor .composer-editor')).toContainText(
    'Regards, Cookie',
  )
  await secondTab.goto('/settings/snippets')
  await expect(secondTab.locator('.snippet-trigger')).toHaveText('/hello-world')
  await secondTab.getByRole('button', { name: 'Delete snippet /hello-world' }).click()
  await expect(secondTab.locator('.snippet-trigger')).toHaveCount(0)

  await page.reload()
  await expect(page.locator('.snippet-trigger')).toHaveCount(0)
  await secondTab.close()
})
