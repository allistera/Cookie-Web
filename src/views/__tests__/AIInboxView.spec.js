import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'
import { AUTH0_INJECTION_KEY } from '@auth0/auth0-vue'

import AIInboxView from '../AIInboxView.vue'
import { useInboxStore } from '../../stores/inbox'

function mountView() {
  // useAuth0() is inject()-based, so providing under its key feeds the view a
  // signed-in user through the real interface.
  return mount(AIInboxView, {
    global: { provide: { [AUTH0_INJECTION_KEY]: { user: ref({ name: 'Allister Antosik' }) } } },
  })
}

function rowsOf(wrapper) {
  return wrapper.get('[data-testid="task-rows"]').findAll('.todo-row')
}

// A fresh copy per test: marking a priority group read mutates its items in place.
const DIGEST = () => ({
  overview: 'One reply needs you and one message is worth reviewing.',
  created_at: '2026-08-03T05:00:00.000Z',
  topics: [
    {
      emoji: '↩️',
      title: 'Reply Needed',
      items: [
        {
          message_id: 'msg-1',
          headline: 'Contractor needs the floor-plan choice',
          note: 'They need a decision today. Suggested: confirm the bay-window option.',
          unread: true,
        },
        { message_id: 'msg-2', headline: 'Claim', note: 'Processed.', unread: false },
      ],
    },
    {
      emoji: '👀',
      title: 'Review',
      items: [{ message_id: 'msg-3', headline: 'Practice moved', note: 'West Side Park.', unread: false }],
    },
  ],
  noise: {
    count: 3,
    categories: [
      { category: 'marketing', count: 2 },
      { category: 'automated', count: 1 },
    ],
  },
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
    expect(greeting).toContain('2 priority groups')
  })

  it('shows an empty state and a zero count when nothing was gathered', () => {
    const wrapper = mountView()
    expect(rowsOf(wrapper)).toHaveLength(0)
    expect(wrapper.get('[data-testid="tasks-empty"]').text()).toContain('Nothing gathered for today')
    expect(wrapper.get('.ai-greeting').text()).toContain('0 to-dos')
  })

  it('renders the priority tiers with a source count and unread dots', () => {
    store.digest = DIGEST()
    const wrapper = mountView()

    const titles = wrapper.findAll('.topic-title').map((t) => t.text())
    expect(titles).toEqual(['↩️ Reply Needed', '👀 Review'])
    expect(wrapper.get('.ai-greeting').text()).toContain('2 priority groups')

    const replyNeeded = wrapper.findAll('.topic-section')[0]
    expect(replyNeeded.text()).toContain(
      'Contractor needs the floor-plan choice – They need a decision today. Suggested: confirm the bay-window option.',
    )
    expect(replyNeeded.get('.topic-meta').text()).toContain('2 sources')
    // Only the still-unread message keeps a dot.
    expect(replyNeeded.findAll('.unread-dot')).toHaveLength(1)

    // A topic with nothing left unread offers no "mark all read".
    const review = wrapper.findAll('.topic-section')[1]
    expect(review.get('.topic-meta').text()).toContain('1 source')
    expect(review.find('.topic-action-btn').exists()).toBe(false)
  })

  it('explains the triage and summarizes Noise without listing those messages', () => {
    store.digest = DIGEST()
    const wrapper = mountView()

    expect(wrapper.get('.triage-overview').text()).toBe(
      'One reply needs you and one message is worth reviewing.',
    )
    const noise = wrapper.get('[data-testid="triage-noise"]').text()
    expect(noise).toContain('3 emails classified as Noise')
    expect(noise).toContain('2 marketing · 1 automated')
    expect(noise).toContain('nothing was archived or deleted')
  })

  it('shows an empty state when no digest has been written', () => {
    const wrapper = mountView()
    expect(wrapper.find('[data-testid="topic-sections"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="topics-empty"]').text()).toContain(
      'No Reply Needed or Review mail in the last 24 hours',
    )
    expect(wrapper.get('.ai-greeting').text()).toContain('0 priority groups')
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

  it('marks a topic item done, persists it, and hides just that row', async () => {
    store.digest = DIGEST()
    const markTopicItemRead = vi.spyOn(store, 'markTopicItemRead').mockResolvedValue(undefined)
    const notify = vi.spyOn(store, 'notify')

    const wrapper = mountView()
    const kitchen = wrapper.findAll('.topic-section')[0]
    expect(kitchen.findAll('.topic-catchup-row')).toHaveLength(2)

    await kitchen.findAll('.topic-catchup-row')[0].get('.todo-check-btn').trigger('click')
    await flushPromises()

    expect(markTopicItemRead).toHaveBeenCalledWith(store.digest.topics[0].items[0])
    expect(notify).toHaveBeenCalledWith('Marked "Contractor needs the floor-plan choice" done.')
    // The topic still has one item left, so it stays on screen.
    const kitchenAfter = wrapper.findAll('.topic-section')[0]
    expect(kitchenAfter.findAll('.topic-catchup-row')).toHaveLength(1)
    expect(wrapper.get('.ai-greeting').text()).toContain('2 priority groups')
  })

  it('drops a topic entirely once its last item is marked done', async () => {
    store.digest = DIGEST()
    vi.spyOn(store, 'markTopicItemRead').mockResolvedValue(undefined)

    const wrapper = mountView()
    // Review is the second group and has a single, already-read item.
    const review = wrapper.findAll('.topic-section')[1]
    await review.get('.todo-check-btn').trigger('click')
    await flushPromises()

    expect(wrapper.findAll('.topic-title').map((t) => t.text())).toEqual(['↩️ Reply Needed'])
    expect(wrapper.get('.ai-greeting').text()).toContain('1 priority group')
  })

  it('rolls a topic item back into view when marking it done fails', async () => {
    store.digest = DIGEST()
    vi.spyOn(store, 'markTopicItemRead').mockRejectedValue(new Error('boom'))
    const notify = vi.spyOn(store, 'notify')

    const wrapper = mountView()
    const kitchen = wrapper.findAll('.topic-section')[0]
    await kitchen.findAll('.topic-catchup-row')[0].get('.todo-check-btn').trigger('click')
    await flushPromises()

    expect(notify).toHaveBeenCalledWith('Failed to mark email done.', 'error')
    const kitchenAfter = wrapper.findAll('.topic-section')[0]
    expect(kitchenAfter.findAll('.topic-catchup-row')).toHaveLength(2)
  })

  it('reschedules a triage item to another day, hiding it and notifying', async () => {
    store.digest = DIGEST()
    const rescheduleDigestItem = vi.spyOn(store, 'rescheduleDigestItem').mockResolvedValue(undefined)
    const notify = vi.spyOn(store, 'notify')

    const wrapper = mountView()
    const kitchen = wrapper.findAll('.topic-section')[0]
    await kitchen.findAll('.topic-catchup-row')[0].get('[title="Reschedule"]').trigger('click')

    const tomorrow = wrapper
      .findAll('.ni-schedule-menu [role="menuitem"]')
      .find((item) => item.text().includes('Tomorrow'))
    await tomorrow.trigger('click')
    await flushPromises()

    expect(rescheduleDigestItem).toHaveBeenCalledTimes(1)
    const [item, scheduledFor] = rescheduleDigestItem.mock.calls[0]
    expect(item.message_id).toBe('msg-1')
    expect(Number.isFinite(Date.parse(scheduledFor))).toBe(true)
    expect(notify).toHaveBeenCalledWith(
      'Moved "Contractor needs the floor-plan choice" to tomorrow.',
    )
    const kitchenAfter = wrapper.findAll('.topic-section')[0]
    expect(kitchenAfter.findAll('.topic-catchup-row')).toHaveLength(1)
  })

  it('rolls a triage item back into view when rescheduling fails', async () => {
    store.digest = DIGEST()
    vi.spyOn(store, 'rescheduleDigestItem').mockRejectedValue(new Error('boom'))
    const notify = vi.spyOn(store, 'notify')

    const wrapper = mountView()
    const kitchen = wrapper.findAll('.topic-section')[0]
    await kitchen.findAll('.topic-catchup-row')[0].get('[title="Reschedule"]').trigger('click')

    const tomorrow = wrapper
      .findAll('.ni-schedule-menu [role="menuitem"]')
      .find((item) => item.text().includes('Tomorrow'))
    await tomorrow.trigger('click')
    await flushPromises()

    expect(notify).toHaveBeenCalledWith('Failed to reschedule email.', 'error')
    const kitchenAfter = wrapper.findAll('.topic-section')[0]
    expect(kitchenAfter.findAll('.topic-catchup-row')).toHaveLength(2)
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
    // A task with neither a url nor a message_id gets no Open/Draft action,
    // but every row still offers Reschedule.
    expect(rows[2].find('a.action-pill-btn').exists()).toBe(false)
    expect(rows[2].findAll('.action-pill-btn').map((el) => el.text())).toEqual([
      expect.stringContaining('Reschedule'),
    ])

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

  it('reschedules a to-do to a future day, hiding it and notifying', async () => {
    store.tasks = [
      { id: 'task-1', source: 'todoist', content: 'Renew car insurance', description: null, url: null },
    ]
    const rescheduleTask = vi.spyOn(store, 'rescheduleTask').mockResolvedValue({ ok: true })
    const notify = vi.spyOn(store, 'notify')

    const wrapper = mountView()
    const toggle = rowsOf(wrapper)[0]
      .findAll('.action-pill-btn')
      .find((btn) => btn.text().includes('Reschedule'))
    await toggle.trigger('click')

    const tomorrow = wrapper
      .findAll('.ni-schedule-menu [role="menuitem"]')
      .find((item) => item.text().includes('Tomorrow'))
    await tomorrow.trigger('click')
    await flushPromises()

    expect(rescheduleTask).toHaveBeenCalledTimes(1)
    const [id, dueDate] = rescheduleTask.mock.calls[0]
    expect(id).toBe('task-1')
    expect(dueDate).not.toBe(new Date().toISOString().slice(0, 10))
    expect(notify).toHaveBeenCalledWith('Moved "Renew car insurance" to tomorrow.')
    expect(rowsOf(wrapper)).toHaveLength(0)
    expect(wrapper.get('.ai-greeting').text()).toContain('0 to-dos')
  })

  it('keeps a to-do visible when rescheduled to later today', async () => {
    store.tasks = [
      { id: 'task-1', source: 'todoist', content: 'Renew car insurance', description: null, url: null },
    ]
    const rescheduleTask = vi.spyOn(store, 'rescheduleTask').mockResolvedValue({ ok: true })

    const wrapper = mountView()
    const toggle = rowsOf(wrapper)[0]
      .findAll('.action-pill-btn')
      .find((btn) => btn.text().includes('Reschedule'))
    await toggle.trigger('click')

    const laterToday = wrapper
      .findAll('.ni-schedule-menu [role="menuitem"]')
      .find((item) => item.text().includes('Later today'))
    await laterToday.trigger('click')
    await flushPromises()

    const [, dueDate] = rescheduleTask.mock.calls[0]
    expect(dueDate).toBe(new Date().toISOString().slice(0, 10))
    expect(rowsOf(wrapper)).toHaveLength(1)
  })

  it('rolls a to-do back into view when rescheduling fails', async () => {
    store.tasks = [
      { id: 'task-1', source: 'todoist', content: 'Renew car insurance', description: null, url: null },
    ]
    vi.spyOn(store, 'rescheduleTask').mockRejectedValue(new Error('boom'))
    const notify = vi.spyOn(store, 'notify')

    const wrapper = mountView()
    const toggle = rowsOf(wrapper)[0]
      .findAll('.action-pill-btn')
      .find((btn) => btn.text().includes('Reschedule'))
    await toggle.trigger('click')

    const tomorrow = wrapper
      .findAll('.ni-schedule-menu [role="menuitem"]')
      .find((item) => item.text().includes('Tomorrow'))
    await tomorrow.trigger('click')
    await flushPromises()

    expect(notify).toHaveBeenCalledWith('Failed to reschedule task.', 'error')
    expect(rowsOf(wrapper)).toHaveLength(1)
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
