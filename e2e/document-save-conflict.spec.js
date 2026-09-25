import { expect, test } from './workerFixtures.js'

// The fixture's PATCH /documents mirrors the Worker's optimistic-concurrency
// check, so an edit made elsewhere — a PATCH straight to the fixture that the
// open page never hears about — makes the page's next autosave come back 409.
test('An autosave that conflicts with an edit made elsewhere is kept and saved as a copy', async ({
  page,
}) => {
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/documents/stub-doc-floor-plan')
  await expect(page.locator('.document-title')).toHaveText('Floor plan notes')

  const fixtureDocuments = new URL('/__e2e__/tasks-api/documents', page.url()).toString()
  const elsewhere = await page.request.patch(fixtureDocuments, {
    data: { id: 'stub-doc-floor-plan', tags: ['edited-elsewhere'] },
  })
  expect(elsewhere.ok()).toBe(true)

  const conflict = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      new URL(response.url()).pathname.endsWith('/documents'),
  )
  await page.locator('.document-title').fill('My conflicting edit')
  expect((await conflict).status()).toBe(409)

  // The edit stays on screen; a plain retry would only conflict again, so the
  // only way forward offered is a copy.
  await expect(page.locator('.save-status')).toContainText('Changed elsewhere')
  await expect(page.locator('.document-title')).toHaveText('My conflicting edit')
  await expect(page.getByRole('button', { name: 'Retry save' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Save a copy' }).click()
  await expect(page).not.toHaveURL(/stub-doc-floor-plan$/)
  await expect(page).toHaveURL(/\/documents\/stub-doc-/)
  await expect(page.locator('.document-title')).toHaveText('My conflicting edit (copy)')
  await expect(page.getByText('Bay window dimensions')).toBeVisible()
  await expect(page.locator('.save-status')).not.toContainText('Changed elsewhere')

  // The other edit won: the original keeps its title and the remote change.
  const original = await page.request.get(`${fixtureDocuments}?id=stub-doc-floor-plan`)
  const { document } = await original.json()
  expect(document.title).toBe('Floor plan notes')
  expect(document.tags).toEqual(['edited-elsewhere'])
  expect(errors).toEqual([])
})
