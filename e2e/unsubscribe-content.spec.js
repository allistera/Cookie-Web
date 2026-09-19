import { expect, test } from './workerFixtures.js'

import { MESSAGES_API_URL } from '../src/lib/apiWorkers.js'

test('email-content unsubscribe link appears in the reader action bar', async ({ page }) => {
  const url = 'https://news.example/preferences/unsubscribe?token=a%2Fb%26c'
  const ordinaryLinks = Array.from(
    { length: 220 },
    (_, index) => `<a href="https://news.example/story/${index}">Story ${index}</a>`,
  ).join(' ')
  await page.route(`${MESSAGES_API_URL}/messages?id=*`, (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        body_html: `<p>${ordinaryLinks}</p><p><a href="${url}">Unsubscribe</a></p>`,
        body_text: 'Newsletter body',
        unsubscribe: null,
      }),
    }),
  )

  await page.goto('/inbox')
  await page.locator('.ni-row', { hasText: 'City Construction' }).click()
  await page.locator('.ni-reader-topbar [title="More"]').click()

  const action = page.locator('.ni-reader-topbar .ni-more-menu a[title="Unsubscribe"]')
  await expect(action).toBeVisible()
  await expect(action).toHaveAttribute('href', url)
  await expect(action).toHaveAttribute('target', '_blank')
  await expect(action).toHaveAttribute('rel', 'noopener noreferrer')
})
