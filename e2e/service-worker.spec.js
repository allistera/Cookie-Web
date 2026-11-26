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
  // the cached application shell. The wait before going offline reads this
  // load's resource timing entries; the buffer holds 250 by default, so it is
  // raised to keep a larger module graph checked in full.
  await page.addInitScript(() => performance.setResourceTimingBufferSize(5000))
  await page.reload()
  await expect(page.locator('#traditionalInboxView')).toBeVisible()
  const shellUrls = await page.evaluate(async () => {
    const cache = await caches.open('cookie-shell-v1')
    return (await cache.keys()).map(({ url }) => `${new URL(url).pathname}${new URL(url).search}`)
  })
  expect(shellUrls).toContain('/')
  // Navigations are cached only under '/', never per URL (so Auth0 callback
  // and search URLs never land in the cache); /inbox still loads offline via '/'.
  expect(shellUrls).not.toContain('/inbox')
  // The self-hosted Material Symbols subset is precached at install; without
  // it main.css keeps every icon hidden for an offline start.
  expect(shellUrls).toContain('/fonts/material-symbols-outlined.css')
  expect(shellUrls).toContain('/fonts/material-symbols-outlined.woff2')
  // The reader frame's bridge is kept at the versioned URL it is loaded by.
  expect(shellUrls).toContainEqual(expect.stringMatching(/^\/email-body-bridge\.js\?v=\d+$/))

  const onlineBody = await page.evaluate(async () => {
    const response = await fetch('/api/messages?id=fixture-1')
    return response.json()
  })
  expect(onlineBody.body_text).toContain('updated design')
  expect(onlineBody.thread).toBeInstanceOf(Array)

  await expect
    .poll(() =>
      page.evaluate(async () => {
        const cache = await caches.open('cookie-recent-mail-v3')
        return (await cache.keys()).length
      }),
    )
    .toBe(1)

  // The worker hands an asset to the page before it has finished storing it,
  // so wait until everything this load used is in a cache before cutting the
  // network: the offline reload below needs every one of them.
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const urls = performance
          .getEntriesByType('resource')
          .filter((entry) =>
            ['script', 'link', 'css', 'img', 'other'].includes(entry.initiatorType),
          )
          .map((entry) => new URL(entry.name))
          .filter((url) => url.origin === location.origin && !url.pathname.startsWith('/api/'))
        const cached = await Promise.all(
          urls.map((url) => caches.match(url.href, { ignoreVary: true })),
        )
        return cached.filter((response) => !response).length
      }),
    )
    .toBe(0)

  await context.setOffline(true)
  try {
    const offlineBody = await page.evaluate(async () => {
      const response = await fetch('/api/messages?id=fixture-1')
      return response.json()
    })
    expect(offlineBody.body_text).toBe(onlineBody.body_text)
    expect(offlineBody.thread).toEqual(onlineBody.thread)

    await page.reload()
    await expect(page.locator('#traditionalInboxView')).toBeVisible()
    // Icons come from the precached subset, so they resolve offline rather
    // than staying hidden behind the loading state.
    await expect
      .poll(() => page.locator('html').getAttribute('data-material-symbols'))
      .toBe('loaded')
  } finally {
    await context.setOffline(false)
  }
})
