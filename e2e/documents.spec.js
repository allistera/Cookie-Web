import { readFile } from 'node:fs/promises'
import { expect, test } from './workerFixtures.js'

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
  await treeRow.getByRole('button', { name: 'Delete Meeting notes' }).click()
  await expect(page).toHaveURL(/\/documents$/)
  await expect(
    page.locator('.documents-sidebar .doc-item', { hasText: 'Meeting notes' }),
  ).toHaveCount(0)
})

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
  await insertMenu.locator('.ce-popover-item', { hasText: 'Table' }).click()
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
  const paragraph = page.locator('.document-template-editor-surface .ce-paragraph').first()
  await paragraph.fill('Agenda and attendees')

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

  // Deleting the folder returns its documents to the root.
  const readingList = sidebar.locator('.folder-item', { hasText: 'Reading list' })
  await readingList.hover()
  await readingList.getByRole('button', { name: 'Delete Reading list' }).click()
  await expect(sidebar.locator('.folder-item', { hasText: 'Reading list' })).toHaveCount(0)
  await expect(sidebar.locator('.doc-item', { hasText: 'Scratchpad' })).toBeVisible()
})

test('The header search from Documents finds documents by content on the /search page', async ({
  page,
}) => {
  await page.goto('/documents')

  const dashboard = page.locator('.documents-table')
  await expect(dashboard.getByText('Floor plan notes')).toBeVisible()
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
    await insertMenu.locator('.ce-popover-item', { hasText: 'Table' }).click()
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
