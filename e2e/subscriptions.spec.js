import { expect, test } from './workerFixtures.js'

test('Subscriptions lists every sender and unsubscribes from the list', async ({ page }) => {
  await page.goto('/')
  await page.locator('.left-sidebar .nav-item', { hasText: 'Subscriptions' }).click()
  await expect(page).toHaveURL(/\/subscriptions$/)

  const rows = page.getByTestId('subscriptions-view').locator('.subscriptions-row')
  await expect(rows).toHaveCount(4)
  const daily = rows.filter({ hasText: 'Daily Bites' })
  await expect(daily).toContainText('newsletter@dailybites.example · 12 emails')
  // A sender unsubscribed from earlier is listed as done, with no button.
  const forum = rows.filter({ hasText: 'Old Forum Digest' })
  await expect(forum.locator('.subscriptions-status')).toContainText('Unsubscribed')
  await expect(forum.getByRole('button')).toHaveCount(0)

  await daily.getByRole('button', { name: 'Unsubscribe from Daily Bites' }).click()
  await expect(page.locator('.toast', { hasText: 'Unsubscribed from Daily Bites' })).toBeVisible()
  await expect(daily.locator('.subscriptions-status')).toContainText('Unsubscribed')
  await expect(daily.getByRole('button')).toHaveCount(0)

  // A sender that cannot be unsubscribed automatically hands over its page.
  const gadget = rows.filter({ hasText: 'Gadget Weekly' })
  await gadget.getByRole('button', { name: 'Unsubscribe from Gadget Weekly' }).click()
  await expect(gadget.getByRole('link', { name: 'Open unsubscribe page' })).toHaveAttribute(
    'href',
    'https://account.gadgetweekly.example/preferences',
  )

  // The unsubscribe is remembered: the row is still done after a reload.
  await page.reload()
  await expect(daily.locator('.subscriptions-status')).toContainText('Unsubscribed')
  await expect(daily.getByRole('button')).toHaveCount(0)
  await expect(gadget.getByRole('button')).toHaveText('Unsubscribe')
})
