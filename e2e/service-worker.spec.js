import { expect, test } from '@playwright/test'

test('the service worker keeps the shell and recently read mail available offline', async ({
  browserName,
  context,
  page,
}) => {
  // eslint-disable-next-line playwright/no-skipped-test -- WebKit's emulated offline mode bypasses worker fetches.
  test.skip(browserName === 'webkit', 'Playwright WebKit offline mode bypasses service workers')

  await page.goto('/inbox')
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js')
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }),
      )
    }
  })

  // Reload once under worker control so the route and its module graph become
  // the cached application shell.
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeVisible()
  const shellUrls = await page.evaluate(async () => {
    const cache = await caches.open('cookie-shell-v1')
    return (await cache.keys()).map((request) => new URL(request.url).pathname)
  })
  expect(shellUrls).toContain('/')
  expect(shellUrls).toContain('/inbox')

  const onlineBody = await page.evaluate(async () => {
    const response = await fetch('/api/messages?id=fixture-1')
    return response.json()
  })
  expect(onlineBody.body_text).toContain('updated design')

  await expect
    .poll(() =>
      page.evaluate(async () => {
        const cache = await caches.open('cookie-recent-mail-v1')
        return (await cache.keys()).length
      }),
    )
    .toBe(1)

  await context.setOffline(true)
  try {
    const offlineBody = await page.evaluate(async () => {
      const response = await fetch('/api/messages?id=fixture-1')
      return response.json()
    })
    expect(offlineBody.body_text).toBe(onlineBody.body_text)

    await page.reload()
    await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeVisible()
  } finally {
    await context.setOffline(false)
  }
})
