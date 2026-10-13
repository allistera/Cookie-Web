import { expect, test } from './workerFixtures.js'

import {
  DRAFTS_API_URL,
  EMAILS_API_URL,
  LABELS_API_URL,
  MESSAGES_API_URL,
  TASKS_API_URL,
} from '../src/lib/apiWorkers.js'

// Every Worker the inbox talks to at boot. Aborting them stands in for a
// lost connection: the dev server still serves the page itself (the service
// worker is not registered in e2e mode), the stores fall back to IndexedDB,
// and the flag change waits in the outbox. This path does not depend on the
// service worker, so unlike service-worker.spec.js it runs on every browser.
const WORKER_ORIGINS = [
  EMAILS_API_URL,
  LABELS_API_URL,
  MESSAGES_API_URL,
  DRAFTS_API_URL,
  TASKS_API_URL,
]

async function cutWorkersOff(page) {
  for (const origin of WORKER_ORIGINS) {
    await page.route(`${origin}/**`, (route) => route.abort('failed'))
  }
}

async function restoreWorkers(page) {
  for (const origin of WORKER_ORIGINS) await page.unroute(`${origin}/**`)
}

const readOfflineStore = (page, storeName) =>
  page.evaluate(
    (name) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('cookie-offline')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result
          const keys = db.transaction(name).objectStore(name).getAllKeys()
          keys.onsuccess = () => {
            db.close()
            resolve(keys.result.map(String))
          }
          keys.onerror = () => reject(keys.error)
        }
      }),
    storeName,
  )

test('the inbox and a star made offline survive the Workers being unreachable', async ({
  page,
}) => {
  // Online first, so the inbox and Starred pages are cached.
  await page.goto('/inbox?filter=starred')
  await expect(page.locator('.ni-row', { hasText: "Homeowner's Insurance" })).toBeVisible()
  await page.locator('.nav-item', { hasText: 'Inbox' }).click()
  const row = page.locator('.ni-row', { hasText: 'City Construction' })
  await expect(row).toBeVisible()
  await expect
    .poll(() => readOfflineStore(page, 'cache'))
    .toContainEqual(expect.stringMatching(/:inbox:page$/))

  await cutWorkersOff(page)
  await page.reload()

  // The list comes from the cache, with the banner saying why.
  await expect(row).toBeVisible()
  await expect(
    page.getByText('You are offline. Showing what was saved on this device.'),
  ).toBeVisible()
  await expect(page.locator('.toast', { hasText: 'Failed to load inbox' })).toHaveCount(0)

  // Starring queues the change instead of failing: the row leaves the inbox
  // the way a confirmed star would (starred mail lives in Starred).
  await row.hover()
  await row.locator('[title="Star"]').click()
  await expect(row).toHaveCount(0)
  await expect(page.getByText('1 change will sync when you are back online.')).toBeVisible()
  await expect(page.locator('.toast', { hasText: 'Failed to update starred state' })).toHaveCount(0)

  // Another offline start lays the queued star over the cached page, so the
  // row stays out of the inbox while the rest of the page is still there.
  await page.reload()
  await expect(page.getByRole('tab', { name: /^Other/ })).toContainText('11')
  await expect(row).toHaveCount(0)
  expect(await readOfflineStore(page, 'outbox')).toHaveLength(1)

  // Starred offline shows its cached page too.
  await page.locator('.nav-item', { hasText: 'Starred' }).click()
  await expect(page).toHaveURL(/filter=starred/)
  await expect(page.locator('.ni-row', { hasText: "Homeowner's Insurance" })).toBeVisible()
  await expect(page.locator('.toast', { hasText: 'Failed to load' })).toHaveCount(0)

  // Back online: the queued PATCH goes out and the banner goes.
  await restoreWorkers(page)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(page.getByText('You are offline', { exact: false })).toBeHidden()
  await expect.poll(() => readOfflineStore(page, 'outbox')).toHaveLength(0)

  // The server now holds the star: a plain reload lists the mail in Starred.
  await page.reload()
  await expect(page.locator('.ni-row', { hasText: "Homeowner's Insurance" })).toBeVisible()
  await expect(row).toBeVisible()
})
