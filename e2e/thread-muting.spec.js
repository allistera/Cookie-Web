import { expect, test } from './workerFixtures.js'
import { MESSAGES_API_URL } from '../src/lib/apiWorkers.js'

test('mute survives a reload and can be undone without removing the conversation', async ({
  page,
}) => {
  let muted = false
  const actions = []
  await page.route(`${MESSAGES_API_URL}/messages?*`, (route) =>
    route.fulfill({
      json: {
        thread_id: 'thread-1',
        thread_muted: muted,
        body_text: 'Conversation content',
        thread: [],
        attachments: [],
      },
    }),
  )
  await page.route(`${MESSAGES_API_URL}/messages`, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    const { action } = route.request().postDataJSON()
    actions.push(action)
    muted = action === 'mute_thread'
    await route.fulfill({ json: { thread: { id: 'thread-1', is_muted: muted } } })
  })

  await page.goto('/inbox')
  await page.locator('.ni-row', { hasText: 'City Construction' }).click()
  await page.getByRole('button', { name: 'Mute thread', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Unmute thread', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.reload()
  await page.locator('.ni-row', { hasText: 'City Construction' }).click()
  await page.getByRole('button', { name: 'Unmute thread', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Mute thread', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  await expect(page.locator('.ni-row', { hasText: 'City Construction' })).toBeVisible()
  expect(actions).toEqual(['mute_thread', 'unmute_thread'])
})
