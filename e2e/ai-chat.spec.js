import { expect, test } from './workerFixtures.js'
import { SEARCH_API_URL } from '../src/lib/apiWorkers.js'

// The chat Worker's stream, as the drawer consumes it (stores/inbox.js
// askAssistant): the model searched mail, found one message, answered.
const REPLAYED = [
  {
    role: 'assistant',
    content: null,
    tool_calls: [
      { id: 'c1', type: 'function', function: { name: '_meiliSearchInIndex', arguments: '{}' } },
    ],
  },
  { role: 'tool', tool_call_id: 'c1', content: 'Email from City Construction: plan revised' },
]
const FIRST_ANSWER = [
  { type: 'searching', index: 'messages', q: 'renovation' },
  { type: 'message', message: REPLAYED[0] },
  {
    type: 'sources',
    sources: [
      { index: 'messages', id: 'm1', title: 'Revised Floor Plan', subtitle: 'City Construction' },
      { index: 'documents', id: 'd1', title: 'Kitchen plan', subtitle: '' },
    ],
  },
  { type: 'message', message: REPLAYED[1] },
  { type: 'token', text: '**City Construction** sent a revised plan.' },
  { type: 'done' },
]
const SECOND_ANSWER = [{ type: 'token', text: 'Last Tuesday.' }, { type: 'done' }]

const sse = (events) => events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')

test('the header AI button opens the assistant, which keeps the conversation going', async ({
  page,
}) => {
  const requests = []
  await page.route(`${SEARCH_API_URL}/chat`, (route) => {
    requests.push(route.request().postDataJSON())
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
      body: sse(requests.length === 1 ? FIRST_ANSWER : SECOND_ANSWER),
    })
  })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/inbox')

  const drawer = page.getByRole('dialog', { name: 'Cookie Assistant' })
  const toggle = page.getByRole('button', { name: 'Show AI chat' })
  await expect(drawer).toBeHidden()

  await toggle.click()
  await expect(drawer).toBeVisible()
  await expect(drawer).toContainText('Ask about your mail, documents and tasks')
  await expect(page.getByRole('button', { name: 'Hide AI chat' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  const input = drawer.getByLabel('Ask Cookie Assistant')
  await expect(input).toBeFocused()
  await input.fill('What happened with the renovation?')
  await input.press('Enter')

  const reply = drawer.locator('.chat-msg.ai').first()
  await expect(reply).toContainText('City Construction sent a revised plan.')
  await expect(reply.locator('strong')).toHaveText('City Construction')
  await expect(reply.locator('.chat-source > span:last-child')).toHaveText([
    'Revised Floor Plan',
    'Kitchen plan',
  ])
  expect(requests[0].messages).toEqual([
    { role: 'user', content: 'What happened with the renovation?' },
  ])

  // The follow-up carries the whole exchange, the model's searches included.
  await input.fill('When?')
  await input.press('Enter')
  await expect(drawer.locator('.chat-msg.ai').nth(1)).toHaveText('Last Tuesday.')
  expect(requests[1].messages).toEqual([
    { role: 'user', content: 'What happened with the renovation?' },
    ...REPLAYED,
    { role: 'assistant', content: '**City Construction** sent a revised plan.' },
    { role: 'user', content: 'When?' },
  ])

  // The header button closes the drawer and reopens it with the exchange
  // intact.
  await page.getByRole('button', { name: 'Hide AI chat' }).click()
  // Once rendered the drawer collapses rather than unmounting, so closed
  // means inert (out of the tab order) rather than gone.
  await expect(drawer).toHaveAttribute('inert', '')
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await toggle.click()
  await expect(drawer).not.toHaveAttribute('inert', '')
  await expect(input).toBeFocused()
  await expect(drawer.locator('.chat-msg')).toHaveCount(4)

  // A cited document opens in Documents.
  await reply.getByRole('button', { name: 'Kitchen plan' }).click()
  await expect(page).toHaveURL(/\/documents\/d1$/)
  await expect(drawer).toBeVisible()
})
