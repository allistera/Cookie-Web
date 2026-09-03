import { Buffer } from 'node:buffer'

import { test as base } from '@playwright/test'

import {
  AI_API_URL,
  CALENDAR_API_URL,
  DRAFTS_API_URL,
  EMAILS_API_URL,
  SEARCH_API_URL,
  LABELS_API_URL,
  MESSAGES_API_URL,
  RECEIPTS_API_URL,
  TASKS_API_URL,
} from '../src/lib/apiWorkers.js'

// The app talks to nine Cloudflare Workers at absolute cross-origin URLs
// (src/lib/apiWorkers.js). Nothing same-origin can intercept those, and e2e
// mode holds no bearer token, so left alone every one of them reaches the real
// production Worker and 401s — which is what broke 28 of the 64 specs.
//
// Each origin is routed back to the dev/preview server's own fixture handlers
// (the /__e2e__/* mounts in vite.config.js), preserving method, path, query and
// body. Going through the server rather than answering in-process is
// deliberate: /api/emails, /api/search and the Worker handlers all read the
// same per-session fixture state, so a label added through the messages Worker
// has to be visible to the next /api/emails list.
const ORIGINS = [
  [TASKS_API_URL, '/__e2e__/tasks-api'],
  [LABELS_API_URL, '/__e2e__/labels-api'],
  [MESSAGES_API_URL, '/__e2e__/messages-api'],
  [RECEIPTS_API_URL, '/__e2e__/receipts-api'],
  [EMAILS_API_URL, '/__e2e__/emails-api'],
  [AI_API_URL, '/__e2e__/ai-api'],
  [SEARCH_API_URL, '/__e2e__/search-api'],
  [CALENDAR_API_URL, '/__e2e__/calendar-api'],
  [DRAFTS_API_URL, '/__e2e__/drafts-api'],
]

// That server state is keyed by a cookie so parallel workers never share a
// bucket. The browser sends it on same-origin /api/* calls; the proxied
// requests below are made from node, outside the browser's jar, so the same
// value has to be attached by hand — otherwise a test would read one bucket
// and write another.
const SESSION_COOKIE = 'cookie_fixture_session'

export const test = base.extend({
  page: async ({ page, baseURL }, use, testInfo) => {
    const sessionId = `e2e-${testInfo.testId}-${testInfo.repeatEachIndex}-${testInfo.retry}`
    await page.context().addCookies([
      {
        name: SESSION_COOKIE,
        value: sessionId,
        url: baseURL ?? 'http://localhost:5180',
      },
    ])

    for (const [origin, mountPath] of ORIGINS) {
      await page.context().route(`${origin}/**`, async (route) => {
        const request = route.request()
        const { pathname, search } = new URL(request.url())
        const target = `${baseURL}${mountPath}${pathname}${search}`
        const headers = {
          ...request.headers(),
          cookie: `${SESSION_COOKIE}=${sessionId}`,
          // The proxied hop is same-origin from node's point of view; leaving
          // the Worker's Host/Origin on it only confuses the dev server.
          host: new URL(target).host,
          origin: baseURL,
        }
        let response
        try {
          response = await fetch(target, {
            method: request.method(),
            headers,
            body: request.postDataBuffer() ?? undefined,
            redirect: 'manual',
          })
        } catch (error) {
          await route.fulfill({
            status: 502,
            contentType: 'application/json',
            body: JSON.stringify({ error: `Worker fixture proxy failed: ${error.message}` }),
          })
          return
        }
        await route.fulfill({
          status: response.status,
          contentType: response.headers.get('content-type') ?? 'application/json',
          body: Buffer.from(await response.arrayBuffer()),
        })
      })
    }

    await use(page)
  },
})

export { expect } from '@playwright/test'
