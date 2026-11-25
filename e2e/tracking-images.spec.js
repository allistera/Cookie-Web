import { expect, test } from './workerFixtures.js'

import { MESSAGES_API_URL } from '../src/lib/apiWorkers.js'

test('the reader blocks a tracking image and tells the reader so', async ({ page }) => {
  await page.route(`${MESSAGES_API_URL}/messages?id=*`, (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        body_html:
          '<p>Site progress update</p>' +
          '<img src="https://news.example/logo.png" width="600" height="120" alt="Logo">' +
          '<img src="https://news.example/track/open.php?u=1" width="1" height="1" alt="">',
        body_text: 'Site progress update',
        unsubscribe: null,
      }),
    }),
  )

  await page.goto('/inbox')
  await page.locator('.ni-row', { hasText: 'City Construction' }).click()

  const notice = page.locator('.ni-email-trackers-notice')
  await expect(notice).toHaveText(/This email contained a tracking image, which was blocked\./)

  // The real image is still there to show; the pixel is gone from the frame.
  const frame = page.frameLocator('iframe[title="Email content"]')
  await expect(frame.locator('img')).toHaveCount(1)
  await expect(frame.locator('img')).toHaveAttribute('src', 'https://news.example/logo.png')
  await page.locator('.ni-email-images-notice').getByRole('button', { name: 'Show images' }).click()
  await expect(frame.locator('img')).toHaveCount(1)
  await expect(notice).toBeVisible()
})
