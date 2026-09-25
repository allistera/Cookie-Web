import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { AUTH0_INJECTION_KEY } from '@auth0/auth0-vue'

import AIInboxView from '../AIInboxView.vue'
import { useInboxStore } from '../../stores/inbox'

// Triage rows link into the inbox, so the view needs a router to render.
function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'ai-inbox', component: { template: '<div />' } },
      { path: '/inbox', name: 'traditional-inbox', component: { template: '<div />' } },
      { path: '/tasks', name: 'tasks', component: { template: '<div />' } },
    ],
  })
}

function mountView({ user = { name: 'Allister Antosik' }, ...options } = {}) {
  // useAuth0() is inject()-based, so providing under its key feeds the view a
  // signed-in user through the real interface.
  return mount(AIInboxView, {
    global: {
      plugins: [makeRouter()],
      provide: { [AUTH0_INJECTION_KEY]: { user: ref(user) } },
    },
    ...options,
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
      items: [
        { message_id: 'msg-3', headline: 'Practice moved', note: 'West Side Park.', unread: false },
      ],
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
  it('shows a loading state while the day is being prepared', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    )
    vi.spyOn(store, 'authHeaders').mockResolvedValue({})
    store.tasksLoaded = false

    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('[data-testid="today-loading"]').exists()).toBe(true)
  })

  it('shows an error with a retry when the day fails to load', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    vi.spyOn(store, 'authHeaders').mockResolvedValue({})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    store.tasksLoaded = false

    const wrapper = mountView()
    await flushPromises()

    const error = wrapper.get('[data-testid="today-error"]')
    expect(error.text()).toContain('Could not load')
    const loadTasks = vi.spyOn(store, 'loadTasks').mockResolvedValue()
    await error.get('button').trigger('click')
    expect(loadTasks).toHaveBeenCalledWith({ force: true })
  })

  let store

  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    store = useInboxStore()
    // Short-circuit onMounted's loadTasks() so it never hits the network.
    store.tasksLoaded = true
    store.tasks = []
    store.digest = null
    store.news = null
  })

  it('greets the signed-in user by first name with the counters', () => {
    store.tasks = [{ id: 'task-1', source: 'task', content: 'Book dentist', url: null }]
    store.digest = DIGEST()

    const greeting = mountView().get('.ai-greeting').text()
    expect(greeting).toContain('Hi Allister!')
    expect(greeting).not.toContain('Antosik')
    expect(greeting).toContain('1 to-dos')
    expect(greeting).toContain('2 priority groups')
  })

  it('greets by nickname when Auth0 filled name with the email address', () => {
    const greeting = mountView({
      user: { name: 'allisteraall@gmail.com', nickname: 'Allister' },
    })
      .get('.ai-greeting')
      .text()

    expect(greeting).toContain('Hi Allister!')
    expect(greeting).not.toContain('@')
  })

  it('greets without a name rather than printing an email address', () => {
    const greeting = mountView({ user: { name: 'allisteraall@gmail.com' } })
      .get('.ai-greeting')
      .text()

    expect(greeting).toContain('Hi!')
    expect(greeting).not.toContain('@')
  })

  it('hides the to-dos card entirely when nothing was gathered', () => {
    const wrapper = mountView()
    expect(wrapper.find('[data-testid="todo-card"]').exists()).toBe(false)
    expect(wrapper.get('.ai-greeting').text()).not.toContain('to-dos')
  })

  // The counters are the headline, so a zero has nothing to say.
  it('drops the whole sentence when both counters are zero', () => {
    const greeting = mountView().get('.ai-greeting').text()

    expect(greeting).toContain('Hi Allister!')
    expect(greeting).not.toContain('You have')
    expect(greeting).not.toContain('0')
  })

  it('names only the to-dos when there are no priority groups', () => {
    store.tasks = [{ id: 'task-1', source: 'task', content: 'Book dentist', url: null }]
    const greeting = mountView().get('.ai-greeting').text()

    expect(greeting).toContain('You have')
    expect(greeting).toContain('1 to-dos')
    expect(greeting).toContain('to work through')
    expect(greeting).not.toContain('priority group')
    expect(greeting).not.toContain('and')
  })

  it('names only the priority groups when there are no to-dos', () => {
    store.digest = DIGEST()
    const greeting = mountView().get('.ai-greeting').text()

    expect(greeting).toContain('2 priority groups')
    expect(greeting).not.toContain('to-dos')
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

  it('hides the triage card entirely when no digest has been written', () => {
    const wrapper = mountView()
    expect(wrapper.find('[data-testid="triage-card"]').exists()).toBe(false)
    expect(wrapper.get('.ai-greeting').text()).not.toContain('priority group')
  })

  // Noise-only and overview-only digests still have something to say, so the
  // card stays even with no priority group in it.
  it('keeps the triage card for a digest that is only noise', () => {
    store.digest = { ...DIGEST(), overview: null, topics: [] }
    const wrapper = mountView()

    expect(wrapper.find('[data-testid="triage-card"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="triage-noise"]').text()).toContain('3 emails')
  })

  it('renders the news round-up with links, notes and meta', () => {
    store.news = {
      created_at: '2026-08-04T05:00:00.000Z',
      sections: [
        {
          emoji: '📰',
          title: 'UK headlines',
          items: [
            {
              title: 'Storm warning',
              url: 'https://bbc.co.uk/news/9',
              description: 'Wind',
              note: '',
              meta: '10:00',
            },
          ],
        },
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
      ],
    }

    const wrapper = mountView()
    const sections = wrapper.get('[data-testid="news-sections"]').findAll('.topic-section')
    expect(sections.map((s) => s.get('.topic-title').text())).toEqual([
      '📰 UK headlines',
      '💻 GitHub',
    ])

    // Headlines carry no personalisation note, since they are never ranked.
    expect(sections[0].find('.news-note').exists()).toBe(false)

    const link = sections[1].get('a.news-link')
    expect(link.attributes('href')).toBe('https://github.com/acme/rocket')
    expect(link.attributes('target')).toBe('_blank')
    expect(link.attributes('rel')).toContain('noopener')
    expect(sections[1].text()).toContain('Fast things')
    expect(sections[1].get('.news-note').text()).toBe('Rust, which you follow')
    expect(sections[1].get('.news-meta').text()).toBe('Rust · ★ 1200')
  })

  it('collapses The World Today with an accessible header control', async () => {
    store.news = {
      sections: [
        {
          emoji: '💻',
          title: 'GitHub',
          items: [{ title: 'acme/rocket', url: 'https://github.com/acme/rocket' }],
        },
      ],
    }
    const wrapper = mountView()
    const toggle = wrapper.get('[data-testid="world-today-toggle"]')

    expect(toggle.text()).toContain('The World Today')
    expect(toggle.attributes('aria-expanded')).toBe('true')
    expect(wrapper.find('[data-testid="news-sections"]').exists()).toBe(true)

    await toggle.trigger('click')

    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(toggle.attributes('aria-label')).toBe('Expand The World Today')
    expect(wrapper.find('[data-testid="news-sections"]').exists()).toBe(false)
  })

  it('restores The World Today collapsed state on the next visit', async () => {
    const firstVisit = mountView()
    await firstVisit.get('[data-testid="world-today-toggle"]').trigger('click')
    expect(localStorage.getItem('cookie-world-today-collapsed')).toBe('true')
    firstVisit.unmount()

    const nextVisit = mountView()

    expect(nextVisit.get('[data-testid="world-today-toggle"]').attributes('aria-expanded')).toBe(
      'false',
    )
    expect(nextVisit.find('[data-testid="news-empty"]').exists()).toBe(false)
  })

  it('still mounts and toggles The World Today when storage is blocked', async () => {
    const blocked = () => {
      throw new DOMException('Storage disabled', 'SecurityError')
    }
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked)

    try {
      const wrapper = mountView()
      const toggle = wrapper.get('[data-testid="world-today-toggle"]')
      expect(toggle.attributes('aria-expanded')).toBe('true')

      await toggle.trigger('click')
      expect(toggle.attributes('aria-expanded')).toBe('false')
    } finally {
      vi.restoreAllMocks()
    }
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
    store.traditionalEmails = [{ id: 'msg-1', unread: true, isArchived: false }]
    const updateMessage = vi.spyOn(store, 'updateMessage').mockResolvedValue({ ok: true })
    const notify = vi.spyOn(store, 'notify')

    const wrapper = mountView()
    const kitchen = wrapper.findAll('.topic-section')[0]
    expect(kitchen.findAll('.topic-catchup-row')).toHaveLength(2)

    await kitchen.findAll('.topic-catchup-row')[0].get('.todo-check-btn').trigger('click')
    await flushPromises()

    expect(updateMessage).toHaveBeenCalledWith('msg-1', {
      is_archived: true,
      is_unread: false,
    })
    expect(store.traditionalEmails).toEqual([])
    expect(notify).toHaveBeenCalledWith('Marked "Contractor needs the floor-plan choice" done.')
    // The topic still has one item left, so it stays on screen.
    const kitchenAfter = wrapper.findAll('.topic-section')[0]
    expect(kitchenAfter.findAll('.topic-catchup-row')).toHaveLength(1)
    expect(wrapper.get('.ai-greeting').text()).toContain('2 priority groups')
  })

  it('drops a topic entirely once its last item is marked done', async () => {
    store.digest = DIGEST()
    vi.spyOn(store, 'completeTopicItem').mockResolvedValue(undefined)

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
    vi.spyOn(store, 'completeTopicItem').mockRejectedValue(new Error('boom'))
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
    const rescheduleDigestItem = vi
      .spyOn(store, 'rescheduleDigestItem')
      .mockResolvedValue(undefined)
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
        source: 'task',
        content: 'Renew car insurance',
        description: 'Policy expires Friday',
        url: null,
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
        source: 'email',
        content: 'Book dentist',
        description: null,
        message_id: null,
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
    expect(rows[0].text()).toContain('From: Tasks')
    expect(rows[1].text()).toContain('From: Email')

    // A built-in task gets a router link into the Tasks app.
    const openLink = rows[0].get('a.action-pill-btn')
    expect(openLink.attributes('href')).toBe('/tasks?project=today&task=task-1')
    // A task with neither a task source nor a message_id gets no Open/Draft
    // action, but every row still offers Reschedule.
    expect(rows[2].find('a.action-pill-btn').exists()).toBe(false)
    expect(rows[2].findAll('.action-pill-btn').map((el) => el.text())).toEqual([
      expect.stringContaining('Reschedule'),
    ])

    // An email-sourced task offers a follow-up draft instead.
    expect(rows[1].get('.action-pill-btn').text()).toContain('Draft')

    expect(wrapper.get('.ai-greeting').text()).toContain('3 to-dos')
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

  it('completing a built-in task persists it, hides it, and updates the counter', async () => {
    store.tasks = [
      {
        id: 'task-1',
        source: 'task',
        content: 'Renew car insurance',
        description: 'x',
        url: null,
      },
    ]
    const completeTask = vi.spyOn(store, 'completeTask').mockResolvedValue({ ok: true })

    const wrapper = mountView()
    expect(wrapper.get('.ai-greeting').text()).toContain('1 to-dos')

    await wrapper.get('[data-testid="task-rows"] .todo-check-btn').trigger('click')
    await flushPromises()

    expect(completeTask).toHaveBeenCalledWith('task-1')
    // Emptying the list takes the whole card with it.
    expect(wrapper.find('[data-testid="todo-card"]').exists()).toBe(false)
    expect(wrapper.get('.ai-greeting').text()).not.toContain('to-dos')
  })

  it('rolls a built-in task back into the list when completion fails', async () => {
    store.tasks = [
      {
        id: 'task-1',
        source: 'task',
        content: 'Renew car insurance',
        description: 'x',
        url: null,
      },
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
      {
        id: 'task-1',
        source: 'task',
        content: 'Renew car insurance',
        description: null,
        url: null,
      },
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
    // Compare against the local (not UTC) calendar day, matching the view's fix.
    const todayLocal = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`
    expect(dueDate).not.toBe(todayLocal)
    expect(notify).toHaveBeenCalledWith('Moved "Renew car insurance" to tomorrow.')
    // Emptying the list takes the whole card with it.
    expect(wrapper.find('[data-testid="todo-card"]').exists()).toBe(false)
    expect(wrapper.get('.ai-greeting').text()).not.toContain('to-dos')
  })

  // Attached to the document so the toggle's own click really reaches the
  // document listener: a guard that missed it would open the menu and close it
  // again in the same click, which an unattached mount can never show.
  it('closes an open reschedule menu on a click outside it, but not on its own', async () => {
    store.tasks = [{ id: 'task-1', source: 'task', content: 'Renew car insurance', url: null }]

    const wrapper = mountView({ attachTo: document.body })
    try {
      const toggle = rowsOf(wrapper)[0]
        .findAll('.action-pill-btn')
        .find((btn) => btn.text().includes('Reschedule'))
      await toggle.trigger('click')
      expect(wrapper.find('.ni-schedule-menu').exists()).toBe(true)

      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushPromises()
      expect(wrapper.find('.ni-schedule-menu').exists()).toBe(false)
    } finally {
      wrapper.unmount()
    }
  })

  it('keeps a to-do visible when rescheduled to later today', async () => {
    store.tasks = [
      {
        id: 'task-1',
        source: 'task',
        content: 'Renew car insurance',
        description: null,
        url: null,
      },
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
    const todayLocal = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`
    expect(dueDate).toBe(todayLocal)
    expect(rowsOf(wrapper)).toHaveLength(1)
  })

  it('rolls a to-do back into view when rescheduling fails', async () => {
    store.tasks = [
      {
        id: 'task-1',
        source: 'task',
        content: 'Renew car insurance',
        description: null,
        url: null,
      },
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

  it('omits the update timestamp and manual refresh control', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    store.tasks = [
      {
        id: 'task-1',
        source: 'task',
        content: 'Renew car insurance',
        url: null,
        gathered_at: twoHoursAgo,
      },
    ]
    const wrapper = mountView()
    expect(wrapper.find('.status-time').exists()).toBe(false)
    expect(wrapper.find('.ai-update-status').exists()).toBe(false)
    expect(wrapper.find('.refresh-icon').exists()).toBe(false)
  })

  it('omits the status when no task carries a gathered_at', () => {
    store.tasks = [{ id: 'task-1', source: 'task', content: 'Book dentist', url: null }]
    expect(mountView().find('.status-time').exists()).toBe(false)
  })
})

// The triage row names the email it is about; that name should take you to it.
describe('triage rows link to their email', () => {
  it('links each row to its own message', async () => {
    const store = useInboxStore()
    store.digest = DIGEST()
    const wrapper = mountView()
    await flushPromises()

    const links = wrapper.findAll('[data-testid="topic-sections"] .email-link')
    expect(links.length).toBeGreaterThan(0)
    expect(links[0].attributes('href')).toBe('/inbox?open=msg-1')
  })

  it('gives every row a distinct link', async () => {
    const store = useInboxStore()
    store.digest = DIGEST()
    const wrapper = mountView()
    await flushPromises()

    const hrefs = wrapper
      .findAll('[data-testid="topic-sections"] .email-link')
      .map((link) => link.attributes('href'))
    expect(new Set(hrefs).size).toBe(hrefs.length)
    expect(hrefs.every((href) => href.startsWith('/inbox?open='))).toBe(true)
  })
})
