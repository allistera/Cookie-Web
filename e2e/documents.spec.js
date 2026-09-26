import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { expect, test } from './workerFixtures.js'
import { AI_API_URL, TASKS_API_URL } from '../src/lib/apiWorkers.js'

// Picks a "/" menu entry by its exact title: "Table" would otherwise also
// match "Table of contents".
function menuItem(menu, title) {
  return menu.locator('.ce-popover-item').filter({
    has: menu.page().locator('.ce-popover-item__title', { hasText: new RegExp(`^${title}$`) }),
  })
}

// Builds a blank document block by block through the "/" menu.
function blockBuilders(page) {
  const menu = page.locator('.ce-popover--opened .ce-popover__container')
  const paragraphs = page.locator('.codex-editor .ce-paragraph')
  // Editor.js only opens the "/" menu for the block it has made current,
  // which a click does reliably and Enter alone does not.
  async function insert(title) {
    const target = paragraphs.last()
    await target.click()
    await target.pressSequentially('/')
    await expect(menu).toBeVisible()
    await menuItem(menu, title).click()
  }

  async function heading(text) {
    await insert('Heading')
    const header = page.locator('.codex-editor .ce-header').last()
    await expect(header).toBeFocused()
    await page.keyboard.type(text)
    await expect(header).toHaveText(text)
    // Clicking makes the heading Editor.js's current block, so Enter splits
    // it rather than being dropped.
    await header.click()
    await header.press('End')
    await header.press('Enter')
    // Enter at the end of a heading starts a fresh paragraph below it.
    await expect(paragraphs.last()).toBeFocused()
  }

  async function paragraph(text) {
    const target = paragraphs.last()
    await target.click()
    await page.keyboard.type(text)
    await expect(target).toHaveText(text)
    await target.press('End')
    await target.press('Enter')
    await expect(paragraphs.last()).toBeFocused()
  }

  return { insert, heading, paragraph }
}

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
  // The combined header search bar (mail + documents) also shows here.
  await expect(page.locator('.search-bar-container')).toHaveCount(1)

  // The left sidebar shows the fixture folder tree; folders start closed.
  const sidebar = page.locator('.documents-sidebar')
  await expect(sidebar.getByText('Projects')).toBeVisible()
  await expect(sidebar.getByText('Kitchen Renovation')).toBeHidden()
  await expect(sidebar.locator('.doc-item', { hasText: 'Scratchpad' })).toBeVisible()

  // Expanding a folder reveals its subtree; collapsing hides it again.
  const projects = sidebar.locator('.folder-item', { hasText: 'Projects' }).first()
  await projects.click()
  await expect(sidebar.getByText('Kitchen Renovation')).toBeVisible()
  await projects.click()
  await expect(sidebar.getByText('Kitchen Renovation')).toBeHidden()
  await projects.click()
  await expect(sidebar.getByText('Kitchen Renovation')).toBeVisible()

  // Floor plan notes is starred (visible above regardless of tree state) and
  // nested another level down, inside Kitchen Renovation.
  await expect(sidebar.locator('.doc-item', { hasText: 'Floor plan notes' })).toHaveCount(1)
  const kitchen = sidebar.locator('.folder-item', { hasText: 'Kitchen Renovation' }).first()
  await kitchen.click()
  await expect(sidebar.locator('.doc-item', { hasText: 'Floor plan notes' })).toHaveCount(2) // starred + tree

  // The dashboard lists documents; opening one loads its blocks.
  // The dashboard browses one folder at a time and follows the tree: the
  // Kitchen Renovation click above opened that folder, so its document is a
  // card here. Opening one loads its blocks.
  await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible()
  await expect(page.locator('.browser-breadcrumb')).toContainText('Kitchen Renovation')
  await page
    .locator('.browser-item[data-kind="document"]', { hasText: 'Floor plan notes' })
    .dblclick()
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
      response.url().includes('/documents') &&
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
      response.url().includes('/documents') &&
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
  const saveNavigation = page.locator('.editor-save-navigation')
  await expect(saveNavigation.getByRole('link', { name: 'Back to all documents' })).toBeVisible()
  await expect(saveNavigation.getByRole('status')).toHaveText('All changes saved')
  await expect(saveNavigation.getByRole('status')).toHaveAttribute('title', 'All changes saved')
  await expect(saveNavigation.locator('.save-ai-icon')).toBeVisible()
  const statusPosition = await saveNavigation
    .getByRole('button', { name: 'Open document AI' })
    .boundingBox()
  const backPosition = await saveNavigation.getByRole('link').boundingBox()
  expect(statusPosition.x).toBeGreaterThanOrEqual(backPosition.x + backPosition.width)
  expect(statusPosition.x - backPosition.x - backPosition.width).toBeLessThan(12)
  await expect(saveNavigation.getByText('All documents', { exact: true })).toHaveCount(0)

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
      response.url().includes('/documents') &&
      response.request().method() === 'PATCH' &&
      (response.request().postData() || '').includes('"tags":[]'),
  )
  await page.getByRole('button', { name: 'Remove #meeting' }).click()
  await removeTagPatch
  await expect(sidebar.getByRole('link', { name: '#meeting, 1 document' })).toHaveCount(0)

  // Star it from the tree: it joins the sidebar's Starred section.
  const treeRow = page.locator('.documents-tree .doc-item', { hasText: 'Meeting notes' }).first()
  await treeRow.hover()
  await treeRow.getByRole('button', { name: 'Star Meeting notes' }).click()
  await expect(
    page.locator('.documents-sidebar .doc-item', { hasText: 'Meeting notes' }),
  ).toHaveCount(2)

  // Delete it from the tree; the editor route falls back to the dashboard.
  await treeRow.hover()
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toBe(
      'Delete document "Meeting notes"?\n\nThis action cannot be undone.',
    )
    await dialog.accept()
  })
  await treeRow.getByRole('button', { name: 'Delete Meeting notes' }).click()
  await expect(page).toHaveURL(/\/documents$/)
  await expect(
    page.locator('.documents-sidebar .doc-item', { hasText: 'Meeting notes' }),
  ).toHaveCount(0)
})

test('Dashboard document deletion requires confirmation', async ({ page }) => {
  await page.goto('/documents')

  const scratchpad = page.locator('.browser-item[data-kind="document"]', { hasText: 'Scratchpad' })
  const actions = scratchpad.getByRole('button', { name: 'Actions for Scratchpad' })
  const deleteButton = page.locator('.browser-menu button[data-action="delete"]')

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toBe('Delete document "Scratchpad"?\n\nThis action cannot be undone.')
    await dialog.dismiss()
  })
  await actions.click()
  await deleteButton.click()
  await expect(scratchpad).toBeVisible()

  page.once('dialog', async (dialog) => {
    await dialog.accept()
  })
  await actions.click()
  await deleteButton.click()
  await expect(scratchpad).toHaveCount(0)
})

// Editor.js keeps its holder inert until it is ready. Firefox refuses to
// focus inside an inert subtree, so a fill that lands in that window is
// silently dropped — wait for readiness before editing blocks.
async function waitForEditorReady(page) {
  await expect(page.locator('.document-blocks')).toHaveAttribute('aria-busy', 'false')
}

// The table block embeds a full Univer sheet, which renders its grid on
// <canvas> — there is no per-cell DOM node to click or type into. It's driven
// and asserted through Univer's own facade API instead, exposed on the block
// element only in e2e mode (see univerSheetTool.js).
async function waitForSheet(page) {
  await page.waitForFunction(() => document.querySelector('.univer-sheet-block')?.__univerAPI)
}

function readSheetCell(page, ref) {
  return page.evaluate(
    (cellRef) =>
      document
        .querySelector('.univer-sheet-block')
        .__univerAPI.getActiveWorkbook()
        .getActiveSheet()
        .getRange(cellRef)
        .getDisplayValue(),
    ref,
  )
}

test('A table block computes formulas, recalculates on change, and persists across reload', async ({
  page,
}) => {
  await page.goto('/documents/stub-doc-scratchpad')

  const paragraph = page.locator('.codex-editor .ce-paragraph').first()
  await paragraph.click()
  await paragraph.press('End')
  await paragraph.press('Enter')
  const newParagraph = page.locator('.codex-editor .ce-paragraph').last()
  await newParagraph.click()
  await newParagraph.pressSequentially('/')

  const insertMenu = page.locator('.ce-popover--opened .ce-popover__container')
  await expect(insertMenu).toBeVisible()
  await menuItem(insertMenu, 'Table').click()
  await page.getByRole('button', { name: 'Open spreadsheet', exact: true }).click()
  await waitForSheet(page)

  // A brand-new table freezes its header row by default.
  const frozenRows = await page.evaluate(() =>
    document
      .querySelector('.univer-sheet-block')
      .__univerAPI.getActiveWorkbook()
      .getActiveSheet()
      .getFrozenRows(),
  )
  expect(frozenRows).toBe(1)

  await page.evaluate(() => {
    const sheet = document
      .querySelector('.univer-sheet-block')
      .__univerAPI.getActiveWorkbook()
      .getActiveSheet()
    sheet.getRange('A1:B2').setValues([
      ['10', '5'],
      ['=A1+B1', '=A1/B1'],
    ])
  })

  await expect.poll(() => readSheetCell(page, 'A2')).toBe('15')
  await expect.poll(() => readSheetCell(page, 'B2')).toBe('2')

  // Changing an input cell recalculates the cells that reference it. The
  // formula string itself ("=A1+B1") is present in every save from here on,
  // so matching on it alone can resolve on an earlier, still-stale save —
  // wait for the specific PATCH whose saved A1 value is the new one (20).
  const formulaPatch = page.waitForResponse((response) => {
    if (!response.url().includes('/documents') || response.request().method() !== 'PATCH')
      return false
    try {
      const tableBlock = response
        .request()
        .postDataJSON()
        ?.blocks?.find((block) => block.type === 'table')
      const sheets = tableBlock?.data?.workbook?.sheets
      const sheetId = tableBlock?.data?.workbook?.sheetOrder?.[0]
      return sheets?.[sheetId]?.cellData?.[0]?.[0]?.v === 20
    } catch {
      return false
    }
  })
  await page.evaluate(() => {
    document
      .querySelector('.univer-sheet-block')
      .__univerAPI.getActiveWorkbook()
      .getActiveSheet()
      .getRange('A1')
      .setValues([['20']])
  })
  await expect.poll(() => readSheetCell(page, 'A2')).toBe('25')
  await formulaPatch
  await expect(page.locator('.save-status')).toHaveText('All changes saved')

  // The formula itself, not just its last computed value, survives a reload.
  await page.reload()
  await waitForSheet(page)
  await expect.poll(() => readSheetCell(page, 'A2')).toBe('25')
  const formula = await page.evaluate(() =>
    document
      .querySelector('.univer-sheet-block')
      .__univerAPI.getActiveWorkbook()
      .getActiveSheet()
      .getRange('A2')
      .getFormula(),
  )
  expect(formula).toBe('=A1+B1')
})

test('A settings template can create a pre-filled independent document', async ({ page }) => {
  await page.goto('/settings/document-templates')

  await expect(page.getByRole('heading', { name: 'Templates', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'New template' }).click()
  await page.locator('.document-title').fill('Weekly meeting')
  // The editor holder stays inert until Editor.js is ready; a fill before
  // then is silently dropped and the template saves empty.
  await expect(page.locator('.document-template-editor-surface .document-blocks')).toHaveAttribute(
    'aria-busy',
    'false',
  )
  const paragraph = page.locator('.document-template-editor-surface .ce-paragraph').first()
  await paragraph.fill('Agenda and attendees')
  await expect(paragraph).toHaveText('Agenda and attendees')

  const templateResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/documents') &&
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
      response.url().includes('/documents') &&
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
      response.url().includes('/documents') &&
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
  const downloadReady = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export to Markdown', exact: true }).click()
  const download = await downloadReady
  const markdown = await readFile(await download.path(), 'utf8')
  expect(markdown).toContain('data:image/png;base64,')
  expect(markdown).not.toContain('[Excalidraw')
})

test('A table of contents lists headings live, jumps to them, and persists', async ({ page }) => {
  await page.goto('/documents')
  await page.locator('.new-doc-button').click()
  await page.getByRole('button', { name: /Blank document/ }).click()
  await expect(page.locator('.document-blocks')).toHaveAttribute('aria-busy', 'false')

  const { insert, heading } = blockBuilders(page)

  await heading('Overview')
  await heading('Details')

  const inserted = page.waitForResponse(
    (response) =>
      response.url().includes('/documents') &&
      response.request().method() === 'PATCH' &&
      (response.request().postData() || '').includes('"type":"toc"'),
  )
  await insert('Table of contents')
  await inserted

  const toc = page.getByRole('navigation', { name: 'Table of contents' })
  await expect(toc.locator('.toc-block__link')).toHaveText(['Overview', 'Details'])

  // Renaming a heading updates the list without a reload.
  const details = page.locator('.codex-editor .ce-header', { hasText: 'Details' })
  const renamed = page.waitForResponse(
    (response) =>
      response.url().includes('/documents') &&
      response.request().method() === 'PATCH' &&
      (response.request().postData() || '').includes('Details and scope'),
  )
  await details.click()
  await details.press('End')
  await page.keyboard.type(' and scope')
  await expect(toc.locator('.toc-block__link')).toHaveText(['Overview', 'Details and scope'])

  // An entry moves the caret to its heading.
  await toc.getByRole('button', { name: 'Overview' }).click()
  await expect(page.locator('.codex-editor .ce-header', { hasText: 'Overview' })).toBeFocused()

  await renamed
  await expect(page.locator('.save-status')).toHaveText('All changes saved')
  await page.reload()
  await expect(
    page.getByRole('navigation', { name: 'Table of contents' }).locator('.toc-block__link'),
  ).toHaveText(['Overview', 'Details and scope'])
})

test('A heading section collapses from the hover toolbar and stays collapsed after reload', async ({
  page,
}) => {
  await page.goto('/documents')
  await page.locator('.new-doc-button').click()
  await page.getByRole('button', { name: /Blank document/ }).click()
  await expect(page.locator('.document-blocks')).toHaveAttribute('aria-busy', 'false')

  const { heading, paragraph } = blockBuilders(page)
  const saved = page.waitForResponse(
    (response) =>
      response.url().includes('/documents') &&
      response.request().method() === 'PATCH' &&
      (response.request().postData() || '').includes('Second section'),
  )
  await heading('First section')
  await paragraph('Hidden when collapsed')
  await heading('Second section')
  await saved

  const body = page.locator('.codex-editor .ce-paragraph', { hasText: 'Hidden when collapsed' })
  const first = page.locator('.codex-editor .ce-header', { hasText: 'First section' })
  const toggle = page.locator('.ce-toolbar__collapse')

  // Paragraphs get no toggle; headings get one left of "+".
  await body.hover()
  await expect(toggle).toBeHidden()
  await first.hover()
  await expect(toggle).toBeVisible()
  await expect(toggle).toHaveAccessibleName('Collapse section')
  const [toggleBox, plusBox] = await Promise.all([
    toggle.boundingBox(),
    page.locator('.ce-toolbar__plus').boundingBox(),
  ])
  expect(toggleBox.x).toBeLessThan(plusBox.x)

  await toggle.click()
  await expect(body).toBeHidden()
  await expect(
    page.locator('.codex-editor .ce-header', { hasText: 'Second section' }),
  ).toBeVisible()
  await expect(toggle).toHaveAccessibleName('Expand section')

  await expect(page.locator('.save-status')).toHaveText('All changes saved')
  await page.reload()
  await expect(page.locator('.document-blocks')).toHaveAttribute('aria-busy', 'false')
  await expect(body).toBeHidden()

  await first.hover()
  await toggle.click()
  await expect(body).toBeVisible()
})

test('Pasted code from an IDE or a Markdown fence becomes a code block with its language', async ({
  page,
}) => {
  await page.goto('/documents')
  await page.locator('.new-doc-button').click()
  await page.getByRole('button', { name: /Blank document/ }).click()
  await expect(page.locator('.document-blocks')).toHaveAttribute('aria-busy', 'false')

  const paragraph = page.locator('.codex-editor .ce-paragraph').last()
  async function paste(data) {
    await paragraph.click()
    await paragraph.evaluate((element, entries) => {
      const clipboardData = new DataTransfer()
      for (const [type, value] of Object.entries(entries)) clipboardData.setData(type, value)
      const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true })
      // Firefox ignores clipboardData in a synthetic event's init dict (a
      // real paste carries it), so attach it directly.
      Object.defineProperty(event, 'clipboardData', { value: clipboardData })
      element.dispatchEvent(event)
    }, data)
  }

  const blocks = page.locator('.codex-editor .code-block')
  const setup = page.locator('.codex-editor .ce-paragraph', { hasText: 'Setup:' })

  // A Markdown fence pasted into a paragraph with text lands after it.
  await paragraph.click()
  await page.keyboard.type('Setup:')
  await paste({ 'text/plain': '```bash\nnpm install\n```' })
  await expect(blocks).toHaveCount(1)
  await expect(blocks.first().locator('select')).toHaveValue('bash')
  await expect(blocks.first().locator('textarea')).toHaveValue('npm install')
  await expect(setup).toHaveCount(1)

  // VS Code's copy (coloured HTML plus its language mode) replaces an empty
  // paragraph rather than leaving it above the code.
  await setup.click()
  await setup.press('End')
  await setup.press('Enter')
  const saved = page.waitForResponse(
    (response) =>
      response.url().includes('/documents') &&
      response.request().method() === 'PATCH' &&
      (response.request().postData() || '').includes('item.price'),
  )
  await paste({
    'text/plain': 'const total = items\n  .map((item) => item.price)',
    'text/html':
      '<div style="font-family: Menlo, monospace; white-space: pre;"><div><span style="color: #569cd6;">const</span> total = items</div><div>  .map((item) =&gt; item.price)</div></div>',
    'vscode-editor-data': JSON.stringify({ mode: 'typescriptreact' }),
  })
  await expect(blocks).toHaveCount(2)
  await expect(blocks.first().locator('select')).toHaveValue('typescript')
  await expect(blocks.first().locator('textarea')).toHaveValue(
    'const total = items\n  .map((item) => item.price)',
  )
  await expect(page.locator('.codex-editor .ce-paragraph')).toHaveCount(1)
  await saved
})

test('A Kanban board can be inserted from the slash menu, edited, and persists', async ({
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
      response.url().includes('/documents') &&
      response.request().method() === 'PATCH' &&
      (response.request().postData() || '').includes('"type":"kanban"'),
  )
  await popover.locator('.ce-popover-item', { hasText: 'Kanban' }).click()
  await inserted

  // The board's accessible name reports live lane/task counts (see
  // kanbanBoardLabel), so it's matched loosely here and asserted separately
  // rather than baked into the locator, which would go stale on every edit.
  const board = page.getByRole('region', { name: /^Kanban board/ })
  await expect(board).toBeVisible()
  await expect(board).toHaveAccessibleName('Kanban board, 3 lanes, 0 tasks')
  const lanes = board.locator('.kanban-lane')
  await expect(lanes).toHaveCount(3)
  await expect(lanes.nth(0).locator('.kanban-lane__title')).toHaveText('Todo')
  await expect(lanes.nth(1).locator('.kanban-lane__title')).toHaveText('In Progress')
  await expect(lanes.nth(2).locator('.kanban-lane__title')).toHaveText('Done')

  // A task in the first lane gets a title and description.
  await lanes.nth(0).locator('.kanban-lane__add-task').click()
  const task = lanes.nth(0).locator('.kanban-task').first()
  await expect(task.locator('.kanban-task__title')).toBeFocused()
  await page.keyboard.type('Write the proposal')
  await task.locator('.kanban-task__description').click()
  await page.keyboard.type('Cover scope, budget, and timeline.')

  // A fourth, user-added lane.
  const savedLane = page.waitForResponse(
    (response) =>
      response.url().includes('/documents') &&
      response.request().method() === 'PATCH' &&
      (response.request().postData() || '').includes('Blocked'),
  )
  await board.locator('.kanban-board__add-lane').click()
  await expect(lanes).toHaveCount(4)
  await expect(lanes.nth(3).locator('.kanban-lane__title')).toBeFocused()
  await page.keyboard.type('Blocked')
  await lanes.nth(3).locator('.kanban-lane__title').blur()
  await savedLane
  await expect(board).toHaveAccessibleName('Kanban board, 4 lanes, 1 task')

  await expect(page.locator('.save-status')).toHaveText('All changes saved')
  await page.reload()

  const reloadedBoard = page.getByRole('region', { name: /^Kanban board/ })
  await expect(reloadedBoard).toHaveAccessibleName('Kanban board, 4 lanes, 1 task')
  const reloadedLanes = reloadedBoard.locator('.kanban-lane')
  await expect(reloadedLanes.nth(3).locator('.kanban-lane__title')).toHaveText('Blocked')
  const reloadedTask = reloadedLanes.nth(0).locator('.kanban-task').first()
  await expect(reloadedTask.locator('.kanban-task__title')).toHaveText('Write the proposal')
  await expect(reloadedTask.locator('.kanban-task__description')).toHaveText(
    'Cover scope, budget, and timeline.',
  )

  // Deleting the task and the extra lane persists too.
  await reloadedTask.hover()
  const taskDeleted = page.waitForResponse(
    (response) =>
      response.url().includes('/documents') &&
      response.request().method() === 'PATCH' &&
      (response.request().postData() || '').includes('"lanes"') &&
      !(response.request().postData() || '').includes('Write the proposal'),
  )
  await reloadedTask.locator('.kanban-task__delete').click()
  await taskDeleted
  await expect(reloadedLanes.nth(0).locator('.kanban-task')).toHaveCount(0)

  await reloadedLanes.nth(3).hover()
  await reloadedLanes.nth(3).locator('.kanban-lane__delete').click()
  await expect(reloadedLanes).toHaveCount(3)
  await expect(reloadedBoard).toHaveAccessibleName('Kanban board, 3 lanes, 0 tasks')
})

test('A Kanban task card can be dragged into another swimlane and persists', async ({ page }) => {
  await page.goto('/documents')
  await page.locator('.new-doc-button').click()
  await page.getByRole('button', { name: /Blank document/ }).click()

  const paragraph = page.locator('.codex-editor .ce-paragraph').first()
  await paragraph.click()
  await page.keyboard.type('/')
  const popover = page.locator('.ce-popover--opened .ce-popover__container')
  await expect(popover).toBeVisible()
  await popover.locator('.ce-popover-item', { hasText: 'Kanban' }).click()

  const board = page.getByRole('region', { name: /^Kanban board/ })
  const lanes = board.locator('.kanban-lane')
  await expect(lanes).toHaveCount(3)

  // One task each in Todo and In Progress, so the drag also proves the
  // destination lane's own existing task isn't disturbed by the drop.
  await lanes.nth(0).locator('.kanban-lane__add-task').click()
  await page.keyboard.type('Write the proposal')
  await lanes.nth(1).locator('.kanban-lane__add-task').click()
  await page.keyboard.type('Review budget')
  await expect(board).toHaveAccessibleName('Kanban board, 3 lanes, 2 tasks')

  // Matching any PATCH carrying "lanes" is not enough — adding the two tasks
  // above sends those too, so this could resolve on a save that predates the
  // drag. The reload below would then race the drag's own still-debounced
  // save and lose it (store.saveState only leaves 'saved' once a request is
  // actually in flight, so "All changes saved" cannot rule that out either).
  // Wait for the save that carries the moved board itself.
  const moved = page.waitForResponse((response) => {
    if (!response.url().includes('/documents')) return false
    if (response.request().method() !== 'PATCH') return false
    let lanes
    try {
      const blocks = JSON.parse(response.request().postData() || '{}').blocks
      lanes = blocks?.find((block) => block.type === 'kanban')?.data?.lanes
    } catch {
      return false
    }
    return lanes?.[0]?.tasks?.length === 0 && lanes?.[1]?.tasks?.length === 2
  })
  const card = lanes.nth(0).locator('.kanban-task', { hasText: 'Write the proposal' })
  await card.dragTo(lanes.nth(1).locator('.kanban-lane__tasks'))
  await moved

  // Where exactly it lands among the destination lane's existing cards is
  // covered precisely at the data level (kanbanBlockTool.spec.js's moveTask
  // tests) - what matters here, in a real browser, is that both cards ended
  // up in the right lane, order aside.
  await expect(lanes.nth(0).locator('.kanban-task')).toHaveCount(0)
  const movedInto = lanes.nth(1).locator('.kanban-task__title')
  await expect(movedInto).toHaveCount(2)
  expect((await movedInto.allTextContents()).sort()).toEqual(
    ['Review budget', 'Write the proposal'].sort(),
  )

  await expect(page.locator('.save-status')).toHaveText('All changes saved')
  await page.reload()

  const reloadedLanes = page.getByRole('region', { name: /^Kanban board/ }).locator('.kanban-lane')
  await expect(reloadedLanes.nth(0).locator('.kanban-task')).toHaveCount(0)
  const reloadedTitles = reloadedLanes.nth(1).locator('.kanban-task__title')
  await expect(reloadedTitles).toHaveCount(2)
  expect((await reloadedTitles.allTextContents()).sort()).toEqual(
    ['Review budget', 'Write the proposal'].sort(),
  )
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
    .poll(async () => sidebar.locator('.doc-item', { hasText: 'Scratchpad' }).getAttribute('style'))
    .toContain('padding-left: 24px')

  // Drag it back out: the empty space below the tree's last row is the root.
  const tree = sidebar.locator('.documents-tree')
  const treeBox = await tree.boundingBox()
  await sidebar
    .locator('.doc-item', { hasText: 'Scratchpad' })
    .dragTo(tree, { targetPosition: { x: 40, y: treeBox.height - 6 } })
  await expect
    .poll(async () => sidebar.locator('.doc-item', { hasText: 'Scratchpad' }).getAttribute('style'))
    .toContain('padding-left: 10px')
  await expect(sidebar.locator('.drop-target')).toHaveCount(0)

  // And into the folder once more, so deleting the folder has something to return.
  await sidebar
    .locator('.doc-item', { hasText: 'Scratchpad' })
    .dragTo(sidebar.locator('.folder-item', { hasText: 'Reading list' }))
  await expect
    .poll(async () => sidebar.locator('.doc-item', { hasText: 'Scratchpad' }).getAttribute('style'))
    .toContain('padding-left: 24px')

  // Deleting the folder returns its documents to the root.
  const readingList = sidebar.locator('.folder-item', { hasText: 'Reading list' })
  await readingList.hover()
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toBe(
      'Delete folder "Reading list" and its subfolders?\n\nDocuments inside will be moved to Documents. This action cannot be undone.',
    )
    await dialog.accept()
  })
  await readingList.getByRole('button', { name: 'Delete Reading list' }).click()
  await expect(sidebar.locator('.folder-item', { hasText: 'Reading list' })).toHaveCount(0)
  await expect(sidebar.locator('.doc-item', { hasText: 'Scratchpad' })).toBeVisible()
})

test('The header search from Documents finds documents by content on the /search page', async ({
  page,
}) => {
  await page.goto('/documents')

  const dashboard = page.locator('.documents-browser')
  await expect(dashboard.getByText('Projects')).toBeVisible()
  await expect(dashboard.getByText('Scratchpad')).toBeVisible()

  // Type-ahead matches a word from the body, not just the title, and lands
  // on the dedicated /search results page rather than filtering the
  // dashboard in place.
  const searchInput = page.locator('.search-input')
  await searchInput.fill('bay window')
  await expect(page).toHaveURL(/\/search\?/)
  await expect(page.locator('.search-result-doc', { hasText: 'Floor plan notes' })).toBeVisible()
  await expect(page.locator('.search-result-doc', { hasText: 'Scratchpad' })).toHaveCount(0)

  // A query matching nothing shows the empty state, not a stale list.
  await searchInput.fill('xyznotfound')
  await expect(page.locator('.search-results-empty')).toContainText('No results')

  // Clicking a result opens that document directly.
  await searchInput.fill('floor')
  await page.locator('.search-result-doc', { hasText: 'Floor plan notes' }).click()
  await expect(page).toHaveURL(/\/documents\/stub-doc-floor-plan$/)
})

test('The default content for new daily notes can be customized in Settings > Documents > Time Management', async ({
  page,
}) => {
  await page.goto('/settings/daily-notes')

  await expect(page.getByRole('heading', { name: 'Time Management', exact: true })).toBeVisible()
  await waitForEditorReady(page)
  // The built-in default is a "Tasks" heading — replace it with custom content.
  const heading = page.locator('.daily-note-editor-surface .ce-header').first()
  await expect(heading).toHaveText('Tasks')
  await heading.fill('Standup notes')

  const saveResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/tasks/daily-note-seed') && response.request().method() === 'PUT',
  )
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await saveResponse
  await expect(page.getByRole('button', { name: 'Reset to default' })).toBeVisible()

  // The Documents sidebar's "Today" shortcut seeds a fresh note with it.
  await page.goto('/documents')
  await page.locator('.time-management-nav').getByRole('button', { name: 'Today' }).click()
  await expect(page).toHaveURL(/\/documents\/stub-doc-/)
  await expect(page.getByText('Standup notes')).toBeVisible()

  // Resetting restores the built-in default for future notes.
  await page.goto('/settings/daily-notes')
  await expect(page.locator('.daily-note-editor-surface .ce-header').first()).toHaveText(
    'Standup notes',
  )
  await page.getByRole('button', { name: 'Reset to default' }).click()
  await expect(page.getByRole('button', { name: 'Reset to default' })).toHaveCount(0)
  await expect(page.locator('.daily-note-editor-surface .ce-header').first()).toHaveText('Tasks')
})

test('A failed autosave keeps the draft open through navigation and can be retried', async ({
  page,
}) => {
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/documents/stub-doc-floor-plan')
  await expect(page.locator('.document-title')).toHaveText('Floor plan notes')
  let failSaves = true
  await page.route('**/documents', async (route) => {
    if (route.request().method() === 'PATCH' && failSaves) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"error":"Temporarily unavailable"}',
      })
    } else {
      await route.fallback()
    }
  })
  await page.locator('.document-title').fill('Draft that must survive')
  await expect(page.getByRole('button', { name: 'Retry save' })).toBeVisible()
  await page.locator('.documents-sidebar .doc-item', { hasText: 'Scratchpad' }).first().click()
  await expect(page).toHaveURL(/stub-doc-floor-plan$/)
  await expect(page.locator('.document-title')).toHaveText('Draft that must survive')
  await page.screenshot({ path: '/tmp/cookie-save-recovery.png' })
  failSaves = false
  await page.getByRole('button', { name: 'Retry save' }).click()
  await expect(page.locator('.save-status')).toHaveText('All changes saved')
  await page.reload()
  await expect(page.locator('.document-title')).toHaveText('Draft that must survive')
  expect(errors).toEqual([])
})

test('Multiple spreadsheet blocks load independently and retain their own values', async ({
  page,
}, testInfo) => {
  test.setTimeout(120000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/documents/stub-doc-scratchpad')
  const timings = []
  for (let index = 0; index < 3; index += 1) {
    const paragraph = page.locator('.codex-editor .ce-paragraph').first()
    await paragraph.click()
    await paragraph.press('Home')
    await paragraph.press('Enter')
    const empty = page.locator('.codex-editor .ce-paragraph').filter({ hasText: /^$/ }).first()
    await empty.click()
    await empty.pressSequentially('/')
    const insertMenu = page.locator('.ce-popover--opened .ce-popover__container')
    const started = performance.now()
    await menuItem(insertMenu, 'Table').click()
    await page.getByRole('button', { name: 'Open spreadsheet', exact: true }).click()
    // Offscreen sheets retain a preview until they enter the viewport.
    for (const sheet of await page.locator('.univer-sheet-block').all()) {
      await sheet.scrollIntoViewIfNeeded()
      await expect
        .poll(() => sheet.evaluate((element) => Boolean(element.__univerAPI)), { timeout: 15000 })
        .toBe(true)
    }
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            [...document.querySelectorAll('.univer-sheet-block')].filter(
              (element) => element.__univerAPI,
            ).length,
        ),
      )
      .toBe(index + 1)
    timings.push(Math.round(performance.now() - started))
  }
  const savedTables = page.waitForResponse((response) => {
    if (
      !response.url().includes('/documents') ||
      response.request().method() !== 'PATCH' ||
      !response.ok()
    )
      return false
    const tables =
      response
        .request()
        .postDataJSON()
        ?.blocks?.filter((block) => block.type === 'table') ?? []
    return (
      tables.length === 3 &&
      tables.every((block, index) => {
        const workbook = block.data?.workbook
        return (
          workbook?.sheets?.[workbook.sheetOrder?.[0]]?.cellData?.[0]?.[0]?.v ===
          `Table ${index + 1}`
        )
      })
    )
  })
  await page.evaluate(() => {
    document.querySelectorAll('.univer-sheet-block').forEach((element, index) => {
      element.__univerAPI
        .getActiveWorkbook()
        .getActiveSheet()
        .getRange('A1')
        .setValue(`Table ${index + 1}`)
    })
  })
  await savedTables
  await expect(page.locator('.save-status')).toHaveText('All changes saved')
  await page.screenshot({ path: '/tmp/cookie-three-tables.png' })
  await page.reload()
  await expect(page.locator('.univer-sheet-block')).toHaveCount(3)
  for (const sheet of await page.locator('.univer-sheet-block').all()) {
    await sheet.scrollIntoViewIfNeeded()
    await expect
      .poll(() => sheet.evaluate((element) => Boolean(element.__univerAPI)), { timeout: 15000 })
      .toBe(true)
  }
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.querySelectorAll('.univer-sheet-block')].map((element) =>
          element.__univerAPI
            ?.getActiveWorkbook()
            .getActiveSheet()
            .getRange('A1')
            .getDisplayValue(),
        ),
      ),
    )
    .toEqual(['Table 1', 'Table 2', 'Table 3'])
  await testInfo.attach('spreadsheet-opening-ms', {
    body: JSON.stringify({
      server: testInfo.project.use.baseURL,
      first: timings[0],
      subsequent: timings.slice(1),
    }),
    contentType: 'application/json',
  })
  expect(errors).toEqual([])
})

test('Document icons autosave alongside title edits and survive reload', async ({ page }) => {
  await page.goto('/documents')
  await page.locator('.documents-sidebar .doc-item', { hasText: 'Scratchpad' }).click()
  const icon = page.getByRole('button', { name: 'Change document icon' })
  await expect(icon).toBeVisible()
  await expect(page.locator('.save-ai-icon')).toBeVisible()
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 })
    const titlePosition = await page.locator('.document-title').boundingBox()
    const iconPosition = await icon.boundingBox()
    expect(iconPosition.x + iconPosition.width).toBeLessThanOrEqual(titlePosition.x)
    expect(titlePosition.x - iconPosition.x - iconPosition.width).toBeLessThanOrEqual(12)
    expect(iconPosition.y).toBeCloseTo(titlePosition.y, 0)
    expect(iconPosition.x + iconPosition.width).toBeLessThanOrEqual(width)
  }

  await page.locator('.document-title').fill('Rocket notes')
  await icon.click()
  await page.getByRole('searchbox', { name: 'Search emoji' }).fill('rocket')
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      response.url().includes('/documents') &&
      (response.request().postData() || '').includes('🚀'),
  )
  await page.getByRole('button', { name: 'rocket', exact: true }).click()
  await saved
  await expect(icon).toHaveText('🚀')
  await expect(
    page.locator('.documents-sidebar .doc-item', { hasText: 'Rocket notes' }).locator('.doc-emoji'),
  ).toHaveText('🚀')
  await page.reload()
  await expect(page.locator('.save-ai-icon')).toBeVisible()
  await expect(page.locator('.document-title')).toHaveText('Rocket notes')
  await expect(icon).toHaveText('🚀')
})

test('A failed document icon save keeps the selection available for retry', async ({ page }) => {
  await page.goto('/documents')
  await page.locator('.documents-sidebar .doc-item', { hasText: 'Scratchpad' }).click()
  await page.route('**/documents', async (route) => {
    if (route.request().method() === 'PATCH') return route.fulfill({ status: 500, body: '{}' })
    return route.fallback()
  })
  const icon = page.getByRole('button', { name: 'Change document icon' })
  await icon.click()
  await page.getByRole('searchbox', { name: 'Search emoji' }).fill('rocket')
  await page.getByRole('button', { name: 'rocket', exact: true }).click()
  await expect(page.locator('.save-status')).toContainText('Save failed')
  await expect(icon).toHaveText('🚀')
  await page.unroute('**/documents')
  await page.getByRole('button', { name: 'Retry save', exact: true }).click()
  await expect(page.locator('.save-status')).toHaveText('All changes saved')
  await page.reload()
  await expect(icon).toHaveText('🚀')
})

test('Document AI slides out on the right and closes with keyboard or button', async ({ page }) => {
  await page.goto('/documents')
  await page.locator('.documents-sidebar .doc-item', { hasText: 'Scratchpad' }).click()
  const toggle = page.getByRole('button', { name: 'Open document AI' })
  const panel = page.getByRole('complementary', { name: 'Document AI' })
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await toggle.click()
    await expect(panel).toBeVisible()
    await expect(panel.getByRole('log', { name: 'AI conversation' })).toBeVisible()
    const composer = panel.getByRole('textbox', { name: 'Message document AI' })
    await expect(composer).toBeVisible()
    // Sending is available once a message is entered.

    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(panel.getByRole('button', { name: 'Close document AI' })).toBeFocused()
    await expect
      .poll(async () => {
        const bounds = await panel.boundingBox()
        return Math.round(bounds.x + bounds.width)
      })
      .toBe(width)
    await composer.fill('Summarise this document')
    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)
    await expect(toggle).toBeFocused()
    await toggle.click()
    await expect(composer).toHaveValue('Summarise this document')
    await panel.getByRole('button', { name: 'Close document AI' }).click()
    await expect(panel).toHaveCount(0)
  }
})

test('Document AI sends the latest draft, previews edits and applies them through autosave', async ({
  page,
}) => {
  let sent
  await page.route(`${AI_API_URL}/document-chat`, async (route) => {
    sent = route.request().postDataJSON()
    await route.fulfill({
      json: {
        reply: 'I made the opening clearer.',
        model: 'gpt-5.6-sol',
        proposal: {
          title: 'Clear notes',
          blocks: [{ type: 'paragraph', data: { text: 'A clearer opening.' } }],
          preview: 'A clearer opening.',
        },
      },
    })
  })
  await page.goto('/documents')
  await page.locator('.documents-sidebar .doc-item', { hasText: 'Scratchpad' }).click()
  await waitForEditorReady(page)
  await page.locator('.document-title').fill('Latest title')
  await page.locator('.codex-editor .ce-paragraph').first().fill('My latest unsaved thought.')
  await page.getByRole('button', { name: 'Open document AI' }).click()
  const panel = page.getByRole('complementary', { name: 'Document AI' })
  await panel.getByRole('textbox', { name: 'Message document AI' }).fill('Make the opening clearer')
  await panel.getByRole('button', { name: 'Send message' }).click()
  await expect(panel.getByText('I made the opening clearer.')).toBeVisible()
  expect(sent.instruction).toBe('Make the opening clearer')
  expect(sent.document.title).toBe('Latest title')
  expect(JSON.stringify(sent.document.blocks)).toContain('My latest unsaved thought.')
  await expect(page.locator('.document-title')).toHaveText('Latest title')
  await panel.getByText('Preview changes').click()
  await expect(panel.locator('pre')).toHaveText('A clearer opening.')
  await panel.getByRole('button', { name: 'Apply changes' }).click()
  await expect(page.locator('.document-title')).toHaveText('Clear notes')
  await expect(page.locator('.codex-editor .ce-paragraph').first()).toHaveText('A clearer opening.')
  await expect(page.locator('.save-status')).toHaveText('All changes saved')
  await page.reload()
  await expect(page.locator('.document-title')).toHaveText('Clear notes')
  await expect(page.locator('.codex-editor .ce-paragraph').first()).toHaveText('A clearer opening.')
})

test('Document AI refuses to overwrite edits made after requesting a suggestion', async ({
  page,
}) => {
  await page.route(`${AI_API_URL}/document-chat`, (route) =>
    route.fulfill({
      json: {
        reply: 'Suggestion ready',
        model: 'gpt-5.6-sol',
        proposal: {
          title: 'Old suggestion',
          blocks: [{ type: 'paragraph', data: { text: 'Old suggestion' } }],
          preview: 'Old suggestion',
        },
      },
    }),
  )
  await page.goto('/documents')
  await page.locator('.documents-sidebar .doc-item', { hasText: 'Scratchpad' }).click()
  await page.getByRole('button', { name: 'Open document AI' }).click()
  const panel = page.getByRole('complementary', { name: 'Document AI' })
  await panel.getByRole('textbox', { name: 'Message document AI' }).fill('Rewrite')
  await panel.getByRole('button', { name: 'Send message' }).click()
  await expect(panel.getByText('Suggestion ready')).toBeVisible()
  await page.locator('.document-title').fill('My newer title')
  await panel.getByRole('button', { name: 'Apply changes' }).click()
  await expect(panel.getByRole('alert')).toContainText('document changed')
  await expect(page.locator('.document-title')).toHaveText('My newer title')
})

test('Document AI supports no document, follow-up context and retry after failure', async ({
  page,
}) => {
  const requests = []
  await page.route(`${AI_API_URL}/document-chat`, async (route) => {
    requests.push(route.request().postDataJSON())
    if (requests.length === 1)
      return route.fulfill({ status: 502, json: { error: 'Please try again' } })
    return route.fulfill({
      json: { reply: 'Here is an answer.', proposal: null, model: 'gpt-5.6-sol' },
    })
  })
  await page.goto('/documents')
  await page.getByRole('button', { name: 'Open document AI' }).click()
  const panel = page.getByRole('complementary', { name: 'Document AI' })
  const input = panel.getByRole('textbox', { name: 'Message document AI' })
  await input.fill('Explain how to write meeting notes')
  await input.press('Enter')
  await expect(panel.getByRole('alert')).toHaveText('Please try again')
  await expect(input).toHaveValue('Explain how to write meeting notes')
  await input.press('Enter')
  await expect(panel.getByText('Here is an answer.')).toBeVisible()
  expect(requests[1].document).toBeNull()
  await input.fill('Make that shorter')
  await input.press('Enter')
  await expect(panel.getByText('Here is an answer.')).toHaveCount(2)
  expect(requests[2].history).toEqual([
    { role: 'user', content: 'Explain how to write meeting notes' },
    { role: 'assistant', content: 'Here is an answer.' },
  ])
})

test('Document AI can create a new document without an attached draft', async ({ page }) => {
  const sent = []
  await page.route(`${AI_API_URL}/document-chat`, (route) => {
    sent.push(route.request().postDataJSON())
    return route.fulfill({
      json: {
        reply: 'Here is a new memo.',
        model: 'gpt-5.6-sol',
        proposal: {
          title: 'AI memo',
          blocks: [{ type: 'paragraph', data: { text: 'New memo content.' } }],
          preview: 'New memo content.',
        },
      },
    })
  })
  await page.goto('/documents')
  await page.getByRole('button', { name: 'Open document AI' }).click()
  const panel = page.getByRole('complementary', { name: 'Document AI' })
  await panel.getByRole('textbox', { name: 'Message document AI' }).fill('Create a memo')
  await panel.getByRole('button', { name: 'Send message' }).click()
  await expect(panel.getByText('Here is a new memo.')).toBeVisible()
  await panel.getByRole('textbox', { name: 'Message document AI' }).fill('Make that shorter')
  await panel.getByRole('button', { name: 'Send message' }).click()
  await expect(panel.getByText('Here is a new memo.')).toHaveCount(2)
  expect(sent[1].history[1].content).toContain('New memo content.')
  expect(sent[1].history[1].content).toContain('Proposed, not yet applied')
  await panel.getByRole('button', { name: 'Create document', exact: true }).last().click()
  await expect(page.locator('.document-title')).toHaveText('AI memo')
  await expect(page.locator('.codex-editor .ce-paragraph').first()).toHaveText('New memo content.')
  await page.reload()
  await expect(page.locator('.codex-editor .ce-paragraph').first()).toHaveText('New memo content.')
})

test('Navigating away cancels Document AI without adding its reply to another document', async ({
  page,
}) => {
  let release
  let started
  const requested = new Promise((resolve) => {
    started = resolve
  })
  const held = new Promise((resolve) => {
    release = resolve
  })
  await page.route(`${AI_API_URL}/document-chat`, async (route) => {
    started()
    await held
    await route.fulfill({
      json: { reply: 'Old document reply', proposal: null, model: 'gpt-5.6-sol' },
    })
  })
  await page.goto('/documents')
  await page.locator('.documents-sidebar .doc-item', { hasText: 'Scratchpad' }).click()
  await page.getByRole('button', { name: 'Open document AI' }).click()
  await page.getByRole('textbox', { name: 'Message document AI' }).fill('Review this')
  await page.getByRole('button', { name: 'Send message' }).click()
  await requested
  await page.getByRole('link', { name: 'Back to all documents', exact: true }).click()
  release()
  await page.getByRole('button', { name: 'Open document AI' }).click()
  const panel = page.getByRole('complementary', { name: 'Document AI' })
  await expect(panel.getByRole('log')).not.toContainText('Old document reply')
  await expect(panel.getByRole('textbox')).toBeEmpty()
  await expect(panel.getByText('No document attached')).toBeVisible()
})

test('AI document creation finishes saving without overriding later navigation', async ({
  page,
}) => {
  let release, started
  const requested = new Promise((resolve) => {
    started = resolve
  })
  const held = new Promise((resolve) => {
    release = resolve
  })
  await page.route(`${AI_API_URL}/document-chat`, (route) =>
    route.fulfill({
      json: {
        reply: 'Proposed memo',
        model: 'test',
        proposal: {
          title: 'AI navigation repro',
          blocks: [{ type: 'paragraph', data: { text: 'Memo' } }],
          preview: 'Memo',
        },
      },
    }),
  )
  await page.route(`${TASKS_API_URL}/documents**`, async (route) => {
    if (route.request().method() === 'POST') {
      started()
      await held
    }
    await route.fallback()
  })
  await page.goto('/documents')
  await page.getByRole('button', { name: 'Open document AI' }).click()
  await page.getByRole('textbox', { name: 'Message document AI' }).fill('Make a memo')
  await page.getByRole('button', { name: 'Send message' }).click()
  await page.getByRole('button', { name: 'Create document', exact: true }).click()
  await requested
  await page.locator('.documents-sidebar .doc-item', { hasText: 'Scratchpad' }).click()
  await expect(page.locator('.document-title')).toHaveText('Scratchpad')
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      response.url().includes('/documents') &&
      response.ok(),
  )
  release()
  await saved
  await expect(
    page.locator('.documents-sidebar .doc-item', { hasText: 'AI navigation repro' }),
  ).toBeVisible()
  await expect(page.locator('.document-title')).toHaveText('Scratchpad')
  await page.locator('.documents-sidebar .doc-item', { hasText: 'AI navigation repro' }).click()
  await expect(page.locator('.codex-editor .ce-paragraph').first()).toHaveText('Memo')
})

test('Files can be uploaded into a folder, switched to list view, previewed and deleted', async ({
  page,
}) => {
  await page.goto('/documents?folder=stub-folder-projects')
  await expect(page.locator('.browser-breadcrumb')).toContainText('Projects')

  await page.locator('input[type="file"]').setInputFiles({
    name: 'brief.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 stub'),
  })
  const card = page.locator('.browser-item[data-kind="file"]', { hasText: 'brief.pdf' })
  await expect(card).toBeVisible()
  await expect(card).toContainText('PDF')

  await page.getByRole('button', { name: 'List view' }).click()
  await expect(page.locator('.documents-browser')).toHaveClass(/layout-list/)
  await expect(card).toContainText('B')
  await page.reload()
  await expect(page.locator('.documents-browser')).toHaveClass(/layout-list/)
  await page.getByRole('button', { name: 'Grid view' }).click()

  await card.dblclick()
  await expect(page).toHaveURL(/\/documents\/file\/stub-file-/)
  await expect(page.locator('.file-preview h1')).toHaveText('brief.pdf')
  await expect(page.locator('.file-preview iframe')).toBeVisible()
  await page.getByRole('button', { name: 'Back to folder' }).click()
  await expect(page).toHaveURL(/\/documents\?folder=stub-folder-projects$/)

  await card.getByRole('button', { name: 'Actions for brief.pdf' }).click()
  page.once('dialog', (dialog) => dialog.accept())
  await page.locator('.browser-menu button[data-action="delete"]').click()
  await expect(card).toHaveCount(0)
})
