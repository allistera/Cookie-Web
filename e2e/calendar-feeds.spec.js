import { expect, test } from './workerFixtures.js'

test('private calendar subscriptions can be generated, replaced, and revoked from Settings', async ({
  page,
}) => {
  await page.goto('/settings/calendar')
  const feeds = page.getByRole('region', { name: 'Private calendar feeds' })
  await expect(feeds).toBeVisible()
  await feeds.getByRole('button', { name: 'Generate private link for Work', exact: true }).click()
  const link = feeds.getByRole('textbox', { name: 'Private subscription link for Work' })
  await expect(link).toHaveValue(
    /^https:\/\/calendar-api\.infinitywave\.online\/calendar-feed\.ics\?token=[0-9a-f]{64}$/,
  )
  const original = await link.inputValue()
  await expect(feeds.getByRole('button', { name: 'Copy private link for Work' })).toBeVisible()
  await expect(feeds.getByRole('status')).toContainText('Copy it before leaving')

  await feeds.getByRole('button', { name: 'Replace private link for Work' }).click()
  await expect(feeds.getByText(/The old link will stop working/)).toBeVisible()
  await feeds.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(link).toHaveValue(original)
  await feeds.getByRole('button', { name: 'Replace private link for Work' }).click()
  await feeds.getByRole('button', { name: 'Confirm replace' }).click()
  await expect(link).not.toHaveValue(original)

  // Only enabled status persists across a page reload; bearer links are
  // returned once and are never recovered from browser or server storage.
  await page.reload()
  await expect(feeds.getByRole('button', { name: 'Replace private link for Work' })).toBeEnabled()
  await expect(link).toHaveCount(0)
  await feeds.getByRole('button', { name: 'Revoke private link for Work' }).click()
  await feeds.getByRole('button', { name: 'Confirm revoke' }).click()
  await expect(
    feeds.getByRole('button', { name: 'Generate private link for Work', exact: true }),
  ).toBeEnabled()
  await expect(feeds.getByRole('status')).toContainText('Link revoked')
})
