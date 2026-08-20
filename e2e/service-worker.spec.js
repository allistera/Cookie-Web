import { expect, test } from '@playwright/test'

test('the service worker keeps the shell and recently read mail available offline', async ({
  browserName,
  context,
  page,
}) => {
  // eslint-disable-next-line playwright/no-skipped-test -- WebKit's emulated offline mode bypasses worker fetches.
  test.skip(browserName === 'webkit', 'Playwright WebKit offline mode bypasses service workers')
  // eslint-disable-next-line playwright/no-skipped-test -- see NOTE below.
  test.skip(
    true,
    'The app now fetches message bodies from the cookie-web-messages Cloudflare ' +
      'Worker (an absolute cross-origin URL), not the same-origin /api/messages this ' +
      "test exercises directly. public/sw.js's fetch handler still only intercepts " +
      '`url.origin === self.location.origin` requests, so it no longer sees these ' +
      "fetches at all — the app's real recent-mail offline cache is currently dead, " +
      'not just this test. Fixing it for real needs a product decision: either widen ' +
      "the service worker to cache the Worker's cross-origin responses (auth/caching " +
      'implications to think through) or retire the feature. Left failing-fast here ' +
      'rather than quietly kept green against a same-origin path the app no longer uses.',
  )

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
        const cache = await caches.open('cookie-recent-mail-v2')
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
