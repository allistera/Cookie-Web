import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import AIInboxView from '../AIInboxView.vue'
import { useInboxStore } from '../../stores/inbox'

vi.mock('@auth0/auth0-vue', () => ({
  useAuth0: () => ({ user: { value: { name: 'Allister Antosik' } } }),
}))

function mountView() {
  return mount(AIInboxView)
}

function rowsOf(wrapper) {
  return wrapper.get('[data-testid="task-rows"]').findAll('.todo-row')
}

// A fresh copy per test: marking a topic read mutates its items in place.
const DIGEST = () => ({
  overview: 'Mostly kitchen news.',
  created_at: '2026-08-03T05:00:00.000Z',
  topics: [
    {
      emoji: '🍳',
      title: 'Kitchen Renovation',
      items: [
        {
          message_id: 'msg-1',
          headline: 'Floor plan',
          note: 'Revised design for the bay window.',
          unread: true,
        },
        { message_id: 'msg-2', headline: 'Claim', note: 'Processed.', unread: false },
      ],
    },
    {
      emoji: '⚽',
      title: 'Soccer',
      items: [{ message_id: 'msg-3', headline: 'Practice moved', note: 'West Side Park.', unread: false }],
    },
  ],
})

describe('AIInboxView (AI Today)', () => {
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useInboxStore()
    // Short-circuit onMounted's loadTasks() so it never hits the network.
    store.tasksLoaded = true
    store.tasks = []
    store.digest = null
    store.news = null
  })

  it('greets the signed-in user by first name with the counters', () => {
    store.tasks = [{ id: 'task-1', source: 'todoist', content: 'Book dentist', url: null }]
    store.digest = DIGEST()

    const greeting = mountView().get('.ai-greeting').text()
    expect(greeting).toContain('Hi Allister')
    expect(greeting).not.toContain('Antosik')
    expect(greeting).toContain('1 to-dos')
    expect(greeting).toContain('2 topics')
  })

  it('shows an empty state and a zero count when nothing was gathered', () => {
    const wrapper = mountView()
    expect(rowsOf(wrapper)).toHaveLength(0)
    expect(wrapper.get('[data-testid="tasks-empty"]').text()).toContain('Nothing gathered for today')
    expect(wrapper.get('.ai-greeting').text()).toContain('0 to-dos')
  })

  it('renders the digest topics with a source count and unread dots', () => {
    store.digest = DIGEST()
    const wrapper = mountView()

    const titles = wrapper.findAll('.topic-title').map((t) => t.text())
    expect(titles).toEqual(['🍳 Kitchen Renovation', '⚽ Soccer'])
    expect(wrapper.get('.ai-greeting').text()).toContain('2 topics')

    const kitchen = wrapper.findAll('.topic-section')[0]
    expect(kitchen.text()).toContain('Floor plan – Revised design for the bay window.')
    expect(kitchen.get('.topic-meta').text()).toContain('2 sources')
    // Only the still-unread message keeps a dot.
    expect(kitchen.findAll('.unread-dot')).toHaveLength(1)

    // A topic with nothing left unread offers no "mark all read".
    const soccer = wrapper.findAll('.topic-section')[1]
    expect(soccer.get('.topic-meta').text()).toContain('1 source')
    expect(soccer.find('.topic-action-btn').exists()).toBe(false)
  })

  it('shows an empty state when no digest has been written', () => {
    const wrapper = mountView()
    expect(wrapper.find('[data-testid="topic-sections"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="topics-empty"]').text()).toContain('No topics yet')
    expect(wrapper.get('.ai-greeting').text()).toContain('0 topics')
  })

  it('renders the news round-up with links, notes and meta', () => {
    store.news = {
      created_at: '2026-08-04T05:00:00.000Z',
      sections: [
        {
          emoji: '💻',
          title: 'GitHub',
          items: [
            {
              title: 'acme/rocket',
              url: 'https://github.com/acme/rocket',
              description: 'Fast things',
              note: 'Rust, which you follow',
              meta: 'Rust · ★ 1200',
            },
          ],
        },
        {
          emoji: '📰',
          title: 'UK headlines',
          items: [
            { title: 'Storm warning', url: 'https://bbc.co.uk/news/9', description: 'Wind', note: '', meta: '10:00' },
          ],
        },
      ],
    }

    const wrapper = mountView()
    const sections = wrapper.get('[data-testid="news-sections"]').findAll('.topic-section')
    expect(sections.map((s) => s.get('.topic-title').text())).toEqual(['💻 GitHub', '📰 UK headlines'])

    const link = sections[0].get('a.news-link')
    expect(link.attributes('href')).toBe('https://github.com/acme/rocket')
    expect(link.attributes('target')).toBe('_blank')
    expect(link.attributes('rel')).toContain('noopener')
    expect(sections[0].text()).toContain('Fast things')
    expect(sections[0].get('.news-note').text()).toBe('Rust, which you follow')
    expect(sections[0].get('.news-meta').text()).toBe('Rust · ★ 1200')

    // Headlines carry no personalisation note, since they are never ranked.
    expect(sections[1].find('.news-note').exists()).toBe(false)
  })

  it('shows a news empty state pointing at the settings pane', () => {
    const wrapper = mountView()
    expect(wrapper.find('[data-testid="news-sections"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="news-empty"]').text()).toContain('Settings → Personalisation')
  })

  it('marks a topic read, clearing its dots and confirming with a toast', async () => {
    store.digest = DIGEST()
    const markTopicRead = vi.spyOn(store, 'markTopicRead').mockImplementation(async (topic) => {
      topic.items.forEach((item) => {
        item.unread = false
      })
      return 1
    })
    const notify = vi.spyOn(store, 'notify')

    const wrapper = mountView()
    await wrapper.findAll('.topic-section')[0].get('.topic-action-btn').trigger('click')
    await flushPromises()

    expect(markTopicRead).toHaveBeenCalledWith(store.digest.topics[0])
    expect(notify).toHaveBeenCalledWith('Marked 1 email read.')
    expect(wrapper.findAll('.topic-section')[0].findAll('.unread-dot')).toHaveLength(0)
  })

  it('reports when some of a topic could not be marked read', async () => {
    store.digest = DIGEST()
    vi.spyOn(store, 'markTopicRead').mockResolvedValue(0)
    const notify = vi.spyOn(store, 'notify')

    const wrapper = mountView()
    await wrapper.findAll('.topic-section')[0].get('.topic-action-btn').trigger('click')
    await flushPromises()

    expect(notify).toHaveBeenCalledWith('Some emails could not be marked read.', 'error')
  })

  it('renders gathered tasks in API order with source-appropriate actions', () => {
    store.tasks = [
      {
        id: 'task-1',
        source: 'todoist',
        content: 'Renew car insurance',
        description: 'Policy expires Friday',
        url: 'https://app.todoist.com/app/task/task-1',
      },
      {
        id: 'task-3',
        source: 'email',
        content: 'Reply to Apple',
        description: 'From an email',
        message_id: 'message-1',
        reply_to: 'apple@example.com',
        message_subject: 'Your support request',
        url: null,
      },
      {
        id: 'task-2',
        source: 'todoist',
        content: 'Book dentist',
        description: null,
        url: null,
      },
    ]

    const wrapper = mountView()
    const rows = rowsOf(wrapper)
    // One list, kept in the order the API returned (most pressing first).
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.get('strong').text())).toEqual([
      'Renew car insurance',
      'Reply to Apple',
      'Book dentist',
    ])

    // Title is bold, description sits beside it.
    expect(rows[0].text()).toContain('Renew car insurance – Policy expires Friday')
    expect(rows[0].text()).toContain('From: Todoist')
    expect(rows[1].text()).toContain('From: Email')

    // A Todoist task with a url gets an Open link; one without gets no action.
    const openLink = rows[0].get('a.action-pill-btn')
    expect(openLink.attributes('href')).toBe('https://app.todoist.com/app/task/task-1')
    expect(openLink.attributes('target')).toBe('_blank')
    expect(rows[2].find('.action-pill-btn').exists()).toBe(false)

    // An email-sourced task offers a follow-up draft instead.
    expect(rows[1].get('.action-pill-btn').text()).toContain('Draft')

    expect(wrapper.get('.ai-greeting').text()).toContain('3 to-dos')
  })

  // Task URLs reach the app from Todoist via /api/tasks, so they are external
  // input rendered straight into an href.
  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:text/html,<script>alert(1)</script>'],
    ['a relative path', '/app/task/task-1'],
  ])('does not render %s as an Open link', (_label, url) => {
    store.tasks = [
      { id: 'task-1', source: 'todoist', content: 'Renew car insurance', description: null, url },
    ]

    const rows = rowsOf(mountView())

    expect(rows).toHaveLength(1)
    expect(rows[0].find('a.action-pill-btn').exists()).toBe(false)
  })

  it('generates a follow-up draft from an email task', async () => {
    const task = {
      id: 'task-email',
      source: 'email',
      content: 'Follow up with the contractor',
      description: 'Confirm the Tuesday delivery',
      message_id: 'message-1',
      reply_to: 'contractor@example.com',
      message_subject: 'Delivery date',
    }
    store.tasks = [task]
    const draftFollowUp = vi.spyOn(store, 'draftFollowUp').mockResolvedValue(true)
    const notify = vi.spyOn(store, 'notify')

    const wrapper = mountView()
    await wrapper.get('[data-testid="task-rows"] .action-pill-btn').trigger('click')
    await flushPromises()

    expect(draftFollowUp).toHaveBeenCalledWith(task)
    expect(notify).toHaveBeenCalledWith('Follow-up draft ready to review.')
  })

  it('completing a Todoist task persists it, hides it, and updates the counter', async () => {
    store.tasks = [
      { id: 'task-1', source: 'todoist', content: 'Renew car insurance', description: 'x', url: null },
    ]
    const completeTask = vi.spyOn(store, 'completeTask').mockResolvedValue({ ok: true })

    const wrapper = mountView()
    expect(wrapper.get('.ai-greeting').text()).toContain('1 to-dos')

    await wrapper.get('[data-testid="task-rows"] .todo-check-btn').trigger('click')
    await flushPromises()

    expect(completeTask).toHaveBeenCalledWith('task-1')
    expect(rowsOf(wrapper)).toHaveLength(0)
    expect(wrapper.get('.ai-greeting').text()).toContain('0 to-dos')
  })

  it('rolls a Todoist task back into the list when completion fails', async () => {
    store.tasks = [
      { id: 'task-1', source: 'todoist', content: 'Renew car insurance', description: 'x', url: null },
    ]
    vi.spyOn(store, 'completeTask').mockRejectedValue(new Error('boom'))
    const notify = vi.spyOn(store, 'notify')

    const wrapper = mountView()
    await wrapper.get('[data-testid="task-rows"] .todo-check-btn').trigger('click')
    await flushPromises()

    // The row returns and the counter is restored.
    expect(rowsOf(wrapper)).toHaveLength(1)
    expect(wrapper.get('.ai-greeting').text()).toContain('1 to-dos')
    expect(notify).toHaveBeenCalledWith('Failed to mark task done.', 'error')
  })

  it('reports how stale the gathered set is and re-reads past the cache', async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    store.tasks = [
      {
        id: 'task-1',
        source: 'todoist',
        content: 'Renew car insurance',
        url: null,
        gathered_at: twoHoursAgo,
      },
    ]
    const loadTasks = vi.spyOn(store, 'loadTasks').mockResolvedValue()
    const rebuildDigest = vi.spyOn(store, 'rebuildDigest').mockResolvedValue(true)

    const wrapper = mountView()
    expect(wrapper.get('.status-time').text()).toBe('Updated 2h ago')

    await wrapper.get('.ai-update-status').trigger('click')
    await flushPromises()

    // Rebuild first so the re-read picks up mail that arrived since the cron.
    expect(rebuildDigest).toHaveBeenCalled()
    expect(loadTasks).toHaveBeenCalledWith({ force: true })
    expect(rebuildDigest.mock.invocationCallOrder[0]).toBeLessThan(
      loadTasks.mock.invocationCallOrder.at(-1),
    )
  })

  it('moves the status text forward on a successful refresh even when no task changed', async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    store.tasks = [
      { id: 'task-1', source: 'todoist', content: 'Renew car insurance', url: null, gathered_at: twoHoursAgo },
    ]
    vi.spyOn(store, 'rebuildDigest').mockResolvedValue(true)
    // Refresh only ever rebuilds the digest/news - the task itself (and its
    // gathered_at) is untouched, same as a real refresh where nothing new
    // was gathered from Todoist/email since the overnight run.
    vi.spyOn(store, 'loadTasks').mockImplementation(async () => {
      store.digest = { ...DIGEST(), created_at: new Date().toISOString() }
    })
    const notify = vi.spyOn(store, 'notify')

    const wrapper = mountView()
    expect(wrapper.get('.status-time').text()).toBe('Updated 2h ago')

    await wrapper.get('.ai-update-status').trigger('click')
    await flushPromises()

    expect(wrapper.get('.status-time').text()).toBe('Updated just now')
    expect(notify).toHaveBeenCalledWith('AI Today updated.')
  })

  it('still re-reads when the digest rebuild fails', async () => {
    const loadTasks = vi.spyOn(store, 'loadTasks').mockResolvedValue()
    vi.spyOn(store, 'rebuildDigest').mockRejectedValue(new Error('boom'))
    const notify = vi.spyOn(store, 'notify')

    const wrapper = mountView()
    await wrapper.get('.ai-update-status').trigger('click')
    await flushPromises()

    expect(notify).toHaveBeenCalledWith(
      'Could not rebuild the digest; showing the latest stored one.',
      'error',
    )
    expect(loadTasks).toHaveBeenCalledWith({ force: true })
  })

  it('does not fire a second refresh while one is in flight', async () => {
    let release
    vi.spyOn(store, 'rebuildDigest').mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    const loadTasks = vi.spyOn(store, 'loadTasks').mockResolvedValue()

    const wrapper = mountView()
    await wrapper.get('.ai-update-status').trigger('click')
    await wrapper.get('.ai-update-status').trigger('click')
    expect(store.rebuildDigest).toHaveBeenCalledTimes(1)

    release(true)
    await flushPromises()
    expect(loadTasks).toHaveBeenCalledWith({ force: true })
  })

  it('falls back when no task carries a gathered_at', () => {
    store.tasks = [{ id: 'task-1', source: 'todoist', content: 'Book dentist', url: null }]
    expect(mountView().get('.status-time').text()).toBe('Not gathered yet')
  })
})
