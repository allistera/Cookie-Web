import { expect, test } from './workerFixtures.js'

test('Activity is the panel’s second tab and lists the task’s changes; History reports progress', async ({
  page,
}) => {
  const { item } = await (
    await page.request.post('/__e2e__/tasks-api/task-items', {
      data: { content: 'Review activity', projectId: null },
    })
  ).json()
  let goals = { daily: 3, weekly: 10 }
  await page.route('**/task-progress?*', (route) =>
    route.fulfill({
      json: {
        summary: { daily: 2, weekly: 8 },
        goals,
        timeZone: 'UTC',
      },
    }),
  )
  await page.route('**/task-goals', async (route) => {
    goals = route.request().postDataJSON()
    await route.fulfill({ json: { goals } })
  })
  await page.route('**/task-activity?*', (route) => {
    const params = new URL(route.request().url()).searchParams
    if (params.get('task') === item.id) {
      return route.fulfill({
        json: {
          activities: [
            {
              id: 'edit',
              taskId: item.id,
              title: item.content,
              action: 'edited',
              taskExists: true,
              occurredAt: '2026-10-16T09:05:00Z',
              changes: {
                content: { before: 'Review', after: item.content },
                due_date: { before: null, after: '2026-10-20' },
              },
            },
            {
              id: 'create',
              taskId: item.id,
              title: item.content,
              action: 'created',
              taskExists: true,
              occurredAt: '2026-10-16T09:00:00Z',
              changes: {},
            },
          ],
          nextCursor: null,
        },
      })
    }
    const completed = params.has('completed')
    return route.fulfill({
      json: {
        activities: [
          {
            id: 'event',
            taskId: item.id,
            title: completed ? 'Earlier task' : item.content,
            action: completed ? 'completed' : 'created',
            taskExists: !completed,
            occurredAt: '2026-10-16T09:00:00Z',
            changes: {},
          },
        ],
        nextCursor: null,
      },
    })
  })
  await page.goto(`/tasks?project=inbox&task=${item.id}`)
  // The thread shows first; activity is the panel's second tab, and is a
  // plain list of this task's changes with none of the progress report.
  const panel = page.getByRole('dialog', { name: 'Review activity' })
  await expect(panel.getByTestId('task-comments')).toBeVisible()
  await panel.getByRole('tab', { name: 'Activity' }).click()
  const history = panel.getByRole('list', { name: 'Changes to this task' })
  await expect(history.getByRole('listitem')).toHaveText([
    /Title changed from “Review” to “Review activity”/,
    /Due date set to 2026-10-20/,
    /Created/,
  ])
  await expect(panel.getByTestId('task-comments')).toBeHidden()
  await expect(panel.getByText('completed')).toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'Set completion goals' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Close task', exact: true }).click()

  // The list view's History keeps the account-wide report and goals.
  await page.getByRole('button', { name: 'History', exact: true }).click()
  const activity = page.getByRole('region', { name: 'Activity and progress' })
  await expect(activity).toContainText('2 completed')
  await expect(activity).toContainText('Earlier task (deleted task)')
  await activity.getByRole('button', { name: 'Set completion goals' }).click()
  await activity.getByLabel('Daily goal', { exact: true }).fill('5')
  await activity.getByLabel('Weekly goal', { exact: true }).fill('25')
  await activity.getByRole('button', { name: 'Save goals' }).click()
  await expect(activity).toContainText('Goal: 25')
  await page.reload()
  await page.getByRole('button', { name: 'History', exact: true }).click()
  await expect(activity).toContainText('Goal: 5')
  await page.request.delete('/__e2e__/tasks-api/task-items', { data: { id: item.id } })
})
