import { expect, test } from './workerFixtures.js'

test('Docs has an Email attachments folder listing received and sent files', async ({ page }) => {
  await page.goto('/documents')

  // Pinned first in the root of Documents, and linked from the sidebar.
  const folder = page.locator('.browser-item[data-kind="email-attachments"]')
  await expect(folder).toContainText('Email attachments')
  await expect(page.locator('.browser-item').first()).toHaveAttribute(
    'data-kind',
    'email-attachments',
  )
  await folder.dblclick()
  await expect(page).toHaveURL(/\/documents\?folder=email-attachments$/)
  await expect(page.locator('.documents-sidebar .email-attachments-item')).toHaveClass(/active/)

  const library = page.getByTestId('email-attachments')
  const rows = library.locator('.attachment-row')
  // Six files; the logo inside an email's body is left out.
  await expect(rows).toHaveCount(6)
  await expect(rows.filter({ hasText: 'image001.png' })).toHaveCount(0)
  await expect(library.locator('.attachments-month-heading')).toHaveCount(3)
  const plan = rows.filter({ hasText: 'Revised-Floor-Plan.pdf' })
  await expect(plan).toContainText('Received')
  await expect(plan).toContainText('From City Construction · Revised Floor Plan')
  await expect(plan.locator('.attachment-kind')).toHaveText('PDF')
  await expect(plan.locator('.attachment-size')).toHaveText('240.0 KB')
  await expect(rows.filter({ hasText: 'Signed-Contract.pdf' })).toContainText(
    'To Sam Carter and 2 others',
  )

  // One side of the mailbox at a time.
  await library.getByRole('button', { name: 'Sent', exact: true }).click()
  await expect(rows).toHaveCount(2)
  await expect(rows.filter({ hasText: 'bay-window.jpg' })).toBeVisible()
  await library.getByRole('button', { name: 'Received', exact: true }).click()
  await expect(rows).toHaveCount(4)
  await expect(rows.filter({ hasText: 'Signed-Contract.pdf' })).toHaveCount(0)

  // Pictures from email bodies on request.
  await library.getByLabel('Show pictures from email bodies').check()
  await expect(rows).toHaveCount(5)
  await expect(rows.filter({ hasText: 'image001.png' }).locator('.attachment-kind')).toHaveText(
    'Picture in email',
  )

  // A file whose bytes were never stored is listed but cannot be downloaded.
  await expect(
    rows.filter({ hasText: 'Site-Survey.pdf' }).getByRole('button', { name: /was not stored/ }),
  ).toBeDisabled()

  // The breadcrumb leads back to the rest of Documents.
  await library.getByRole('link', { name: 'Documents' }).click()
  await expect(page).toHaveURL(/\/documents$/)
  await expect(folder).toBeVisible()
})

test('a file in Email attachments downloads, and its email opens in the reader', async ({
  page,
}) => {
  await page.goto('/documents?folder=email-attachments')
  const plan = page
    .getByTestId('email-attachments')
    .locator('.attachment-row', { hasText: 'Revised-Floor-Plan.pdf' })

  const downloading = page.waitForEvent('download')
  await plan.getByRole('button', { name: 'Download Revised-Floor-Plan.pdf' }).click()
  expect((await downloading).suggestedFilename()).toBe('Revised-Floor-Plan.pdf')

  await plan.getByRole('button', { name: 'Open the email with Revised-Floor-Plan.pdf' }).click()
  await expect(page).toHaveURL(/\/inbox$/)
  await expect(page.locator('.ni-attachment', { hasText: 'Revised-Floor-Plan.pdf' })).toBeVisible()
})
