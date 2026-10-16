import { expect, test } from './workerFixtures.js'

test('Activity sits below comments, filters completed history and saves completion goals', async ({
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
    const completed = new URL(route.request().url()).searchParams.has('completed')
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
  const activity = page.getByRole('region', { name: 'Activity and progress' })
  await expect(activity).toContainText('2 completed')
  await expect(activity).toContainText('Created')
  await expect(page.locator('[data-testid="task-comments"] + .task-activity')).toHaveCount(1)
  await activity.getByLabel('Activity history').selectOption('completed')
  await expect(activity).toContainText('Earlier task (deleted task)')
  await activity.getByRole('button', { name: 'Set completion goals' }).click()
  await activity.getByLabel('Daily goal', { exact: true }).fill('5')
  await activity.getByLabel('Weekly goal', { exact: true }).fill('25')
  await activity.getByRole('button', { name: 'Save goals' }).click()
  await expect(activity).toContainText('Goal: 25')
  await page.reload()
  await expect(activity).toContainText('Goal: 5')
})
