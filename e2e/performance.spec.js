import { expect, test } from './workerFixtures.js'
import { TASKS_API_URL } from '../src/lib/apiWorkers.js'

const documents = Array.from({ length: 205 }, (_, i) => ({
  id: `paged-doc-${i}`,
  title: `Paged document ${i}`,
  folder_id: null,
  tags: ['global'],
  starred: false,
  emoji: null,
  updated_at: '2026-01-01T00:00:00Z',
}))

test('Document pages stay bounded and global tags survive navigation', async ({ page }) => {
  await page.route(`${TASKS_API_URL}/documents**`, async (route) => {
    const url = new URL(route.request().url())
    if (url.searchParams.get('view') === 'meta') {
      await route.fulfill({
        json: { folders: [], tags: [{ name: 'global', count: 205 }], version: '1' },
      })
      return
    }
    const offset = Number(url.searchParams.get('before') || 0)
    await route.fulfill({
      json: {
        documents: url.searchParams.has('starred') ? [] : documents.slice(offset, offset + 100),
        nextCursor: offset + 100 < documents.length ? String(offset + 100) : null,
      },
    })
  })
  await page.goto('/documents')
  // The folder browser pages the root the same way the table did.
  const rows = page.locator('.browser-item[data-kind="document"]')
  await expect(rows).toHaveCount(100)
  await expect(
    page.getByRole('link', { name: '#global, 205 documents', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Older documents' }).click()
  await expect(rows).toHaveCount(100)
  await expect(rows.first()).toContainText('Paged document 100')
  await page.getByRole('button', { name: 'Older documents' }).click()
  await expect(rows).toHaveCount(5)
  await page.getByRole('button', { name: 'Newer documents' }).click()
  await expect(rows).toHaveCount(100)
})

test('An older task opens its complete description after paging', async ({ page }) => {
  const tasks = Array.from({ length: 105 }, (_, i) => ({
    id: `paged-task-${i}`,
    content: `Paged task ${i}`,
    description: 'Preview',
    projectId: null,
    parentId: null,
    position: i,
    summary: true,
    priority: 4,
    labels: [],
  }))
  await page.route(`${TASKS_API_URL}/task-items**`, async (route) => {
    const url = new URL(route.request().url())
    if (url.searchParams.get('view') === 'detail') {
      await route.fulfill({
        json: {
          item: {
            ...tasks[104],
            summary: false,
            description: 'Complete description beyond the list preview',
          },
          subtasks: [],
          nextCursor: null,
          counts: { total: 0, done: 0 },
        },
      })
      return
    }
    const offset = Number(url.searchParams.get('after') || 0)
    await route.fulfill({
      json: { items: tasks.slice(offset, offset + 100), nextCursor: offset === 0 ? '100' : null },
    })
  })
  await page.goto('/tasks?project=inbox')
  await expect(page.locator('.task-row')).toHaveCount(100)
  await page.getByRole('button', { name: 'More tasks', exact: true }).click()
  await expect(page.locator('.task-row')).toHaveCount(5)
  await page.locator('.task-open', { hasText: 'Paged task 104' }).click()
  await expect(
    page
      .getByRole('dialog')
      .getByText('Complete description beyond the list preview', { exact: true }),
  ).toBeVisible()
})

test('An offscreen spreadsheet preserves its data on save and mounts when reached', async ({
  page,
}) => {
  const table = { type: 'table', data: { content: [['Keep', '=1+1']], withHeadings: true } }
  let document = {
    ...documents[0],
    id: 'deferred-sheet',
    title: 'Deferred sheet',
    blocks: [
      ...Array.from({ length: 60 }, (_, i) => ({
        type: 'paragraph',
        data: { text: `Paragraph ${i}` },
      })),
      table,
    ],
  }
  await page.route(`${TASKS_API_URL}/documents**`, async (route) => {
    const url = new URL(route.request().url())
    if (route.request().method() === 'PATCH') {
      document = { ...document, ...route.request().postDataJSON() }
      await route.fulfill({ json: { document } })
    } else if (url.searchParams.has('id')) {
      await route.fulfill({ json: { document } })
    } else await route.fulfill({ json: { folders: [], documents: [document] } })
  })
  await page.goto('/documents/deferred-sheet')
  await expect(page.locator('.document-blocks')).toHaveAttribute('aria-busy', 'false')
  const sheet = page.locator('.univer-sheet-block')
  await expect(sheet.locator('.document-block-preview')).toBeAttached()
  await expect(sheet.locator('.univer-sheet-block__canvas')).toHaveCount(0)
  const save = page.waitForRequest(
    (request) =>
      request.method() === 'PATCH' &&
      request.url().includes('/documents') &&
      request.postDataJSON()?.blocks,
  )
  await page.locator('.ce-paragraph').first().fill('Edited paragraph')
  const request = await save
  expect(request.postDataJSON().blocks.find((block) => block.type === 'table').data).toEqual(
    table.data,
  )
  await expect(sheet.locator('.univer-sheet-block__canvas')).toHaveCount(0)
  await sheet.scrollIntoViewIfNeeded()
  await expect
    .poll(() => sheet.evaluate((element) => Boolean(element.__univerAPI)), { timeout: 15000 })
    .toBe(true)
})

test('Plain tables edit and persist without loading the spreadsheet runtime', async ({ page }) => {
  const spreadsheetRequests = []
  page.on('request', (request) => {
    if (/facade-|univer/i.test(request.url())) spreadsheetRequests.push(request.url())
  })
  let document = {
    id: 'basic-table',
    title: 'Simple table',
    folder_id: null,
    tags: [],
    blocks: [
      {
        type: 'table',
        data: {
          content: [
            ['Name', 'Value'],
            ['Before', 'One'],
          ],
        },
      },
    ],
  }
  await page.route(`${TASKS_API_URL}/documents**`, async (route) => {
    if (route.request().method() === 'PATCH')
      document = { ...document, ...route.request().postDataJSON() }
    await route.fulfill({
      json:
        new URL(route.request().url()).searchParams.has('id') ||
        route.request().method() === 'PATCH'
          ? { document }
          : { folders: [], documents: [document] },
    })
  })
  await page.goto('/documents/basic-table')
  await expect(page.locator('.document-blocks')).toHaveAttribute('aria-busy', 'false')
  const cell = page.getByRole('textbox', { name: 'Row 2, column 1', exact: true })
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      response.url().includes('/documents') &&
      response.ok(),
  )
  await cell.fill('After')
  await saved
  await page.reload()
  await expect(cell).toHaveText('After')
  await expect(page.getByRole('button', { name: 'Open spreadsheet', exact: true })).toBeVisible()
  expect(spreadsheetRequests).toEqual([])
  expect(document.blocks[0].data.content[1][0]).toBe('After')
})
