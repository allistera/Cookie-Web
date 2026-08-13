import { expect, test } from '@playwright/test'

test('The app switcher opens Documents: tree, editor with autosave, and starring all work', async ({
  page,
}) => {
  await page.goto('/')

  // Documents joins Email and Calendar in the header app switcher.
  const trigger = page.getByRole('button', { name: 'Switch Cookie app' })
  await trigger.hover()
  const documentsLink = page.getByRole('menuitem', { name: 'Documents' })
  await expect(documentsLink).toBeVisible()
  await documentsLink.click()

  await expect(page).toHaveURL(/\/documents$/)
  await expect(page.locator('.logo-suffix')).toHaveText('Documents')
  // The mail search bar belongs to the Email app only.
  await expect(page.locator('#searchBarContainer')).toHaveCount(0)

  // The left sidebar shows the fixture folder tree with its nested doc.
  const sidebar = page.locator('.documents-sidebar')
  await expect(sidebar.getByText('Projects')).toBeVisible()
  await expect(sidebar.getByText('Kitchen Renovation')).toBeVisible()
  await expect(sidebar.locator('.doc-item', { hasText: 'Floor plan notes' })).toHaveCount(2) // starred + tree
  await expect(sidebar.locator('.doc-item', { hasText: 'Scratchpad' })).toBeVisible()

  // Collapsing a folder hides its subtree.
  const projects = sidebar.locator('.folder-item', { hasText: 'Projects' }).first()
  await projects.click()
  await expect(sidebar.getByText('Kitchen Renovation')).toBeHidden()
  await projects.click()
  await expect(sidebar.getByText('Kitchen Renovation')).toBeVisible()

  // The dashboard lists documents; opening one loads its blocks.
  await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible()
  await page.locator('.documents-table-row', { hasText: 'Floor plan notes' }).click()
  await expect(page).toHaveURL(/\/documents\/stub-doc-floor-plan$/)
  await expect(page.locator('.document-title')).toHaveText('Floor plan notes')
  await expect(page.getByText('Bay window dimensions')).toBeVisible()

  // A new document autosaves its typed title and body.
  await sidebar.getByRole('button', { name: 'New doc', exact: true }).click()
  await expect(page).toHaveURL(/\/documents\/stub-doc-/)
  const title = page.locator('.document-title')
  await title.click()
  await title.pressSequentially('Meeting notes')
  await page.locator('.codex-editor .ce-paragraph').first().click()
  await page.keyboard.type('Agenda for Thursday.')

  // "/" opens the block menu; the Date entry stamps today's date as text.
  const { formatInsertedDate } = await import('../src/lib/documentDates.js')
  await page.keyboard.press('Enter')
  // The "/" must land focused in the new, still-empty block — typed against
  // the old block it is literal text and no menu opens. The outer .ce-popover
  // element is zero-sized; the sized, visible part is its __container.
  await expect(page.locator('.codex-editor .ce-paragraph')).toHaveCount(2)
  await page.locator('.codex-editor .ce-paragraph').nth(1).click()
  await page.keyboard.type('/')
  const popover = page.locator('.ce-popover--opened .ce-popover__container')
  await expect(popover).toBeVisible()
  const dateText = formatInsertedDate()
  const datePatch = page.waitForResponse(
    (response) =>
      response.url().includes('resource=documents') &&
      response.request().method() === 'PATCH' &&
      (response.request().postData() || '').includes(dateText),
  )
  await popover.locator('.ce-popover-item', { hasText: 'Date' }).click()
  await expect(page.locator('.ce-paragraph', { hasText: dateText })).toBeVisible()
  // The swap must replace only its own placeholder, never neighbouring text.
  await expect(page.getByText('Agenda for Thursday.')).toBeVisible()

  // The reload below proves persistence, so wait for the PATCH that actually
  // carries the date — the status line alone can show a pre-date "saved".
  await datePatch
  await expect(page.locator('.save-status')).toHaveText('All changes saved')

  // The sidebar picked the title up live, and it survives a reload (the
  // fixture backend persists per browser session).
  await expect(sidebar.locator('.doc-item', { hasText: 'Meeting notes' })).toBeVisible()
  await page.reload()
  await expect(page.locator('.document-title')).toHaveText('Meeting notes')
  await expect(page.getByText('Agenda for Thursday.')).toBeVisible()

  // Star it from the tree: it joins the sidebar's Starred section.
  const treeRow = page
    .locator('.documents-tree .doc-item', { hasText: 'Meeting notes' })
    .first()
  await treeRow.hover()
  await treeRow.getByRole('button', { name: 'Star Meeting notes' }).click()
  await expect(
    page.locator('.documents-sidebar .doc-item', { hasText: 'Meeting notes' }),
  ).toHaveCount(2)

  // Delete it from the tree; the editor route falls back to the dashboard.
  await treeRow.hover()
  await treeRow.getByRole('button', { name: 'Delete Meeting notes' }).click()
  await expect(page).toHaveURL(/\/documents$/)
  await expect(
    page.locator('.documents-sidebar .doc-item', { hasText: 'Meeting notes' }),
  ).toHaveCount(0)
})

test('Folders can be created inline and documents dragged between them', async ({ page }) => {
  await page.goto('/documents')

  const sidebar = page.locator('.documents-sidebar')
  await sidebar.getByRole('button', { name: 'New folder', exact: true }).click()
  await sidebar.getByLabel('New folder name').fill('Reading list')
  await sidebar.getByLabel('New folder name').press('Enter')
  await expect(sidebar.locator('.folder-item', { hasText: 'Reading list' })).toBeVisible()

  // Drag Scratchpad from the root into the new folder.
  const scratchpad = sidebar.locator('.doc-item', { hasText: 'Scratchpad' })
  await scratchpad.dragTo(sidebar.locator('.folder-item', { hasText: 'Reading list' }))
  await expect
    .poll(async () =>
      sidebar.locator('.doc-item', { hasText: 'Scratchpad' }).getAttribute('style'),
    )
    .toContain('padding-left: 24px')

  // Deleting the folder returns its documents to the root.
  const readingList = sidebar.locator('.folder-item', { hasText: 'Reading list' })
  await readingList.hover()
  await readingList.getByRole('button', { name: 'Delete Reading list' }).click()
  await expect(sidebar.locator('.folder-item', { hasText: 'Reading list' })).toHaveCount(0)
  await expect(sidebar.locator('.doc-item', { hasText: 'Scratchpad' })).toBeVisible()
})
