import { expect, test } from './workerFixtures.js'

test('the service worker keeps the shell and recently read mail available offline', async ({
  browserName,
  context,
  page,
}) => {
  // eslint-disable-next-line playwright/no-skipped-test -- WebKit's emulated offline mode bypasses worker fetches.
  test.skip(browserName === 'webkit', 'Playwright WebKit offline mode bypasses service workers')
  // Firefox has the same limitation (microsoft/playwright#2311): with the
  // page controlled, the mail cache populated, and a direct cache.match
  // hitting, the offline fetch still throws NetworkError because the SW
  // fetch handler is bypassed under emulated offline. Chromium covers the
  // offline path.
  // eslint-disable-next-line playwright/no-skipped-test -- see above.
  test.skip(browserName === 'firefox', 'Playwright Firefox offline mode bypasses service workers')
  // The service worker intercepts both the same-origin /api/messages path
  // (the e2e/dev Vite middleware's legacy adapter) and the cross-origin
  // messages-api Worker path (production), so the recent-mail offline cache
  // is live.

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

  const onlineThreadBody = await page.evaluate(async () => {
    const response = await fetch('/api/messages?resource=thread-body&id=fixture-1')
    return response.json()
  })
  const onlineBody = await page.evaluate(async () => {
    const response = await fetch('/api/messages?id=fixture-1')
    return response.json()
  })
  expect(onlineBody.body_text).toContain('updated design')
  expect(onlineBody.thread).toBeInstanceOf(Array)
  expect(onlineThreadBody).toEqual({ body_text: onlineBody.body_text })

  await expect
    .poll(() =>
      page.evaluate(async () => {
        const cache = await caches.open('cookie-recent-mail-v3')
        return (await cache.keys()).length
      }),
    )
    .toBe(2)

  await context.setOffline(true)
  try {
    const offlineBody = await page.evaluate(async () => {
      const response = await fetch('/api/messages?id=fixture-1')
      return response.json()
    })
    expect(offlineBody.body_text).toBe(onlineBody.body_text)
    expect(offlineBody.thread).toEqual(onlineBody.thread)

    const offlineThreadBody = await page.evaluate(async () => {
      const response = await fetch('/api/messages?resource=thread-body&id=fixture-1')
      return response.json()
    })
    expect(offlineThreadBody).toEqual(onlineThreadBody)

    await page.reload()
    await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeVisible()
  } finally {
    await context.setOffline(false)
  }
})
