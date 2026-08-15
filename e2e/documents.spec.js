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
  await page.getByRole('button', { name: /Blank document/ }).click()
  await expect(page).toHaveURL(/\/documents\/stub-doc-/)
  const title = page.locator('.document-title')
  await title.click()
  await title.pressSequentially('Meeting notes')
  await page.locator('.codex-editor .ce-paragraph').first().click()
  await page.keyboard.type('Agenda for Thursday.')

  // Explicit tags are normalized, autosaved, and immediately join the
  // sidebar's Tags section.
  const tagPatch = page.waitForResponse(
    (response) =>
      response.url().includes('resource=documents') &&
      response.request().method() === 'PATCH' &&
      (response.request().postData() || '').includes('"tags":["meeting"]'),
  )
  await page.getByLabel('Add document tag').fill('#Meeting')
  await page.getByRole('button', { name: 'Add tag' }).click()
  await tagPatch
  await expect(sidebar.getByRole('link', { name: '#meeting, 1 document' })).toBeVisible()

  // "/" opens the block menu; the Date entry stamps today's date as text.
  const { formatInsertedDate } = await import('../src/lib/documentDates.js')
  await page.locator('.codex-editor .ce-paragraph').first().click()
  await page.keyboard.press('End')
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
  await expect(page.getByRole('button', { name: 'Remove #meeting' })).toBeVisible()

  // Tags navigate to a filtered dashboard and can be cleared without losing
  // the document's tag.
  await sidebar.getByRole('link', { name: '#meeting, 1 document' }).click()
  await expect(page).toHaveURL(/\/documents\?tag=meeting$/)
  await expect(page.locator('.documents-table-row', { hasText: 'Meeting notes' })).toBeVisible()
  await expect(page.locator('.documents-table-row', { hasText: 'Scratchpad' })).toHaveCount(0)
  await page.getByRole('link', { name: 'Clear tag' }).click()
  await sidebar.locator('.documents-tree .doc-item', { hasText: 'Meeting notes' }).click()
  await expect(page.locator('.document-title')).toHaveText('Meeting notes')
  const removeTagPatch = page.waitForResponse(
    (response) =>
      response.url().includes('resource=documents') &&
      response.request().method() === 'PATCH' &&
      (response.request().postData() || '').includes('"tags":[]'),
  )
  await page.getByRole('button', { name: 'Remove #meeting' }).click()
  await removeTagPatch
  await expect(sidebar.getByRole('link', { name: '#meeting, 1 document' })).toHaveCount(0)

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

test('A settings template can create a pre-filled independent document', async ({ page }) => {
  await page.goto('/settings/document-templates')

  await expect(page.getByRole('heading', { name: 'Templates', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'New template' }).click()
  await page.locator('.document-title').fill('Weekly meeting')
  const paragraph = page.locator('.document-template-editor-surface .ce-paragraph').first()
  await paragraph.fill('Agenda and attendees')

  const templateResponse = page.waitForResponse(
    (response) =>
      response.url().includes('resource=documents') &&
      response.request().method() === 'POST' &&
      (response.request().postData() || '').includes('"kind":"template"'),
  )
  await page.getByRole('button', { name: 'Save template' }).click()
  await templateResponse
  await expect(page.locator('.document-template-row', { hasText: 'Weekly meeting' })).toBeVisible()

  await page.goto('/documents')
  await expect(page.getByRole('link', { name: '#home, 1 document' })).toBeVisible()
  await page.locator('.new-doc-button').click()
  await page.getByRole('button', { name: /Weekly meeting/ }).click()

  await expect(page).toHaveURL(/\/documents\/stub-doc-/)
  await expect(page.locator('.document-title')).toHaveText('Weekly meeting')
  await expect(page.getByText('Agenda and attendees')).toBeVisible()
})

test('Template settings and the document picker remain usable on a narrow screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/settings/document-templates')

  await expect(page.getByRole('button', { name: 'New template' })).toBeVisible()
  await page.getByRole('button', { name: 'New template' }).click()
  await expect(page.getByRole('button', { name: 'Save template' })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()

  await page.goto('/documents')
  await page.locator('.new-doc-button').click()
  const dialog = page.getByRole('dialog', { name: 'New document' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: /Blank document/ })).toBeVisible()
  await expect(dialog.getByRole('link', { name: 'Manage templates' })).toBeVisible()

  await page.getByRole('button', { name: 'Close new document dialog' }).click()
  await page.goto('/documents/stub-doc-floor-plan')
  await expect(page.getByRole('button', { name: 'Remove #home' })).toBeVisible()
  await expect(page.getByLabel('Add document tag')).toBeVisible()
})

test('An Excalidraw drawing can be inserted from the document slash menu and persists', async ({
  page,
}) => {
  await page.goto('/documents')
  await page.locator('.new-doc-button').click()
  await page.getByRole('button', { name: /Blank document/ }).click()

  const paragraph = page.locator('.codex-editor .ce-paragraph').first()
  await paragraph.click()
  await page.keyboard.type('/')
  const popover = page.locator('.ce-popover--opened .ce-popover__container')
  await expect(popover).toBeVisible()

  const inserted = page.waitForResponse(
    (response) =>
      response.url().includes('resource=documents') &&
      response.request().method() === 'PATCH' &&
      (response.request().postData() || '').includes('"type":"excalidraw"'),
  )
  await popover.locator('.ce-popover-item', { hasText: 'Excalidraw' }).click()

  const drawing = page.getByRole('region', { name: 'Excalidraw drawing, empty' })
  await expect(drawing).toBeVisible()
  await expect(drawing.locator('.excalidraw-block__canvas')).toBeVisible()
  await inserted

  const drawingSaved = page.waitForResponse(
    (response) =>
      response.url().includes('resource=documents') &&
      response.request().method() === 'PATCH' &&
      (response.request().postData() || '').includes('"type":"rectangle"'),
  )
  await drawing.locator('[data-testid="toolbar-rectangle"] + .ToolIcon__icon').click()
  const canvas = drawing.locator('canvas').last()
  const box = await canvas.boundingBox()
  await page.mouse.move(box.x + 120, box.y + 100)
  await page.mouse.down()
  await page.mouse.move(box.x + 260, box.y + 190, { steps: 5 })
  await page.mouse.up()

  await expect(page.getByRole('region', { name: 'Excalidraw drawing, 1 element' })).toBeVisible()
  await drawingSaved
  await page.reload()
  await expect(page.getByRole('region', { name: 'Excalidraw drawing, 1 element' })).toBeVisible()
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

test('The header search finds documents by content and filters, without disturbing the sidebar tree', async ({
  page,
}) => {
  await page.goto('/documents')

  const searchInput = page.locator('#docSearchBarContainer .search-input')
  await expect(searchInput).toBeVisible()

  const dashboard = page.locator('.documents-table')
  await expect(dashboard.getByText('Floor plan notes')).toBeVisible()
  await expect(dashboard.getByText('Scratchpad')).toBeVisible()

  // Type-ahead matches a word from the body, not just the title.
  await searchInput.fill('bay window')
  await expect(dashboard.getByText('Floor plan notes')).toBeVisible()
  await expect(dashboard.getByText('Scratchpad')).toHaveCount(0)
  // The sidebar's folder tree is unaffected by an active search.
  const sidebar = page.locator('.documents-sidebar')
  await expect(sidebar.getByText('Kitchen Renovation')).toBeVisible()
  await expect(sidebar.getByText('Scratchpad')).toBeVisible()

  // Clearing restores the full dashboard.
  await page.locator('#docSearchBarContainer .search-clear-icon').click()
  await expect(searchInput).toHaveValue('')
  await expect(dashboard.getByText('Scratchpad')).toBeVisible()

  // tag: and is:starred filters.
  await searchInput.fill('tag:notes')
  await searchInput.press('Enter')
  await expect(dashboard.getByText('Scratchpad')).toBeVisible()
  await expect(dashboard.getByText('Floor plan notes')).toHaveCount(0)

  await searchInput.fill('is:starred')
  await searchInput.press('Enter')
  await expect(dashboard.getByText('Floor plan notes')).toBeVisible()
  await expect(dashboard.getByText('Scratchpad')).toHaveCount(0)

  // A query matching nothing shows the empty state, not a stale list.
  await searchInput.fill('xyznotfound')
  await expect(page.getByText('No documents')).toBeVisible()

  // Navigating to a document leaves search mode.
  await searchInput.fill('floor')
  await dashboard.getByText('Floor plan notes').click()
  await expect(page).toHaveURL(/\/documents\/stub-doc-floor-plan$/)
  await expect(searchInput).toHaveValue('')
})
