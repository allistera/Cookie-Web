import { test, expect } from './workerFixtures.js'

import { SEND_API_URL } from '../src/lib/apiWorkers.js'

// The fixture AI Worker (scripts/localApi/plugin.js) continues "Thanks for"
// with " your email." and offers nothing for any other text.

async function openComposer(page) {
  await page.goto('/')
  await page.locator('.compose-btn').click()
  const composer = page.locator('#composerToast')
  await composer.locator('.composer-to-inline').fill('person@example.com')
  const editor = composer.locator('.composer-editor')
  await editor.click()
  return { composer, editor }
}

test('the composer suggests the next words and Tab writes them', async ({ page }) => {
  const { editor } = await openComposer(page)

  await page.keyboard.type('Thanks for')
  const suggestion = editor.locator('.composer-ghost')
  await expect(suggestion).toHaveAttribute('data-suggestion', ' your email.')
  // Shown after the caret, but not yet part of the message.
  await expect(editor).toHaveText('Thanks for')

  await page.keyboard.press('Tab')

  await expect(editor).toHaveText('Thanks for your email.')
  await expect(suggestion).toHaveCount(0)
  // Tab wrote the words; it did not move focus on to the next control.
  await expect(editor).toBeFocused()
  await page.keyboard.type(' Speak soon.')
  await expect(editor).toHaveText('Thanks for your email. Speak soon.')
})

test('a suggestion that is not accepted never reaches the sent message', async ({ page }) => {
  let sendRequestBody
  await page.route(`${SEND_API_URL}/send`, async (route) => {
    sendRequestBody = route.request().postDataJSON()
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ id: 'sent-fixture' }),
    })
  })
  const { composer, editor } = await openComposer(page)

  await page.keyboard.type('Thanks for')
  const suggestion = editor.locator('.composer-ghost')
  await expect(suggestion).toHaveAttribute('data-suggestion', ' your email.')

  // Typing the suggestion's own letters keeps what is left of it on show.
  await page.keyboard.type(' y')
  await expect(suggestion).toHaveAttribute('data-suggestion', 'our email.')
  // Anything else puts it away.
  await page.keyboard.type('esterday')
  await expect(suggestion).toHaveCount(0)

  // Send with a new suggestion on show: the words stay out of the message.
  await page.keyboard.press('Enter')
  await page.keyboard.type('Thanks for')
  await expect(suggestion).toHaveAttribute('data-suggestion', ' your email.')
  await composer.locator('.composer-footer .composer-send-btn').click()

  // The request goes out once the undo countdown has run.
  await expect
    .poll(() => sendRequestBody?.text, { timeout: 15_000 })
    .toContain('Thanks for yesterday')
  expect(sendRequestBody.text).not.toContain('your email')
  expect(sendRequestBody.html).not.toContain('your email')
  expect(sendRequestBody.html).not.toContain('composer-ghost')
})

test('Escape puts a suggestion away and leaves the composer open', async ({ page }) => {
  const { composer, editor } = await openComposer(page)

  await page.keyboard.type('Thanks for')
  const suggestion = editor.locator('.composer-ghost')
  await expect(suggestion).toHaveCount(1)

  await page.keyboard.press('Escape')

  await expect(suggestion).toHaveCount(0)
  await expect(composer).toHaveClass(/active/)
  await expect(editor).toHaveText('Thanks for')
})

test('the reply box suggests the next words too', async ({ page }) => {
  await page.goto('/inbox?open=fixture-1')
  await page.locator('.ni-email-card [title="Reply"]').click()
  const editor = page.locator('.ni-reply-box .composer-editor')
  await editor.click()

  await page.keyboard.type('Thanks for')
  await expect(editor.locator('.composer-ghost')).toHaveAttribute('data-suggestion', ' your email.')
  await page.keyboard.press('Tab')

  await expect(editor).toHaveText('Thanks for your email.')
})
