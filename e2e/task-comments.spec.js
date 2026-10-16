import { Buffer } from 'node:buffer'

import { expect, test } from './workerFixtures.js'

// The tasks Worker fixture (scripts/localApi/plugin.js) keeps each task's
// thread per session, so a comment made here survives a reload the way the
// real one does.
const api = '/__e2e__/tasks-api'

test('A task thread takes comments and attachments, which can be edited and deleted', async ({
  page,
}) => {
  const { item } = await (
    await page.request.post(`${api}/task-items`, {
      data: { content: 'Plan the launch', projectId: null },
    })
  ).json()

  await page.goto(`/tasks?project=inbox&task=${item.id}`)
  const panel = page.getByRole('dialog', { name: 'Plan the launch' })
  const thread = panel.getByTestId('task-comments')
  await expect(thread).toContainText('No comments yet.')

  // A text comment, sent with Enter.
  const composer = thread.getByLabel('Write a comment')
  await composer.fill('Kick-off is Monday')
  await composer.press('Enter')
  await expect(thread.locator('.task-comment')).toHaveCount(1)
  await expect(thread.locator('.task-comment-body')).toHaveText('Kick-off is Monday')
  // Signed with the signed-in person's name (the e2e stub's is "Allister").
  await expect(thread.locator('.task-comment-author')).toHaveText('Allister')
  await expect(composer).toHaveValue('')

  // A comment with a file: the entry shows the chip with name and size.
  await thread.locator('input[type="file"]').setInputFiles({
    name: 'brief.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 stub'),
  })
  await expect(thread.locator('.task-comment-draft-file')).toContainText('brief.pdf')
  await composer.fill('Agenda attached')
  await thread.getByRole('button', { name: 'Comment', exact: true }).click()
  await expect(thread.locator('.task-comment')).toHaveCount(2)
  const second = thread.locator('.task-comment').nth(1)
  await expect(second.locator('.task-comment-file')).toContainText('brief.pdf')
  await expect(second.locator('.task-comment-file')).toContainText('13 B')
  await expect(panel.locator('.task-comments-count')).toHaveText('2')

  // Editing the first entry marks it edited.
  const first = thread.locator('.task-comment').nth(0)
  await first.hover()
  await first.getByRole('button', { name: /^Edit comment/ }).click()
  const editor = thread.getByLabel('Edit comment', { exact: true })
  await expect(editor).toHaveValue('Kick-off is Monday')
  await editor.fill('Kick-off is Tuesday')
  await editor.press('Enter')
  await expect(first.locator('.task-comment-body')).toHaveText('Kick-off is Tuesday')
  await expect(first.locator('.task-comment-edited')).toHaveText('(edited)')

  // The attachment can come off an entry that keeps its text.
  page.once('dialog', (dialog) => dialog.accept())
  await second.getByRole('button', { name: 'Remove attachment brief.pdf' }).click()
  await expect(second.locator('.task-comment-file')).toHaveCount(0)
  await expect(second.locator('.task-comment-body')).toHaveText('Agenda attached')

  // The thread survives a reload, oldest first.
  await page.reload()
  const reopened = page
    .getByRole('dialog', { name: 'Plan the launch' })
    .getByTestId('task-comments')
  await expect(reopened.locator('.task-comment-body')).toHaveText([
    'Kick-off is Tuesday',
    'Agenda attached',
  ])

  // Deleting an entry asks first and takes it out of the thread.
  const target = reopened.locator('.task-comment').nth(0)
  await target.hover()
  page.once('dialog', (dialog) => dialog.accept())
  await target.getByRole('button', { name: /^Delete comment/ }).click()
  await expect(reopened.locator('.task-comment')).toHaveCount(1)
  await expect(reopened.locator('.task-comment-body')).toHaveText('Agenda attached')
})
