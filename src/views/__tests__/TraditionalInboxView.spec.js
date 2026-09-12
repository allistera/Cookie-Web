import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { AUTH0_INJECTION_KEY } from '@auth0/auth0-vue'

import TraditionalInboxView from '../TraditionalInboxView.vue'
import EmailBody from '../../components/EmailBody.vue'
import { useInboxStore } from '../../stores/inbox'
import { AI_API_URL, MESSAGES_API_URL } from '../../lib/apiWorkers'
import { scheduleChoices } from '../../utils/schedule'
import { setAuth0Client } from '../../auth0-client'

// The store's authHeaders sees no Auth0 client, matching stubbed-auth mode.
setAuth0Client(null)

// The view reads route.query.filter; tests that need a filter set it with
// `await router.replace({ path: '/inbox', query: {...} })` before mounting.
// `routerPush` spies on the real router's push so navigations don't resolve.
let router
let routerPush

// The signed-in account's address; reply-all leaves it out of the recipients.
const SELF_EMAIL = 'me@example.com'

function mountView(options = {}) {
  // useAuth0() is inject()-based, so providing under its key feeds the view a
  // signed-in user through the real interface.
  return mount(TraditionalInboxView, {
    ...options,
    global: {
      plugins: [router],
      provide: { [AUTH0_INJECTION_KEY]: { user: ref({ email: SELF_EMAIL }) } },
    },
  })
}

// View tests exercise optimistic store actions, but authentication and the
// network belong to the store's own unit suite. Give incidental background
// requests a deterministic success response; tests that care about a request
// replace this stub with a purpose-built mock.
beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }))
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/inbox', name: 'traditional-inbox', component: { template: '<div />' } },
      { path: '/calendar', name: 'calendar', component: { template: '<div />' } },
    ],
  })
  await router.push('/inbox')
  await router.isReady()
  routerPush = vi.spyOn(router, 'push').mockResolvedValue()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

describe('reader thread muting', () => {
  let store
  let wrapper

  beforeEach(async () => {
    setActivePinia(createPinia())
    store = useInboxStore()
    store.traditionalEmails = [makeEmail('mute-1', Date.now() - HOUR)]
    store.messageBodies.set('mute-1', {
      threadId: 'thread-1',
      threadMuted: false,
      thread: [],
      attachments: [],
    })
    wrapper = mountView()
    store.openReader(store.traditionalEmails[0])
    await flushPromises()
  })

  afterEach(() => {
    wrapper.unmount()
    vi.restoreAllMocks()
  })

  it('offers accessible mute and unmute actions for the open conversation', async () => {
    const toggle = vi.spyOn(store, 'setThreadMuted').mockResolvedValue()
    const mute = wrapper.get('[aria-label="Mute thread"]')
    expect(mute.attributes('aria-pressed')).toBe('false')
    await mute.trigger('click')
    expect(toggle).toHaveBeenCalledWith('mute-1', true)

    store.messageBodies.get('mute-1').threadMuted = true
    await nextTick()
    const unmute = wrapper.get('[aria-label="Unmute thread"]')
    expect(unmute.attributes('aria-pressed')).toBe('true')
    await unmute.trigger('click')
    expect(toggle).toHaveBeenLastCalledWith('mute-1', false)
  })

  it('disables the action until thread metadata is loaded and while saving', async () => {
    store.mutingThreadIds.add('thread-1')
    await nextTick()
    expect(wrapper.get('[aria-label="Mute thread"]').element.disabled).toBe(true)
    store.mutingThreadIds.clear()
    store.messageBodies.delete('mute-1')
    await nextTick()
    expect(wrapper.get('[aria-label="Mute thread"]').element.disabled).toBe(true)
  })
})

describe('inline AI reply button', () => {
  let store
  let wrapper
  let finishGeneration
  let requests

  beforeEach(async () => {
    setActivePinia(createPinia())
    store = useInboxStore()
    store.traditionalEmails = [makeEmail('reply-1', Date.now() - HOUR)]
    vi.spyOn(store, 'loadDrafts').mockResolvedValue()
    vi.spyOn(store, 'sendMail').mockResolvedValue({})
    requests = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, options) => {
        if (url === `${AI_API_URL}/compose`) {
          requests.push(JSON.parse(options.body))
          return new Promise((resolve) => {
            finishGeneration = resolve
          })
        }
        return { ok: true, json: async () => ({ message: {} }) }
      }),
    )
    wrapper = mountView({ attachTo: document.body })
    store.openReader(store.traditionalEmails[0])
    await flushPromises()
    await wrapper.get('.ni-email-card [title="Reply"]').trigger('click')
  })

  afterEach(() => {
    wrapper.unmount()
    vi.restoreAllMocks()
  })

  async function typeReply(text) {
    const editor = wrapper.get('.ni-reply-box .composer-editor')
    editor.element.textContent = text
    await editor.trigger('input')
  }

  async function clickAi() {
    await wrapper.get('.ni-reply-ai-btn').trigger('click')
    await flushPromises()
  }

  it('inserts an editable response to the current email and schedules autosave without sending', async () => {
    const save = vi.spyOn(store, 'scheduleReplyDraftSave')
    await typeReply('Please ask about the price.')
    await clickAi()
    expect(requests[0]).toMatchObject({
      replyToMessageId: 'reply-1',
      to: 'sender-reply-1@example.com',
      subject: 'Re: Subject reply-1',
      existingText: 'Please ask about the price.',
    })
    finishGeneration(
      Response.json({
        draft: {
          text: 'Could you confirm the price for <2 items>?',
          subject: 'Ignore this subject',
        },
      }),
    )
    await flushPromises()
    expect(wrapper.get('.ni-reply-box .composer-editor').text()).toBe(
      'Could you confirm the price for <2 items>?',
    )
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Could you confirm the price for <2 items>?',
        subject: 'Re: Subject reply-1',
      }),
    )
    expect(store.isComposerActive).toBe(false)
    expect(store.sendMail).not.toHaveBeenCalled()
  })

  it('shows progress and prevents duplicate requests or sending during generation', async () => {
    await typeReply('Keep this while waiting.')
    await clickAi()
    await clickAi()
    expect(requests).toHaveLength(1)
    expect(wrapper.get('.ni-reply-ai-btn').text()).toContain('Generating…')
    expect(wrapper.get('.ni-reply-ai-btn').attributes('aria-busy')).toBe('true')
    expect(wrapper.get('.ni-reply-footer .btn-primary').attributes()).toHaveProperty('disabled')
    expect(wrapper.get('.ni-reply-box .composer-editor').text()).toBe('Keep this while waiting.')
    finishGeneration(Response.json({ draft: { text: 'Generated reply' } }))
    await flushPromises()
    expect(wrapper.get('.ni-reply-ai-btn').attributes()).not.toHaveProperty('disabled')
    expect(wrapper.get('.ni-reply-footer .btn-primary').attributes()).not.toHaveProperty('disabled')
  })

  it.each(['unavailable', 'empty', 'malformed'])(
    'preserves the current reply when generation is %s',
    async (failure) => {
      await typeReply('My current reply')
      await clickAi()
      finishGeneration(
        failure === 'unavailable'
          ? new Response('', { status: 503 })
          : Response.json({ draft: { text: failure === 'malformed' ? 123 : ' ' } }),
      )
      await flushPromises()
      expect(wrapper.get('.ni-reply-box .composer-editor').text()).toBe('My current reply')
      expect(store.toasts.some((toast) => toast.kind === 'error')).toBe(true)
      expect(wrapper.get('.ni-reply-ai-btn').attributes()).not.toHaveProperty('disabled')
    },
  )

  it('keeps edits made while AI is generating', async () => {
    await clickAi()
    await typeReply('I wrote this while waiting.')
    finishGeneration(Response.json({ draft: { text: 'Late generated reply' } }))
    await flushPromises()
    expect(wrapper.get('.ni-reply-box .composer-editor').text()).toBe('I wrote this while waiting.')
  })

  it('shows the generated response when the editor has focus while waiting', async () => {
    await clickAi()
    const editor = wrapper.get('.ni-reply-box .composer-editor')
    editor.element.focus()
    expect(document.activeElement).toBe(editor.element)
    finishGeneration(Response.json({ draft: { text: 'Visible generated reply' } }))
    await flushPromises()
    expect(editor.text()).toBe('Visible generated reply')
    await wrapper.get('.ni-reply-footer .btn-primary').trigger('click')
    await flushPromises()
    expect(store.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Visible generated reply',
        html: '<p>Visible generated reply</p>',
      }),
    )
  })

  it.each(['discard', 'navigate'])(
    'ignores late responses after %s and reopening the same email',
    async (action) => {
      await clickAi()
      if (action === 'discard') {
        await wrapper
          .findAll('.ni-reply-footer button')
          .find((button) => button.text() === 'Discard')
          .trigger('click')
      } else {
        store.closeReader()
        await flushPromises()
        store.openReader(store.traditionalEmails[0])
        await flushPromises()
      }
      await wrapper.get('.ni-email-card [title="Reply"]').trigger('click')
      finishGeneration(Response.json({ draft: { text: 'Late generated reply' } }))
      await flushPromises()
      expect(wrapper.get('.ni-reply-box .composer-editor').text()).toBe('')
      expect(wrapper.get('.ni-reply-ai-btn').attributes()).not.toHaveProperty('disabled')
    },
  )
})

describe('automatic priority reply drafts', () => {
  let store
  const draft = {
    id: 'priority-draft',
    replyToMessageId: 'priority-1',
    isAiGenerated: true,
    to: 'sender-priority-1@example.com',
    subject: 'Re: Subject priority-1',
    text: 'Thanks for the plan. Which section should I review first?',
    html: null,
    attachments: [],
    followUpAt: null,
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useInboxStore()
    store.traditionalEmails = [{ ...makeEmail('priority-1', Date.now() - HOUR), isPriority: true }]
    vi.spyOn(store, 'loadDrafts').mockResolvedValue()
  })

  it('loads an AI draft summary before displaying or autosaving its reply', async () => {
    store.drafts = [
      {
        id: draft.id,
        replyToMessageId: draft.replyToMessageId,
        isAiGenerated: true,
        isSummary: true,
        preview: 'Thanks',
      },
    ]
    let finish
    vi.spyOn(store, 'loadDraftContent').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const wrapper = mountView()
    store.openReader(store.traditionalEmails[0])
    await flushPromises()
    expect(wrapper.find('.ni-reply-box').exists()).toBe(false)
    finish(draft)
    await flushPromises()
    expect(wrapper.get('.ni-reply-box .composer-editor').text()).toBe(draft.text)
    expect(store.replyDraftId).toBe(draft.id)
    wrapper.unmount()
  })

  it('ignores a loaded AI draft if the reader changes while it is fetching', async () => {
    store.drafts = [{ ...draft, isSummary: true }]
    let finish
    vi.spyOn(store, 'loadDraftContent').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const wrapper = mountView()
    store.openReader(store.traditionalEmails[0])
    await flushPromises()
    store.openEmailId = null
    await flushPromises()
    finish(draft)
    await flushPromises()
    expect(store.replyDraftId).not.toBe(draft.id)
    wrapper.unmount()
  })

  it('shows the saved AI reply beneath the email with Send enabled, without sending it', async () => {
    store.drafts = [{ ...draft }]
    const send = vi.spyOn(store, 'sendMail').mockResolvedValue({})
    const wrapper = mountView()
    store.openReader(store.traditionalEmails[0])
    await flushPromises()
    expect(wrapper.find('.ni-reply-box').exists()).toBe(true)
    expect(wrapper.get('.ni-reply-box').text()).toContain('AI draft')
    expect(wrapper.get('.ni-reply-box .composer-editor').text()).toBe(draft.text)
    expect(wrapper.get('.ni-reply-footer .btn-primary').attributes('disabled')).toBeUndefined()
    expect(store.replyDraftId).toBe('priority-draft')
    expect(send).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('opens a generated draft arriving after the reader, and keeps the user’s edits on refresh', async () => {
    const wrapper = mountView()
    store.openReader(store.traditionalEmails[0])
    await flushPromises()
    store.drafts = [{ ...draft }]
    await flushPromises()
    const editor = wrapper.get('.ni-reply-box .composer-editor')
    editor.element.innerHTML = '<p>My edited reply</p>'
    await editor.trigger('input')
    store.drafts = [{ ...draft, text: 'Older server snapshot' }]
    await flushPromises()
    expect(editor.text()).toBe('My edited reply')
    wrapper.unmount()
  })

  it('does not replace a reply the user has already started', async () => {
    const wrapper = mountView()
    store.openReader(store.traditionalEmails[0])
    await flushPromises()
    await wrapper.get('.ni-email-card [title="Reply"]').trigger('click')
    const editor = wrapper.get('.ni-reply-box .composer-editor')
    editor.element.innerHTML = '<p>Already writing</p>'
    await editor.trigger('input')
    store.drafts = [{ ...draft }]
    await flushPromises()
    expect(editor.text()).toBe('Already writing')
    expect(store.replyDraftId).not.toBe('priority-draft')
    wrapper.unmount()
  })

  it('sends only after clicking Send and removes the saved AI draft', async () => {
    store.drafts = [{ ...draft }]
    const send = vi.spyOn(store, 'sendMail').mockResolvedValue({})
    const wrapper = mountView()
    store.openReader(store.traditionalEmails[0])
    await flushPromises()
    await wrapper.get('.ni-reply-footer .btn-primary').trigger('click')
    await flushPromises()
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: draft.to,
        text: draft.text,
        replyToMessageId: 'priority-1',
      }),
    )
    expect(store.drafts).toEqual([])
    expect(wrapper.find('.ni-reply-box').exists()).toBe(false)
    wrapper.unmount()
  })

  it('saves edits to the original draft when switching to another priority email', async () => {
    store.drafts = [{ ...draft }, { ...draft, id: 'second-draft', replyToMessageId: 'priority-2' }]
    store.traditionalEmails.push({
      ...makeEmail('priority-2', Date.now() - HOUR),
      isPriority: true,
    })
    const persist = vi.spyOn(store, 'persistDraft').mockImplementation(async (id, payload) => {
      store.rememberDraft({ ...payload, id })
      return id
    })
    const wrapper = mountView()
    store.openReader(store.traditionalEmails[0])
    await flushPromises()
    const editor = wrapper.get('.ni-reply-box .composer-editor')
    editor.element.innerHTML = '<p>My reply to the first email</p>'
    await editor.trigger('input')
    store.openReader(store.traditionalEmails[1])
    await flushPromises()
    expect(persist).toHaveBeenCalledWith(
      'priority-draft',
      expect.objectContaining({
        text: 'My reply to the first email',
        replyToMessageId: 'priority-1',
      }),
    )
    expect(store.replyDraftId).toBe('second-draft')
    expect(store.drafts.find((entry) => entry.id === 'priority-draft').text).toBe(
      'My reply to the first email',
    )
    wrapper.unmount()
  })

  it('reopens the latest unsent reply after a failed send and navigation', async () => {
    store.drafts = [{ ...draft }]
    vi.spyOn(store, 'sendMail').mockRejectedValue(new Error('Delivery failed'))
    vi.spyOn(store, 'persistDraft').mockImplementation(async (id, payload) => {
      store.rememberDraft({ ...payload, id })
      return id
    })
    const wrapper = mountView()
    store.openReader(store.traditionalEmails[0])
    await flushPromises()
    const editor = wrapper.get('.ni-reply-box .composer-editor')
    editor.element.innerHTML = '<p>My latest unsent reply</p>'
    await editor.trigger('input')
    await wrapper.get('.ni-reply-footer .btn-primary').trigger('click')
    await flushPromises()
    store.closeReader()
    await flushPromises()
    store.openReader(store.traditionalEmails[0])
    await flushPromises()
    expect(wrapper.get('.ni-reply-box .composer-editor').text()).toBe('My latest unsent reply')
    expect(store.replyDraftId).toBe('priority-draft')
    wrapper.unmount()
  })

  it('keeps the recipient and subject changed in the full composer when reopening the AI draft', async () => {
    store.drafts = [{ ...draft, to: 'other@example.com', subject: 'Updated plan' }]
    const send = vi.spyOn(store, 'sendMail').mockResolvedValue({})
    const wrapper = mountView()
    store.openReader(store.traditionalEmails[0])
    await flushPromises()
    expect(wrapper.get('.ni-reply-header').text()).toContain('other@example.com')
    await wrapper.get('.ni-reply-footer .btn-primary').trigger('click')
    await flushPromises()
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'other@example.com', subject: 'Updated plan' }),
    )
    wrapper.unmount()
  })
})

function makeEmail(id, sentAt) {
  return {
    id,
    sender: `Sender ${id}`,
    address: `sender-${id}@example.com`,
    subject: `Subject ${id}`,
    snippet: 'Snippet',
    body: 'Body',
    date: '10:00',
    sentAt: new Date(sentAt).toISOString(),
    unread: true,
    starred: false,
    labels: [],
  }
}

describe('TraditionalInboxView day accordion', () => {
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useInboxStore()
    store.traditionalEmails = [
      makeEmail('today-1', Date.now() - HOUR),
      makeEmail('yesterday-1', Date.now() - DAY),
      makeEmail('earlier-1', Date.now() - 10 * DAY),
    ]
  })

  function groupHeader(wrapper, label) {
    return wrapper.findAll('.ni-group-header').find((header) => header.text().includes(label))
  }

  it('shows only Today expanded by default', () => {
    const wrapper = mountView()

    const headers = wrapper.findAll('.ni-group-header').map((h) => h.text())
    expect(headers).toHaveLength(3)
    expect(headers[0]).toContain('Today')
    expect(headers[1]).toContain('Yesterday')
    expect(headers[2]).toContain('Earlier')

    const rows = wrapper.findAll('.ni-row')
    expect(rows).toHaveLength(1)
    expect(rows[0].text()).toContain('Subject today-1')

    expect(groupHeader(wrapper, 'Today').attributes('aria-expanded')).toBe('true')
    expect(groupHeader(wrapper, 'Yesterday').attributes('aria-expanded')).toBe('false')
  })

  it('shows auto_awesome before the subject only when an email has an AI summary', async () => {
    store.traditionalEmails[0].hasAiSummary = true
    const plainEmail = makeEmail('today-plain', Date.now() - 2 * HOUR)
    plainEmail.labels = [{ name: 'AI Generated', color: '#7c3aed' }]
    store.traditionalEmails.splice(1, 0, plainEmail)
    const wrapper = mountView()

    const generatedRow = wrapper
      .findAll('.ni-row')
      .find((row) => row.text().includes('Subject today-1'))
    const rowSubject = generatedRow.find('.ni-subject')
    expect(rowSubject.find('.ni-ai-generated-icon').text()).toBe('auto_awesome')
    expect(rowSubject.text()).toContain('auto_awesomeSubject today-1')

    const plainRow = wrapper
      .findAll('.ni-row')
      .find((row) => row.text().includes('Subject today-plain'))
    expect(plainRow.find('.ni-ai-generated-icon').exists()).toBe(false)

    await generatedRow.trigger('click')

    const readerSubject = wrapper.find('.ni-reader-subject')
    expect(readerSubject.find('.ni-ai-generated-icon').text()).toBe('auto_awesome')
    expect(readerSubject.text()).toContain('auto_awesomeSubject today-1')
  })

  it('offers to add a detected email event to the calendar', async () => {
    const eventEmail = makeEmail('event-offer', Date.now() - HOUR)
    eventEmail.sender = 'Campus Tours'
    eventEmail.subject = 'Confirmation: 2099-08-12 guided tour at 10:00 AM'
    eventEmail.snippet = 'Meet at the Visitor Center.'
    store.traditionalEmails.unshift(eventEmail)
    const wrapper = mountView()

    await wrapper
      .findAll('.ni-row')
      .find((row) => row.text().includes('guided tour'))
      .trigger('click')

    expect(wrapper.get('.ni-calendar-suggestion').text()).toContain('Event detected')
    expect(wrapper.get('.ni-calendar-suggestion').text()).toContain('Add to calendar')
    await wrapper.get('.ni-calendar-suggestion-action').trigger('click')

    expect(store.calendarNewEventDraft).toMatchObject({
      title: '2099-08-12 guided tour at 10:00 AM',
      date: '2099-08-12',
      start: '10:00',
      end: '11:00',
    })
    expect(routerPush).toHaveBeenCalledWith({ name: 'calendar' })
  })

  it('detects calendar details after the full message body loads on demand', async () => {
    const eventEmail = makeEmail('event-body', Date.now() - HOUR)
    eventEmail.sender = 'Campus Tours'
    eventEmail.subject = 'Guided tour confirmation'
    eventEmail.snippet = 'Your booking is confirmed.'
    eventEmail.body = undefined
    store.traditionalEmails.unshift(eventEmail)
    const wrapper = mountView()

    await wrapper
      .findAll('.ni-row')
      .find((row) => row.text().includes('Guided tour'))
      .trigger('click')
    expect(wrapper.find('.ni-calendar-suggestion').exists()).toBe(false)

    store.messageBodies.set('event-body', {
      html: null,
      text: 'Meet at the Visitor Center for the August 12th 2099 tour at 10:00 AM.',
    })
    await wrapper.vm.$nextTick()

    expect(wrapper.get('.ni-calendar-suggestion').text()).toContain('Event detected')
  })

  it('uses a cached structured invite and keeps its 30-minute end time', async () => {
    // Tomorrow, not a fixed date: the suggestion is suppressed once the
    // invite has ended, so a hardcoded date turned into a time bomb.
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const inviteStart = new Date(
      tomorrow.getFullYear(),
      tomorrow.getMonth(),
      tomorrow.getDate(),
      15,
      0,
    )
    const inviteEnd = new Date(
      tomorrow.getFullYear(),
      tomorrow.getMonth(),
      tomorrow.getDate(),
      15,
      30,
    )
    const pad2 = (n) => String(n).padStart(2, '0')
    const inviteDate = `${inviteStart.getFullYear()}-${pad2(inviteStart.getMonth() + 1)}-${pad2(inviteStart.getDate())}`
    const eventEmail = makeEmail('event-invite', Date.now() - HOUR)
    eventEmail.subject = 'Booking confirmation'
    eventEmail.body = 'Your booking is confirmed.'
    store.traditionalEmails.unshift(eventEmail)
    const wrapper = mountView()

    await wrapper
      .findAll('.ni-row')
      .find((row) => row.text().includes('Booking confirmation'))
      .trigger('click')

    // Let the open-reader fetch settle before supplying the cached API result.
    await new Promise((resolve) => setTimeout(resolve, 0))
    store.messageBodies.set('event-invite', {
      html: null,
      text: 'Your booking is confirmed.',
      calendarInvite: {
        title: 'Whitburn Recycling Centre',
        description: 'Booking 1292383',
        location: 'Whitburn Recycling Centre',
        start_at: inviteStart.toISOString(),
        end_at: inviteEnd.toISOString(),
      },
    })
    await wrapper.vm.$nextTick()

    expect(wrapper.get('.ni-calendar-suggestion').text()).toContain('Event detected')
    await wrapper.get('.ni-calendar-suggestion-action').trigger('click')
    expect(store.calendarNewEventDraft).toMatchObject({
      title: 'Whitburn Recycling Centre',
      description: 'Booking 1292383',
      location: 'Whitburn Recycling Centre',
      date: inviteDate,
      start: '15:00',
      end: '15:30',
    })
  })

  it('shows due scheduled emails in an expanded Due Today group above Today', () => {
    const due = makeEmail('due-1', Date.now() - 5 * DAY)
    due.scheduledFor = new Date(Date.now() - HOUR).toISOString()
    store.traditionalEmails.unshift(due)
    // Due mail lands in the Important tab, so give it a Today row to sit above.
    store.traditionalEmails[1].isPriority = true

    const wrapper = mountView()
    const headers = wrapper.findAll('.ni-group-header').map((header) => header.text())

    expect(headers[0]).toContain('Due Today')
    expect(headers[1]).toContain('Today')
    expect(groupHeader(wrapper, 'Due Today').attributes('aria-expanded')).toBe('true')
    expect(wrapper.findAll('.ni-row')[0].text()).toContain('Subject due-1')
  })

  it('shows due sent follow-ups in Due Today with a visible reminder badge', () => {
    const followUp = makeEmail('follow-up-1', Date.now() - 5 * DAY)
    followUp.isSent = true
    followUp.unread = false
    followUp.followUpAt = new Date(Date.now() - HOUR).toISOString()
    store.traditionalEmails.unshift(followUp)

    const wrapper = mountView()

    expect(groupHeader(wrapper, 'Due Today').attributes('aria-expanded')).toBe('true')
    const row = wrapper
      .findAll('.ni-row')
      .find((item) => item.text().includes('Subject follow-up-1'))
    expect(row.get('.ni-follow-up-status').text()).toContain('Follow up')
  })

  it('does not render Due Today when no scheduled emails are due', () => {
    const wrapper = mountView()

    expect(groupHeader(wrapper, 'Due Today')).toBeUndefined()
  })

  it('expands a closed group on header click', async () => {
    const wrapper = mountView()

    await groupHeader(wrapper, 'Yesterday').trigger('click')

    const rows = wrapper.findAll('.ni-row').map((r) => r.text())
    expect(rows).toHaveLength(2)
    expect(rows.some((text) => text.includes('Subject yesterday-1'))).toBe(true)
  })

  it('collapses Today on header click', async () => {
    const wrapper = mountView()

    await groupHeader(wrapper, 'Today').trigger('click')

    expect(wrapper.findAll('.ni-row')).toHaveLength(0)
    expect(groupHeader(wrapper, 'Today').attributes('aria-expanded')).toBe('false')
  })

  it('shows the unread count in a group header', () => {
    const wrapper = mountView()

    expect(groupHeader(wrapper, 'Yesterday').find('.ni-group-count').text()).toBe('1')
  })

  it('counts only unread emails, not the group total', () => {
    store.traditionalEmails = [
      { ...makeEmail('y-unread', Date.now() - DAY), unread: true },
      { ...makeEmail('y-read', Date.now() - DAY), unread: false },
    ]
    const wrapper = mountView()

    expect(groupHeader(wrapper, 'Yesterday').find('.ni-group-count').text()).toBe('1')
  })

  it('hides the count badge when a group has no unread emails', () => {
    store.traditionalEmails = [{ ...makeEmail('y-read', Date.now() - DAY), unread: false }]
    const wrapper = mountView()

    expect(groupHeader(wrapper, 'Yesterday').find('.ni-group-count').exists()).toBe(false)
  })
})

describe('TraditionalInboxView group Mark Read tooltip', () => {
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useInboxStore()
    store.traditionalEmails = [
      { ...makeEmail('y-unread-1', Date.now() - DAY), unread: true },
      { ...makeEmail('y-unread-2', Date.now() - DAY - HOUR), unread: true },
      { ...makeEmail('y-read', Date.now() - DAY - 2 * HOUR), unread: false },
    ]
    store.unreadInboxCount = 2
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: {} }) }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function header(wrapper, label) {
    return wrapper.findAll('.ni-group-header').find((h) => h.text().includes(label))
  }

  it('renders a Mark Read tooltip button inside the unread count badge', () => {
    const wrapper = mountView()

    const markRead = header(wrapper, 'Yesterday').find('.ni-group-mark-read')
    expect(markRead.exists()).toBe(true)
    expect(markRead.text()).toContain('Mark Read')
    expect(markRead.attributes('role')).toBe('button')
  })

  it('clicking Mark Read marks every unread email of that day as read', async () => {
    const wrapper = mountView()

    await header(wrapper, 'Yesterday').find('.ni-group-mark-read').trigger('click')

    expect(store.traditionalEmails.every((e) => !e.unread)).toBe(true)
    expect(store.unreadInboxCount).toBe(0)
    // The badge (and with it the tooltip) disappears once nothing is unread.
    await wrapper.vm.$nextTick()
    expect(header(wrapper, 'Yesterday').find('.ni-group-count').exists()).toBe(false)
  })

  it('clicking Mark Read does not toggle the group accordion', async () => {
    const wrapper = mountView()

    expect(header(wrapper, 'Yesterday').attributes('aria-expanded')).toBe('false')
    await header(wrapper, 'Yesterday').find('.ni-group-mark-read').trigger('click')
    expect(header(wrapper, 'Yesterday').attributes('aria-expanded')).toBe('false')
  })

  it('only touches emails of its own day group', async () => {
    store.traditionalEmails.push({ ...makeEmail('today-unread', Date.now() - HOUR), unread: true })
    store.unreadInboxCount = 3
    const wrapper = mountView()

    await header(wrapper, 'Yesterday').find('.ni-group-mark-read').trigger('click')

    expect(store.traditionalEmails.find((e) => e.id === 'today-unread').unread).toBe(true)
    expect(store.traditionalEmails.find((e) => e.id === 'y-unread-1').unread).toBe(false)
    expect(store.unreadInboxCount).toBe(1)
  })
})

describe('TraditionalInboxView filtered views', () => {
  let store

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 14, 12))
    setActivePinia(createPinia())
    store = useInboxStore()
    const starred = makeEmail('starred-1', Date.now() - HOUR)
    starred.starred = true
    const labeled = makeEmail('labeled-1', Date.now() - HOUR)
    labeled.labels = [{ name: 'Home', color: '#ff0000' }]
    store.traditionalEmails = [makeEmail('plain-1', Date.now() - HOUR), starred, labeled]
    store.starredEmails = [starred]
    store.labelEmails = [labeled]
    vi.spyOn(store, 'loadStarredEmails').mockResolvedValue()
    vi.spyOn(store, 'loadLabelEmails').mockResolvedValue()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: {} }) }),
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('filter=starred shows only starred emails with a Starred header', async () => {
    await router.replace({ path: '/inbox', query: { filter: 'starred' } })
    const wrapper = mountView()

    expect(wrapper.find('.ni-header h1').text()).toBe('Starred')
    const rows = wrapper.findAll('.ni-row')
    expect(rows).toHaveLength(1)
    expect(rows[0].text()).toContain('Subject starred-1')
  })

  it('hides starred emails from the inbox', () => {
    const wrapper = mountView()

    const rows = wrapper.findAll('.ni-row').map((row) => row.text())
    expect(rows).toHaveLength(2)
    expect(rows.some((text) => text.includes('Subject starred-1'))).toBe(false)
  })

  it('moves an email from the inbox to the Starred folder as soon as it is starred', async () => {
    store.isStarredLoaded = true
    let wrapper = mountView()

    await wrapper.find('.ni-row [title="Star"]').trigger('click')

    expect(wrapper.findAll('.ni-row').map((row) => row.text())).not.toContain(
      expect.stringContaining('Subject plain-1'),
    )
    expect(store.starredEmails.some((email) => email.id === 'plain-1')).toBe(true)

    wrapper.unmount()
    await router.replace({ path: '/inbox', query: { filter: 'starred' } })
    wrapper = mountView()

    expect(wrapper.findAll('.ni-row').map((row) => row.text())).toContainEqual(
      expect.stringContaining('Subject plain-1'),
    )
  })

  it('keeps starred matches visible in search results', () => {
    store.activeSearchQuery = 'starred'

    const wrapper = mountView()

    expect(wrapper.findAll('.ni-row').map((row) => row.text())).toContainEqual(
      expect.stringContaining('Subject starred-1'),
    )
  })

  it('closes the reader when its email is starred from outside the row', async () => {
    const wrapper = mountView()
    await wrapper.find('.ni-row').trigger('click')

    store.toggleStar(store.openEmail)
    await wrapper.vm.$nextTick()

    expect(store.openEmailId).toBe(null)
    expect(wrapper.find('.ni-reader').exists()).toBe(false)
  })

  it('filter=label shows only emails carrying that label', async () => {
    await router.replace({ path: '/inbox', query: { filter: 'label', label: 'Home' } })
    const wrapper = mountView()

    expect(wrapper.find('.ni-header h1').text()).toBe('Home')
    const rows = wrapper.findAll('.ni-row')
    expect(rows).toHaveLength(1)
    expect(rows[0].text()).toContain('Subject labeled-1')
  })

  it('loads more from the Starred and label folders', async () => {
    store.hasMoreStarred = true
    vi.spyOn(store, 'loadMoreStarredEmails').mockResolvedValue()
    await router.replace({ path: '/inbox', query: { filter: 'starred' } })
    let wrapper = mountView()
    await wrapper.find('.ni-load-more').trigger('click')
    expect(store.loadMoreStarredEmails).toHaveBeenCalledTimes(1)
    wrapper.unmount()

    store.hasMoreLabel = true
    vi.spyOn(store, 'loadMoreLabelEmails').mockResolvedValue()
    await router.replace({ path: '/inbox', query: { filter: 'label', label: 'Home' } })
    wrapper = mountView()
    await wrapper.find('.ni-load-more').trigger('click')
    expect(store.loadMoreLabelEmails).toHaveBeenCalledTimes(1)
  })

  it('filter=snoozed groups future emails by snooze target with both groups open', async () => {
    await router.replace({ path: '/inbox', query: { filter: 'snoozed' } })
    const choices = scheduleChoices()
    const tomorrow = choices.find(({ id }) => id === 'tomorrow')
    const nextWeek = choices.find(({ id }) => id === 'next-week')
    const tomorrowEmail = makeEmail('tomorrow-1', Date.now() - 10 * DAY)
    tomorrowEmail.scheduledFor = tomorrow.date.toISOString()
    const nextWeekEmail = makeEmail('next-week-1', Date.now() - HOUR)
    nextWeekEmail.scheduledFor = nextWeek.date.toISOString()
    store.snoozedEmails = [nextWeekEmail, tomorrowEmail]
    vi.spyOn(store, 'loadSnoozedEmails').mockResolvedValue()
    const wrapper = mountView()

    expect(wrapper.find('.ni-header h1').text()).toBe('Snoozed')
    expect(store.loadSnoozedEmails).toHaveBeenCalledTimes(1)
    const headers = wrapper.findAll('.ni-group-header')
    expect(headers.map((header) => header.text())).toEqual([
      expect.stringContaining('Tomorrow'),
      expect.stringContaining('Next Week'),
    ])
    expect(headers.every((header) => header.attributes('aria-expanded') === 'true')).toBe(true)
    expect(wrapper.findAll('.ni-row').map((row) => row.text())).toEqual([
      expect.stringContaining('Subject tomorrow-1'),
      expect.stringContaining('Subject next-week-1'),
    ])
  })

  it('filter=done loads the hidden Done mailbox and opens completed emails', async () => {
    await router.replace({ path: '/inbox', query: { filter: 'done' } })
    store.doneEmails = [makeEmail('done-1', Date.now() - HOUR)]
    vi.spyOn(store, 'loadDonePage').mockResolvedValue()
    const wrapper = mountView()

    expect(wrapper.find('.ni-header h1').text()).toBe('Done')
    expect(store.loadDonePage).toHaveBeenCalledWith(0)
    expect(wrapper.findAll('.ni-row')).toHaveLength(1)
    expect(wrapper.find('.ni-row').text()).toContain('Subject done-1')
    // Done groups by calendar day.
    expect(wrapper.find('.ni-group-header').text()).toContain('Today')
    expect(wrapper.find('.ni-row [title="Done"]').exists()).toBe(false)

    await wrapper.find('.ni-row').trigger('click')

    expect(wrapper.find('.ni-reader-subject').text()).toBe('Subject done-1')
    expect(wrapper.find('.ni-reader [title="Done"]').exists()).toBe(false)
    expect(wrapper.find('.ni-reader [title="Reschedule"]').exists()).toBe(false)
  })

  it('shows opened status in sent rows and the reader', async () => {
    await router.replace({ path: '/inbox', query: { filter: 'sent' } })
    const sent = makeEmail('sent-opened', Date.now() - HOUR)
    sent.isSent = true
    sent.to = 'reader@example.com'
    sent.unread = false
    sent.readAt = '2026-07-14T10:30:00.000Z'
    store.sentEmails = [sent]
    vi.spyOn(store, 'loadSentEmails').mockResolvedValue()

    const wrapper = mountView()

    const rowStatus = wrapper.get('.ni-row .ni-read-status')
    expect(rowStatus.text()).toContain('Opened')
    expect(rowStatus.attributes('title')).toContain('Opened 14 Jul')

    await wrapper.get('.ni-row').trigger('click')
    expect(wrapper.get('.ni-reader .ni-read-status').text()).toContain('Opened 14 Jul')
  })

  it('sets and clears a follow-up reminder from the sent-message reader', async () => {
    await router.replace({ path: '/inbox', query: { filter: 'sent' } })
    const sent = makeEmail('sent-reminder', Date.now() - HOUR)
    sent.isSent = true
    sent.to = 'reader@example.com'
    sent.unread = false
    store.sentEmails = [sent]
    vi.spyOn(store, 'loadSentEmails').mockResolvedValue()
    const setFollowUp = vi
      .spyOn(store, 'setMessageFollowUp')
      .mockImplementation(async (email, followUpAt) => {
        email.followUpAt = followUpAt
        return { id: email.id, followUpAt }
      })

    const wrapper = mountView()
    await wrapper.get('.ni-row').trigger('click')
    await wrapper.get('.ni-reader-topbar [title="Remind me if no reply"]').trigger('click')
    const tomorrow = wrapper
      .findAll('.ni-reader-topbar .ni-schedule-menu [role="menuitem"]')
      .find((choice) => choice.text().includes('Tomorrow'))
    await tomorrow.trigger('click')

    expect(setFollowUp).toHaveBeenCalledWith(sent, expect.any(String))
    await wrapper.get('.ni-reader-topbar [title^="Follow-up reminder:"]').trigger('click')
    const clear = wrapper
      .findAll('.ni-reader-topbar .ni-schedule-menu [role="menuitem"]')
      .find((choice) => choice.text().includes('Clear reminder'))
    await clear.trigger('click')

    expect(setFollowUp).toHaveBeenLastCalledWith(sent, null)
  })

  it('an unknown filter falls back to the unstarred inbox', async () => {
    await router.replace({ path: '/inbox', query: { filter: 'bogus' } })
    const wrapper = mountView()

    expect(wrapper.find('.ni-header').exists()).toBe(false)
    expect(wrapper.findAll('.ni-row')).toHaveLength(2)
  })
})

describe('TraditionalInboxView AI summary marker across email lists', () => {
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useInboxStore()
    vi.spyOn(store, 'loadSentEmails').mockResolvedValue()
    vi.spyOn(store, 'loadSpamEmails').mockResolvedValue()
    vi.spyOn(store, 'loadSnoozedEmails').mockResolvedValue()
    vi.spyOn(store, 'loadStarredEmails').mockResolvedValue()
    vi.spyOn(store, 'loadLabelEmails').mockResolvedValue()
    vi.spyOn(store, 'loadDonePage').mockResolvedValue()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([
    ['Inbox', {}, 'traditionalEmails'],
    ['Starred', { filter: 'starred' }, 'starredEmails'],
    ['Label', { filter: 'label', label: 'Projects' }, 'labelEmails'],
    ['Sent', { filter: 'sent' }, 'sentEmails'],
    ['Spam', { filter: 'spam' }, 'spamEmails'],
    ['Snoozed', { filter: 'snoozed' }, 'snoozedEmails'],
    ['Done', { filter: 'done' }, 'doneEmails'],
    ['Search', {}, 'traditionalEmails'],
  ])('shows the AI icon in the %s list', async (_name, query, listName) => {
    await router.replace({ path: '/inbox', query })
    const email = makeEmail(`summary-${listName}`, Date.now() - HOUR)
    email.hasAiSummary = true
    if (query.filter === 'starred') email.starred = true
    if (query.filter === 'label') email.labels = [{ name: 'Projects', color: '#7c3aed' }]
    if (query.filter === 'snoozed') email.scheduledFor = new Date(Date.now() + DAY).toISOString()
    store[listName] = [email]
    if (_name === 'Search') store.activeSearchQuery = 'summary'

    const wrapper = mountView()

    expect(wrapper.find('.ni-row .ni-ai-generated-icon').text()).toBe('auto_awesome')
    wrapper.unmount()
  })
})

describe('TraditionalInboxView reading panel', () => {
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useInboxStore()
    store.traditionalEmails = [makeEmail('today-1', Date.now() - HOUR)]
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: {} }) }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('clicking a row opens the reader through the store', async () => {
    const wrapper = mountView()

    await wrapper.find('.ni-row').trigger('click')
    expect(store.openEmailId).toBe('today-1')
    expect(wrapper.find('.ni-reader').exists()).toBe(true)
  })

  it('closes the reader when the open email is archived from outside the view', async () => {
    const wrapper = mountView()

    await wrapper.find('.ni-row').trigger('click')
    store.archiveEmail(store.openEmail)
    await wrapper.vm.$nextTick()

    expect(store.openEmailId).toBe(null)
    expect(wrapper.find('.ni-reader').exists()).toBe(false)
  })

  it('renders the whole conversation around the open email, oldest first and collapsed', async () => {
    store.messageBodies.set('today-1', {
      html: null,
      text: 'Body',
      thread: [
        { id: 'older', from_name: 'Alice', snippet: 'The first message', sent_at: '2026-01-01' },
        { id: 'today-1', from_name: 'Sender today-1', snippet: 'Snippet', sent_at: '2026-01-02' },
        { id: 'newer', from_name: 'Bob', snippet: 'A later reply', sent_at: '2026-01-03' },
      ],
      attachments: [],
    })
    const wrapper = mountView()
    await wrapper.find('.ni-row').trigger('click')

    expect(wrapper.get('.ni-thread-toolbar').text()).toContain('3 messages')
    const cards = wrapper.findAll('.ni-conversation > *')
    expect(cards.map((card) => card.classes().includes('ni-email-card'))).toEqual([
      false,
      true,
      false,
    ])
    expect(cards[0].text()).toContain('The first message')
    expect(cards[2].text()).toContain('A later reply')
    expect(wrapper.findAll('.ni-thread-message-open')).toHaveLength(0)
  })

  it('expands a conversation message to its fetched body and collapses it again', async () => {
    store.messageBodies.set('today-1', {
      html: null,
      text: 'Body',
      thread: [
        { id: 'older', from_name: 'Alice', snippet: 'The first message', sent_at: '2026-01-01' },
        { id: 'today-1', from_name: 'Sender today-1', snippet: 'Snippet', sent_at: '2026-01-02' },
      ],
      attachments: [],
    })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'older', body_html: null, body_text: 'The complete first message' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountView()
    await wrapper.find('.ni-row').trigger('click')

    await wrapper.get('.ni-thread-message').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith(
      `${MESSAGES_API_URL}/messages?id=older`,
      expect.anything(),
    )
    const opened = wrapper.get('.ni-thread-message-open')
    expect(opened.text()).toContain('The complete first message')
    expect(opened.text()).toContain('Alice')

    await opened.get('[aria-label="Collapse message"]').trigger('click')
    expect(wrapper.find('.ni-thread-message-open').exists()).toBe(false)
    expect(wrapper.get('.ni-thread-message').text()).toContain('The first message')
  })

  it('Expand all opens every other message and Collapse all closes them', async () => {
    store.messageBodies.set('today-1', {
      html: null,
      text: 'Body',
      thread: [
        { id: 'older', from_name: 'Alice', snippet: 'First', sent_at: '2026-01-01' },
        { id: 'today-1', from_name: 'Sender today-1', snippet: 'Snippet', sent_at: '2026-01-02' },
        { id: 'newer', from_name: 'Bob', snippet: 'Later', sent_at: '2026-01-03' },
      ],
      attachments: [],
    })
    const wrapper = mountView()
    await wrapper.find('.ni-row').trigger('click')

    const toggleAll = wrapper.get('.ni-thread-toggle-all')
    expect(toggleAll.text()).toBe('Expand all')
    await toggleAll.trigger('click')

    expect(wrapper.findAll('.ni-thread-message-open')).toHaveLength(2)
    expect(toggleAll.text()).toBe('Collapse all')

    await toggleAll.trigger('click')
    expect(wrapper.findAll('.ni-thread-message-open')).toHaveLength(0)
    expect(wrapper.findAll('.ni-thread-message')).toHaveLength(2)
  })
})

describe('TraditionalInboxView reply send button', () => {
  let store
  let wrapper

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useInboxStore()
    store.traditionalEmails = [makeEmail('today-1', Date.now() - HOUR)]
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: {} }) }),
    )
  })

  afterEach(() => {
    wrapper?.unmount()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  async function openReplyBox() {
    wrapper = mountView()
    await wrapper.find('.ni-row').trigger('click')
    await wrapper.find('.ni-reader-footer .ni-pill-btn').trigger('click')
    // The reply body is the shared rich compose editor (contenteditable), not
    // a textarea — set content and fire input like a user typing.
    const editor = wrapper.find('.ni-reply-box .composer-editor')
    editor.element.innerHTML = 'Sounds good!'
    await editor.trigger('input')
    return wrapper.find('.ni-reply-footer .btn-primary')
  }

  it('disables the Send button while the reply is in flight', async () => {
    let resolveSend
    vi.spyOn(store, 'sendMail').mockReturnValue(
      new Promise((resolve) => {
        resolveSend = resolve
      }),
    )
    const sendButton = await openReplyBox()
    expect(sendButton.attributes()).not.toHaveProperty('disabled')

    await sendButton.trigger('click')

    expect(sendButton.attributes()).toHaveProperty('disabled')
    expect(sendButton.attributes('aria-busy')).toBe('true')
    expect(sendButton.text()).toContain('Sending…')

    resolveSend()
    await vi.waitFor(() => expect(wrapper.find('.ni-reply-box').exists()).toBe(false))
  })

  it('sends only once when Send is clicked twice in quick succession', async () => {
    vi.spyOn(store, 'sendMail').mockReturnValue(new Promise(() => {}))
    const sendButton = await openReplyBox()

    await sendButton.trigger('click')
    await sendButton.trigger('click')

    expect(store.sendMail).toHaveBeenCalledTimes(1)
  })

  it('re-enables the Send button after a failed send so the user can retry', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(store, 'sendMail').mockRejectedValue(new Error('boom'))
    const sendButton = await openReplyBox()

    await sendButton.trigger('click')
    await vi.waitFor(() => {
      expect(store.toasts.some((toast) => toast.kind === 'error')).toBe(true)
    })

    expect(sendButton.attributes()).not.toHaveProperty('disabled')
    expect(sendButton.text()).toContain('Send')
    expect(wrapper.find('.ni-reply-box').exists()).toBe(true)
    expect(consoleError).toHaveBeenCalledWith('Failed to send reply:', expect.any(Error))
  })

  it('inserts a picked emoji as an emoticon in the reply body', async () => {
    vi.spyOn(store, 'sendMail').mockResolvedValue({})
    const sendButton = await openReplyBox()

    await wrapper.get('.ni-reply-footer .composer-emoji-btn').trigger('click')
    await wrapper.get('.composer-emoji-item[aria-label="thumbs up"]').trigger('click')

    expect(wrapper.find('.composer-emoji-popover').exists()).toBe(false)
    expect(wrapper.get('.ni-reply-box .composer-editor').text()).toContain('+1')

    await sendButton.trigger('click')
    expect(store.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('+1'),
        html: expect.stringContaining('+1'),
      }),
    )
  })

  it('sends the reply as sanitized html alongside its plain text', async () => {
    vi.spyOn(store, 'sendMail').mockResolvedValue({})
    const sendButton = await openReplyBox()

    await sendButton.trigger('click')

    expect(store.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'sender-today-1@example.com',
        text: 'Sounds good!',
        html: expect.stringContaining('Sounds good!'),
      }),
    )
  })

  function seedGroupEmail() {
    store.traditionalEmails = [
      {
        ...makeEmail('today-1', Date.now() - HOUR),
        recipients: {
          to: [
            { name: 'Me', address: SELF_EMAIL },
            { name: 'Bea', address: 'bea@example.com' },
          ],
          cc: [
            { name: null, address: 'cara@example.com' },
            // Same person as the sender, differing only in case.
            { name: null, address: 'Sender-Today-1@example.com' },
          ],
        },
      },
    ]
  }

  it('replies to everyone except the signed-in account from the reply-all icon', async () => {
    seedGroupEmail()
    vi.spyOn(store, 'sendMail').mockResolvedValue({})
    wrapper = mountView()
    await wrapper.find('.ni-row').trigger('click')

    await wrapper.get('.ni-reader [title="Reply all"]').trigger('click')
    expect(wrapper.get('.ni-reply-header span:last-child').text()).toBe(
      'Reply all to Sender today-1, Bea, cara@example.com',
    )
    expect(wrapper.get('.ni-reply-header .material-symbols-outlined').text()).toBe('reply_all')

    const editor = wrapper.find('.ni-reply-box .composer-editor')
    editor.element.innerHTML = 'Sounds good!'
    await editor.trigger('input')
    await wrapper.find('.ni-reply-footer .btn-primary').trigger('click')

    expect(store.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'sender-today-1@example.com, bea@example.com, cara@example.com',
        subject: 'Re: Subject today-1',
        replyToMessageId: 'today-1',
      }),
    )
  })

  it('switching between Reply and Reply all keeps the draft and changes only the recipients', async () => {
    seedGroupEmail()
    vi.spyOn(store, 'sendMail').mockResolvedValue({})
    wrapper = mountView()
    await wrapper.find('.ni-row').trigger('click')

    await wrapper.get('.ni-reader [title="Reply all"]').trigger('click')
    const editor = wrapper.find('.ni-reply-box .composer-editor')
    editor.element.innerHTML = 'Sounds good!'
    await editor.trigger('input')

    await wrapper.get('.ni-reader [title="Reply"]').trigger('click')
    expect(wrapper.get('.ni-reply-header span:last-child').text()).toBe('Reply to Sender today-1')
    expect(wrapper.get('.ni-reply-box .composer-editor').text()).toContain('Sounds good!')

    await wrapper.find('.ni-reply-footer .btn-primary').trigger('click')
    expect(store.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'sender-today-1@example.com' }),
    )
  })

  it('hides Reply all when the message went to a single contact', async () => {
    store.traditionalEmails = [
      {
        ...makeEmail('today-1', Date.now() - HOUR),
        recipients: { to: [{ name: null, address: SELF_EMAIL }], cc: [] },
      },
    ]
    wrapper = mountView()
    await wrapper.find('.ni-row').trigger('click')

    expect(wrapper.find('.ni-reader [title="Reply"]').exists()).toBe(true)
    expect(wrapper.find('.ni-reader [title="Reply all"]').exists()).toBe(false)
  })

  it('shows Reply all for a message sent to someone else, such as a list', async () => {
    store.traditionalEmails = [
      {
        ...makeEmail('today-1', Date.now() - HOUR),
        recipients: { to: [{ name: null, address: 'team@example.com' }], cc: [] },
      },
    ]
    wrapper = mountView()
    await wrapper.find('.ni-row').trigger('click')

    expect(wrapper.find('.ni-reader [title="Reply all"]').exists()).toBe(true)
  })

  it('shows Reply all when the second contact is only on the Cc line', async () => {
    store.traditionalEmails = [
      {
        ...makeEmail('today-1', Date.now() - HOUR),
        recipients: {
          to: [{ name: null, address: SELF_EMAIL }],
          cc: [{ name: null, address: 'cara@example.com' }],
        },
      },
    ]
    wrapper = mountView()
    await wrapper.find('.ni-row').trigger('click')

    expect(wrapper.find('.ni-reader [title="Reply all"]').exists()).toBe(true)
  })

  it('hides Reply all when the only other addresses are the sender and the signed-in account', async () => {
    store.traditionalEmails = [
      {
        ...makeEmail('today-1', Date.now() - HOUR),
        recipients: {
          to: [{ name: null, address: SELF_EMAIL }],
          cc: [
            { name: 'Me', address: SELF_EMAIL.toUpperCase() },
            { name: null, address: 'Sender-Today-1@example.com' },
          ],
        },
      },
    ]
    wrapper = mountView()
    await wrapper.find('.ni-row').trigger('click')

    expect(wrapper.find('.ni-reader [title="Reply all"]').exists()).toBe(false)
  })

  it('carries the reply-all recipients into the composer for an AI draft', async () => {
    seedGroupEmail()
    vi.spyOn(store, 'openComposer').mockImplementation(() => {})
    vi.spyOn(store, 'openAiDraft').mockImplementation(() => {})
    wrapper = mountView()
    await wrapper.find('.ni-row').trigger('click')

    await wrapper.get('.ni-reader [title="Reply all"]').trigger('click')
    wrapper.findComponent({ name: 'ComposerEditor' }).vm.$emit('generate')
    await nextTick()

    expect(store.composerTo).toBe('sender-today-1@example.com, bea@example.com, cara@example.com')
    expect(store.composerReplyToMessageId).toBe('today-1')
    expect(store.openComposer).toHaveBeenCalled()
  })

  it('sends the selected follow-up reminder with an inline reply', async () => {
    vi.spyOn(store, 'sendMail').mockResolvedValue({})
    const sendButton = await openReplyBox()

    await wrapper.get('.ni-follow-up-btn').trigger('click')
    const tomorrow = wrapper
      .findAll('.ni-reply-footer .ni-schedule-menu [role="menuitem"]')
      .find((choice) => choice.text().includes('Tomorrow'))
    await tomorrow.trigger('click')
    await sendButton.trigger('click')

    expect(store.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        followUpAt: expect.any(String),
      }),
    )
  })

  it('offers slash commands, including saved snippets, in the reply editor', async () => {
    store.snippets = [{ id: 's1', name: 'thanks', html: '<p>Thanks!</p>' }]
    wrapper = mountView({ attachTo: document.body })
    await wrapper.find('.ni-row').trigger('click')
    await wrapper.find('.ni-reader-footer .ni-pill-btn').trigger('click')

    const editor = wrapper.find('.ni-reply-box .composer-editor')
    editor.element.textContent = '/'
    editor.element.focus()
    const range = document.createRange()
    range.setStart(editor.element.firstChild, 1)
    range.collapse(true)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
    await editor.trigger('input')

    const menu = wrapper.find('.ni-reply-box .composer-slash-menu')
    expect(menu.exists()).toBe(true)
    expect(menu.text()).toContain('thanks')
    expect(menu.text()).toContain('Generate Message')
    expect(menu.text()).toContain('Bullet list')
  })
})

describe('TraditionalInboxView multi-select', () => {
  let store

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-07-14T12:00:00Z'))
    setActivePinia(createPinia())
    store = useInboxStore()
    store.traditionalEmails = [
      makeEmail('today-1', Date.now() - HOUR),
      makeEmail('today-2', Date.now() - 2 * HOUR),
      makeEmail('today-3', Date.now() - 3 * HOUR),
    ]
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: {} }) }),
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function checkbox(wrapper, index) {
    return wrapper.findAll('.ni-row .ni-checkbox')[index]
  }

  it('clicking a row checkbox selects it without opening the reader', async () => {
    const wrapper = mountView()

    await checkbox(wrapper, 0).trigger('click')

    expect(checkbox(wrapper, 0).attributes('aria-checked')).toBe('true')
    expect(checkbox(wrapper, 0).text()).toContain('check_box')
    expect(store.openEmailId).toBe(null)
    expect(wrapper.find('.ni-bulk-bar').text()).toContain('1 selected')
  })

  it('selecting several shows the count and the three bulk pills', async () => {
    const wrapper = mountView()

    await checkbox(wrapper, 0).trigger('click')
    await checkbox(wrapper, 1).trigger('click')

    const bar = wrapper.find('.ni-bulk-bar')
    expect(bar.text()).toContain('2 selected')
    const pills = bar.findAll('.ni-bulk-pill').map((p) => p.text())
    expect(pills.some((t) => t.includes('Star'))).toBe(true)
    expect(pills.some((t) => t.includes('Done'))).toBe(true)
    expect(pills.some((t) => t.includes('Reschedule'))).toBe(true)
  })

  it('the bulk Reschedule pill offers richer presets and a custom picker', async () => {
    const wrapper = mountView()
    await checkbox(wrapper, 0).trigger('click')

    await wrapper
      .findAll('.ni-bulk-pill')
      .find((pill) => pill.text().includes('Reschedule'))
      .trigger('click')

    const choices = wrapper.findAll('.ni-schedule-menu [role="menuitem"]')
    // scheduleChoices drops a preset that names the same day as another
    // (on a Friday "This weekend" is "Tomorrow"), so the expected list is
    // whatever today's presets are, plus the picker.
    expect(choices.map((choice) => choice.text())).toEqual([
      ...scheduleChoices().map(({ label }) => expect.stringContaining(label)),
      expect.stringContaining('Pick date & time'),
    ])
  })

  it('the Done pill archives every selected email and hides the bar', async () => {
    vi.spyOn(useInboxStore(), 'archiveEmail')
    const wrapper = mountView()

    await checkbox(wrapper, 0).trigger('click')
    await checkbox(wrapper, 1).trigger('click')
    await wrapper
      .findAll('.ni-bulk-pill')
      .find((p) => p.text().includes('Done'))
      .trigger('click')

    expect(store.archiveEmail).toHaveBeenCalledTimes(2)
    const ids = store.archiveEmail.mock.calls.map(([email]) => email.id)
    expect(ids.sort()).toEqual(['today-1', 'today-2'])
    expect(wrapper.find('.ni-bulk-bar').exists()).toBe(false)
  })

  it('the Star pill stars every selected email and clears the selection', async () => {
    const wrapper = mountView()

    await checkbox(wrapper, 0).trigger('click')
    await checkbox(wrapper, 1).trigger('click')
    await wrapper
      .findAll('.ni-bulk-pill')
      .find((p) => p.text().includes('Star'))
      .trigger('click')

    expect(store.traditionalEmails.find((e) => e.id === 'today-1').starred).toBe(true)
    expect(store.traditionalEmails.find((e) => e.id === 'today-2').starred).toBe(true)
    expect(store.traditionalEmails.find((e) => e.id === 'today-3').starred).toBe(false)
    expect(wrapper.find('.ni-bulk-bar').exists()).toBe(false)
  })

  it('Escape clears the selection first and only then closes the reader', async () => {
    const wrapper = mountView()
    await wrapper.findAll('.ni-row')[2].trigger('click')
    await checkbox(wrapper, 0).trigger('click')
    expect(store.openEmailId).toBe('today-3')

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.ni-bulk-bar').exists()).toBe(false)
    expect(checkbox(wrapper, 0).attributes('aria-checked')).toBe('false')
    expect(store.openEmailId).toBe('today-3')

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(store.openEmailId).toBe(null)

    wrapper.unmount()
  })
})

describe('TraditionalInboxView Done action (replaces Archive/Delete)', () => {
  let store

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-07-14T12:00:00Z'))
    setActivePinia(createPinia())
    store = useInboxStore()
    store.traditionalEmails = [makeEmail('today-1', Date.now() - HOUR)]
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: {} }) }),
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('rows offer a single Done action with a checkbox icon and no Delete or Archive', () => {
    const wrapper = mountView()
    const row = wrapper.find('.ni-row')

    const done = row.find('[title="Done"]')
    expect(done.exists()).toBe(true)
    expect(done.text()).toContain('check_box')
    expect(row.find('[title="Delete"]').exists()).toBe(false)
    expect(row.find('[title="Archive"]').exists()).toBe(false)
  })

  it('clicking Done archives the email', async () => {
    vi.spyOn(useInboxStore(), 'archiveEmail')
    const wrapper = mountView()

    await wrapper.find('.ni-row [title="Done"]').trigger('click')

    expect(store.archiveEmail).toHaveBeenCalledTimes(1)
    expect(store.archiveEmail.mock.calls[0][0].id).toBe('today-1')
  })

  it('welcomes the user to Inbox Zero after the last email is marked Done', async () => {
    const wrapper = mountView()

    expect(wrapper.find('.ni-inbox-zero').exists()).toBe(false)
    await wrapper.find('.ni-row [title="Done"]').trigger('click')

    const inboxZero = wrapper.find('.ni-inbox-zero')
    expect(inboxZero.attributes('role')).toBe('status')
    const image = inboxZero.find('img')
    expect(image.attributes('src')).toContain('inbox-zero.png')
    expect(image.attributes('alt')).toBe('Congratulations! Inbox Zero. You did it!')
  })

  it('the reader topbar offers Star, Done and Reschedule with no Delete or Archive', async () => {
    const wrapper = mountView()
    await wrapper.find('.ni-row').trigger('click')

    const topbar = wrapper.find('.ni-reader-topbar')
    const star = topbar.find('[title="Star"]')
    const done = topbar.find('[title="Done"]')
    const reschedule = topbar.find('[title="Reschedule"]')
    expect(star.exists()).toBe(true)
    expect(star.text()).toContain('star_border')
    expect(done.exists()).toBe(true)
    expect(done.text()).toContain('check_box')
    expect(reschedule.exists()).toBe(true)
    expect(reschedule.text()).toContain('schedule')
    expect(topbar.find('[title="Delete"]').exists()).toBe(false)
    expect(topbar.find('[title="Archive"]').exists()).toBe(false)
  })

  it('the reader topbar offers Report spam with the report icon for inbound mail', async () => {
    const wrapper = mountView()
    await wrapper.find('.ni-row').trigger('click')

    const spam = wrapper.find('.ni-reader-topbar [title="Report spam"]')
    expect(spam.exists()).toBe(true)
    expect(spam.text()).toContain('report')
    expect(spam.attributes('aria-pressed')).toBe('false')
    expect(wrapper.find('.ni-reader-topbar [title="Not spam"]').exists()).toBe(false)
  })

  it('hides Report spam for sent mail', async () => {
    store.traditionalEmails = [{ ...makeEmail('sent-1', Date.now() - HOUR), isSent: true }]
    const wrapper = mountView()
    await wrapper.find('.ni-row').trigger('click')

    expect(wrapper.find('.ni-reader-topbar [title="Report spam"]').exists()).toBe(false)
  })

  it('clicking Report spam records the verdict and advances to the next email', async () => {
    store.traditionalEmails = [
      makeEmail('today-1', Date.now() - HOUR),
      makeEmail('today-2', Date.now() - 2 * HOUR),
    ]
    store.isInboxLoaded = true
    vi.spyOn(store, 'setSpam')
    const wrapper = mountView()
    await wrapper.find('.ni-row').trigger('click')

    await wrapper.find('.ni-reader-topbar [title="Report spam"]').trigger('click')

    expect(store.setSpam).toHaveBeenCalledTimes(1)
    expect(store.setSpam.mock.calls[0][0].id).toBe('today-1')
    expect(store.setSpam.mock.calls[0][1]).toBe(true)
    expect(store.traditionalEmails.map((e) => e.id)).toEqual(['today-2'])
    expect(store.openEmailId).toBe('today-2')
  })

  it('keeps the reader on the row in Starred, without marking it read again', async () => {
    await router.replace({ path: '/inbox', query: { filter: 'starred' } })
    vi.spyOn(store, 'loadStarredEmails').mockResolvedValue()
    store.starredEmails = [{ ...makeEmail('star-1', Date.now() - HOUR), starred: true }]
    store.isStarredLoaded = true
    const wrapper = mountView()
    await wrapper.find('.ni-row').trigger('click')
    store.starredEmails[0].unread = true
    const setUnread = vi.spyOn(store, 'setUnread')

    await wrapper.find('.ni-reader-topbar [title="Report spam"]').trigger('click')

    expect(store.openEmailId).toBe('star-1')
    expect(store.starredEmails[0].isSpam).toBe(true)
    expect(store.starredEmails[0].unread).toBe(true)
    expect(setUnread).not.toHaveBeenCalled()
    expect(wrapper.find('.ni-reader-topbar [title="Not spam"]').exists()).toBe(true)
  })

  it('offers Not spam with the report_off icon in the Spam folder', async () => {
    await router.replace({ path: '/inbox', query: { filter: 'spam' } })
    vi.spyOn(store, 'loadSpamEmails').mockResolvedValue()
    store.spamEmails = [{ ...makeEmail('spam-1', Date.now() - HOUR), isSpam: true }]
    store.isSpamLoaded = true
    vi.spyOn(store, 'setSpam')
    const wrapper = mountView()
    await wrapper.find('.ni-row').trigger('click')

    const notSpam = wrapper.find('.ni-reader-topbar [title="Not spam"]')
    expect(notSpam.exists()).toBe(true)
    expect(notSpam.text()).toContain('report_off')
    expect(notSpam.attributes('aria-pressed')).toBe('true')

    await notSpam.trigger('click')

    expect(store.setSpam.mock.calls[0][0].id).toBe('spam-1')
    expect(store.setSpam.mock.calls[0][1]).toBe(false)
    expect(store.spamEmails).toEqual([])
  })

  it('the reader Star action stars the open email', async () => {
    vi.spyOn(store, 'toggleStar')
    const wrapper = mountView()
    await wrapper.find('.ni-row').trigger('click')

    await wrapper.find('.ni-reader-topbar [title="Star"]').trigger('click')

    expect(store.toggleStar).toHaveBeenCalledTimes(1)
    expect(store.toggleStar.mock.calls[0][0].id).toBe('today-1')
  })

  it('the reader Reschedule action schedules the email for Tomorrow', async () => {
    vi.spyOn(store, 'authHeaders').mockResolvedValue({})
    const wrapper = mountView()
    await wrapper.find('.ni-row').trigger('click')

    await wrapper.find('.ni-reader-topbar [title="Reschedule"]').trigger('click')
    const choices = wrapper.findAll('.ni-reader-topbar .ni-schedule-menu [role="menuitem"]')
    // scheduleChoices drops a preset that names the same day as another
    // (on a Friday "This weekend" is "Tomorrow"), so the expected list is
    // whatever today's presets are, plus the picker.
    expect(choices.map((choice) => choice.text())).toEqual([
      ...scheduleChoices().map(({ label }) => expect.stringContaining(label)),
      expect.stringContaining('Pick date & time'),
    ])
    await choices[1].trigger('click')

    await vi.waitFor(() => {
      const patchRequest = fetch.mock.calls.find(([, options]) => {
        if (options?.method !== 'PATCH') return false
        return Object.hasOwn(JSON.parse(options.body), 'scheduled_for')
      })
      expect(JSON.parse(patchRequest[1].body)).toMatchObject({
        id: 'today-1',
        scheduled_for: expect.any(String),
      })
    })
    await vi.waitFor(() => {
      expect(store.toasts.some((toast) => toast.message === 'Scheduled for Tomorrow.')).toBe(true)
      expect(store.traditionalEmails).toHaveLength(0)
    })
  })

  it('the reader custom picker schedules the selected local date and time', async () => {
    vi.spyOn(store, 'authHeaders').mockResolvedValue({})
    const wrapper = mountView()
    await wrapper.find('.ni-row').trigger('click')

    await wrapper.find('.ni-reader-topbar [title="Reschedule"]').trigger('click')
    const custom = wrapper
      .findAll('.ni-reader-topbar .ni-schedule-menu [role="menuitem"]')
      .find((choice) => choice.text().includes('Pick date & time'))
    await custom.trigger('click')
    const target = new Date(Date.now() + 3 * DAY)
    target.setHours(14, 30, 0, 0)
    const pad = (n) => String(n).padStart(2, '0')
    const localValue = `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}T14:30`
    await wrapper.find('.ni-schedule-custom input').setValue(localValue)
    await wrapper.find('.ni-schedule-custom').trigger('submit')

    await vi.waitFor(() => {
      const patchRequest = fetch.mock.calls.find(([, options]) => {
        if (options?.method !== 'PATCH') return false
        return Object.hasOwn(JSON.parse(options.body), 'scheduled_for')
      })
      expect(JSON.parse(patchRequest[1].body)).toMatchObject({
        id: 'today-1',
        scheduled_for: target.toISOString(),
      })
    })
  })
})

describe('TraditionalInboxView AI summary', () => {
  let store
  let wrapper

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useInboxStore()
    const email = makeEmail('11111111-1111-1111-1111-111111111111', Date.now() - HOUR)
    email.unread = false
    email.labels = [{ name: 'Projects', color: '#7c3aed' }]
    store.traditionalEmails = [email]
    vi.spyOn(store, 'fetchMessageBody').mockResolvedValue(null)
    vi.spyOn(store, 'authHeaders').mockResolvedValue({ 'Content-Type': 'application/json' })
  })

  afterEach(() => {
    wrapper?.unmount()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('automatically shows a one-line live thread summary beneath the subject', async () => {
    let resolveSummary
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveSummary = resolve
        }),
      ),
    )
    const email = store.traditionalEmails[0]
    const body = {
      threadId: 'thread-1',
      threadLatestMessageId: email.id,
      thread: [
        {
          id: 'earlier',
          from_name: 'Contractor',
          from_address: 'contractor@example.com',
          snippet: 'Earlier update',
          sent_at: new Date(Date.now() - 2 * HOUR).toISOString(),
        },
        { id: email.id },
      ],
    }
    store.messageBodies.set(email.id, body)
    store.fetchMessageBody.mockResolvedValue(body)
    wrapper = mountView()
    await wrapper.find('.ni-row').trigger('click')

    await vi.waitFor(() => expect(store.isOpenSummaryLoading).toBe(true))
    const summary = wrapper.find('.ni-reader-subject + .ni-thread-summary')
    expect(summary.text()).toContain('Summarizing thread…')
    expect(summary.find('.ni-summary-spinner').exists()).toBe(true)
    expect(wrapper.find('.ni-summarize-btn').exists()).toBe(false)

    resolveSummary({
      ok: true,
      json: async () => ({
        summary: 'The contractor confirmed the Tuesday delivery.\nNo reply is needed.',
        threadId: 'thread-1',
        latestMessageId: email.id,
      }),
    })
    await vi.waitFor(() => expect(store.isOpenSummaryLoading).toBe(false))

    expect(summary.exists()).toBe(true)
    expect(summary.find('.ni-thread-summary-text').text()).toBe(
      'The contractor confirmed the Tuesday delivery. No reply is needed.',
    )
    expect(wrapper.find('.ni-reader-subject .ni-ai-generated-icon').text()).toBe('auto_awesome')
    expect(wrapper.find('.ni-row .ni-ai-generated-icon').text()).toBe('auto_awesome')
  })

  it('restores a fresh saved thread summary without requesting it again', async () => {
    const email = store.traditionalEmails[0]
    const body = {
      threadId: 'thread-1',
      threadLatestMessageId: email.id,
      thread: [
        {
          id: 'earlier',
          from_name: 'Contractor',
          from_address: 'contractor@example.com',
          snippet: 'Earlier update',
          sent_at: new Date(Date.now() - 2 * HOUR).toISOString(),
        },
        { id: email.id },
      ],
    }
    store.messageBodies.set(email.id, body)
    store.threadSummaries.set('thread-1', 'A previously saved summary.')
    store.fetchMessageBody.mockResolvedValue(body)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ drafts: [] }) }),
    )
    wrapper = mountView()

    await wrapper.find('.ni-row').trigger('click')

    const summary = wrapper.find('.ni-thread-summary')
    expect(summary.text()).toContain('A previously saved summary.')
    expect(fetch.mock.calls.some(([url]) => url === `${AI_API_URL}/summarize`)).toBe(false)
  })
})

describe('TraditionalInboxView placeholder controls (rage-click fix)', () => {
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useInboxStore()
    store.traditionalEmails = [makeEmail('today-1', Date.now() - HOUR)]
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: {} }) }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rows offer no Snooze action', () => {
    const wrapper = mountView()

    expect(wrapper.find('.ni-row [title="Snooze"]').exists()).toBe(false)
  })

  it('the reader keeps placeholder controls hidden and offers Forward beside Reply', async () => {
    const wrapper = mountView()
    await wrapper.find('.ni-row').trigger('click')

    const reader = wrapper.find('.ni-reader')
    expect(reader.find('[title="Snooze"]').exists()).toBe(false)
    expect(reader.find('[title="More"]').exists()).toBe(false)
    expect(reader.find('[title="Forward"]').exists()).toBe(true)

    const pills = reader.findAll('.ni-reader-footer .ni-pill-btn')
    expect(pills).toHaveLength(2)
    expect(pills[0].text()).toContain('Reply')
    expect(pills[1].text()).toContain('Forward')
  })

  it('opens a forward draft with a quoted body and downloadable attachments', async () => {
    const email = store.traditionalEmails[0]
    store.messageBodies.set(email.id, {
      html: '<p>Original <strong>message</strong></p><script>alert(1)</script>',
      text: 'Original message',
      attachments: [
        {
          id: 'att-1',
          filename: 'plan.pdf',
          content_type: 'application/pdf',
          size_bytes: 2048,
          downloadable: true,
        },
        {
          id: 'legacy-att',
          filename: 'legacy.txt',
          downloadable: false,
        },
      ],
    })
    const wrapper = mountView()
    await wrapper.find('.ni-row').trigger('click')

    const forward = wrapper
      .findAll('.ni-reader-footer .ni-pill-btn')
      .find((button) => button.text().includes('Forward'))
    await forward.trigger('click')

    expect(store.isComposerActive).toBe(true)
    expect(store.composerTo).toBe('')
    expect(store.composerSubject).toBe(`Fwd: ${email.subject}`)
    expect(store.composerTextArea).toContain('---------- Forwarded message ----------')
    expect(store.composerTextArea).toContain('> Original message')
    expect(store.composerHtml).toContain('<blockquote><p>Original <strong>message</strong></p>')
    expect(store.composerHtml).not.toContain('<script')
    expect(store.composerAttachments).toEqual([
      expect.objectContaining({ id: 'att-1', filename: 'plan.pdf' }),
    ])
  })

  it('does not replace an existing draft or create a truncated forward', async () => {
    const email = store.traditionalEmails[0]
    store.messageBodies.set(email.id, { html: null, text: 'Original', attachments: [] })
    store.isComposerActive = true
    store.composerHtml = '<p>My draft</p>'
    const notify = vi.spyOn(store, 'notify')
    const wrapper = mountView()
    await wrapper.find('.ni-row').trigger('click')
    const forward = wrapper
      .findAll('.ni-reader-footer .ni-pill-btn')
      .find((button) => button.text().includes('Forward'))

    await forward.trigger('click')

    expect(store.composerHtml).toBe('<p>My draft</p>')
    expect(notify).toHaveBeenCalledWith('Close your current draft before forwarding.', 'error')

    store.closeComposer()
    store.messageBodies.delete(email.id)
    vi.spyOn(store, 'fetchMessageBody').mockResolvedValue(null)
    await forward.trigger('click')

    expect(store.isComposerActive).toBe(false)
    expect(notify).toHaveBeenCalledWith('Could not load the original email to forward.', 'error')
  })

  it('keeps the working reader controls', async () => {
    const wrapper = mountView()
    await wrapper.find('.ni-row').trigger('click')

    const reader = wrapper.find('.ni-reader')
    expect(reader.find('[title="Reply"]').exists()).toBe(true)
    // Reply all only appears for messages with more than one contact.
    expect(reader.find('[title="Reply all"]').exists()).toBe(false)
    expect(reader.find('[title="Star"]').exists()).toBe(true)
    expect(reader.find('[title="Done"]').exists()).toBe(true)
    expect(reader.find('[title="Reschedule"]').exists()).toBe(true)
    expect(reader.find('[title="Close"]').exists()).toBe(false)
    expect(reader.find('[title="Previous"]').exists()).toBe(false)
    expect(reader.find('[title="Next"]').exists()).toBe(false)
  })
})

describe('TraditionalInboxView newsletter unsubscribe', () => {
  let store
  let wrapper
  let fetchMock

  const UNSUB = { oneClick: true, url: 'https://news.example/unsub', mailto: null }

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useInboxStore()
    store.traditionalEmails = [makeEmail('news-1', Date.now() - HOUR)]
    // Auth0 is absent in tests; getAccessTokenSilently would throw in jsdom.
    vi.spyOn(store, 'authHeaders').mockResolvedValue({ 'Content-Type': 'application/json' })
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: {} }) })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    wrapper?.unmount()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  async function openReader(unsubscribe) {
    store.messageBodies.set('news-1', { html: null, text: 'Body', unsubscribe })
    wrapper = mountView()
    await wrapper.find('.ni-row').trigger('click')
    return wrapper.find('.ni-reader')
  }

  it('shows an Unsubscribe button when the open email advertises List-Unsubscribe', async () => {
    const reader = await openReader(UNSUB)

    const toolbarGroups = reader.findAll('.ni-reader-topbar .ni-reader-nav')
    const button = toolbarGroups[1].find('[title="Unsubscribe"]')
    expect(button.exists()).toBe(true)
    expect(button.text()).toContain('Unsubscribe')
    expect(toolbarGroups[0].find('[title="Unsubscribe"]').exists()).toBe(false)
  })

  it('shows an Unsubscribe button for a link in the email content', async () => {
    const url = 'https://news.example/preferences/unsubscribe?id=123'
    store.traditionalEmails[0].unread = false
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        body_html: `<p>News</p><p><a href="${url}">Unsubscribe</a></p>`,
        body_text: 'News',
        unsubscribe: null,
      }),
    })
    wrapper = mountView()
    await wrapper.find('.ni-row').trigger('click')
    await vi.waitFor(() => expect(store.isOpenBodyResolved).toBe(true))
    const emailBody = wrapper.findComponent(EmailBody)
    emailBody.vm.$emit('unsubscribe-link', {
      oneClick: false,
      url,
      href: url,
      mailto: null,
      source: 'content',
    })
    await vi.waitFor(() => {
      expect(wrapper.find('.ni-reader [title="Unsubscribe"]').exists()).toBe(true)
    })

    const link = wrapper.find('.ni-reader a[title="Unsubscribe"]')
    expect(link.attributes('href')).toBe(url)
    expect(link.attributes('target')).toBe('_blank')
    expect(link.attributes('rel')).toBe('noopener noreferrer')

    await link.trigger('click')
    expect(store.traditionalEmails.some((email) => email.id === 'news-1')).toBe(false)
    expect(store.openEmailId).toBe(null)
  })

  it('hides the Unsubscribe button for a regular email', async () => {
    const reader = await openReader(null)

    expect(reader.find('[title="Unsubscribe"]').exists()).toBe(false)
  })

  it('posts the unsubscribe action, marks the email done, and closes the reader', async () => {
    const reader = await openReader(UNSUB)
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'unsubscribed', method: 'one-click' }),
    })

    await reader.find('[title="Unsubscribe"]').trigger('click')
    await vi.waitFor(() => {
      expect(store.toasts.some((t) => t.message.includes('Unsubscribed'))).toBe(true)
    })

    expect(store.traditionalEmails.some((email) => email.id === 'news-1')).toBe(false)
    expect(store.openEmailId).toBe(null)

    const [url, options] = fetchMock.mock.calls.find(
      ([requestUrl, options]) =>
        requestUrl === `${MESSAGES_API_URL}/messages` && options.method === 'POST',
    )
    expect(url).toBe(`${MESSAGES_API_URL}/messages`)
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body)).toEqual({
      id: 'news-1',
      action: 'unsubscribe',
      allow_ai: true,
    })

    expect(wrapper.find('.ni-reader').exists()).toBe(false)
  })

  it('opens the unsubscribe page when the sender only offers a link', async () => {
    const reader = await openReader({
      oneClick: false,
      url: 'https://news.example/unsub',
      mailto: null,
    })
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'manual', method: 'link', url: 'https://news.example/unsub' }),
    })
    const openSpy = vi.fn()
    vi.stubGlobal('open', openSpy)

    await reader.find('[title="Unsubscribe"]').trigger('click')
    await vi.waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith('https://news.example/unsub', '_blank', 'noopener')
    })
    // Only a confirmed unsubscribe marks the email done — the manual page may
    // still be abandoned, so the email stays in the inbox.
    expect(store.traditionalEmails.some((email) => email.id === 'news-1')).toBe(true)
    expect(store.openEmailId).toBe('news-1')
  })

  it('disables the button and shows a spinner while the unsubscribe is in flight', async () => {
    const reader = await openReader({
      oneClick: false,
      url: 'https://news.example/unsub',
      mailto: null,
    })
    let resolveRequest
    fetchMock.mockReturnValue(new Promise((resolve) => (resolveRequest = resolve)))

    await reader.find('[title="Unsubscribe"]').trigger('click')
    await vi.waitFor(() => {
      expect(store.unsubscribingId).toBe('news-1')
    })
    await wrapper.vm.$nextTick()

    const button = reader.find('[title="Unsubscribe"]')
    expect(button.attributes('disabled')).toBeDefined()
    expect(button.find('.ni-unsub-spinner').exists()).toBe(true)
    expect(button.text()).toContain('Unsubscribing')

    resolveRequest({ ok: true, json: async () => ({ status: 'unsubscribed', method: 'ai' }) })
    await vi.waitFor(() => {
      expect(store.unsubscribingId).toBe(null)
    })
  })

  it('replaces the button with a disabled failed state when the AI attempt fails', async () => {
    const reader = await openReader({
      oneClick: false,
      url: 'https://news.example/unsub',
      mailto: null,
    })
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ai_failed', method: 'ai', url: 'https://news.example/unsub' }),
    })

    await reader.find('[title="Unsubscribe"]').trigger('click')
    await vi.waitFor(() => {
      expect(store.toasts.some((t) => t.message.includes('AI could not unsubscribe'))).toBe(true)
    })
    await wrapper.vm.$nextTick()

    const button = reader.find('[title="Unsubscribe"]')
    expect(button.text()).toContain('AI Unsubscribe Failed')
    expect(button.attributes('disabled')).toBeDefined()
    expect(button.classes()).toContain('failed')
    // The email is not marked done on failure.
    expect(store.traditionalEmails.some((email) => email.id === 'news-1')).toBe(true)
  })

  it('surfaces an error toast when the unsubscribe request fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const reader = await openReader(UNSUB)
    fetchMock.mockImplementation(async (_url, options = {}) => ({
      ok: options.method !== 'POST',
      status: options.method === 'POST' ? 502 : 200,
      json: async () => ({}),
    }))

    await reader.find('[title="Unsubscribe"]').trigger('click')
    await vi.waitFor(() => {
      expect(store.toasts.some((t) => t.kind === 'error')).toBe(true)
    })
    expect(consoleError).toHaveBeenCalledWith('Unsubscribe failed:', expect.any(Error))
  })
})

describe("TraditionalInboxView 'd' archive shortcut", () => {
  let store
  let wrapper

  function pressD(init = {}) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true, ...init }))
  }

  beforeEach(async () => {
    setActivePinia(createPinia())
    store = useInboxStore()
    store.traditionalEmails = [makeEmail('today-1', Date.now() - HOUR)]
    vi.spyOn(store, 'archiveEmail')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: {} }) }),
    )
    wrapper = mountView()
    await wrapper.find('.ni-row').trigger('click')
  })

  afterEach(() => {
    wrapper.unmount()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("archives the open email when 'd' is pressed and closes the reader when it was the only email", () => {
    pressD()

    expect(store.archiveEmail).toHaveBeenCalledTimes(1)
    expect(store.archiveEmail.mock.calls[0][0].id).toBe('today-1')
    expect(store.openEmailId).toBe(null)
  })

  it("keeps 'd' working when a message is opened while a text field was focused", async () => {
    // Reproduces opening a search result: focus is in the search input, and the
    // clicked row is a non-focusable div, so focus would otherwise stay there
    // and swallow 'd' as typing.
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    await wrapper.find('.ni-row').trigger('click') // opens the reader

    // The keydown originates from whatever is focused now.
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }))
    expect(store.archiveEmail).toHaveBeenCalled()

    input.remove()
  })

  it("archives the open email when 'd' is pressed inside its HTML body", async () => {
    await vi.waitFor(() => expect(store.bodyLoadingId).toBe(null))
    store.messageBodies.set('today-1', {
      html: '<p><a href="https://example.com">Open link</a></p>',
      text: 'Open link',
    })
    await wrapper.vm.$nextTick()

    wrapper
      .findComponent(EmailBody)
      .vm.$emit(
        'keydown',
        new KeyboardEvent('keydown', { key: 'd', bubbles: true, cancelable: true }),
      )

    expect(store.archiveEmail).toHaveBeenCalledTimes(1)
    expect(store.archiveEmail.mock.calls[0][0].id).toBe('today-1')
  })

  it('advances to the next email in the list after archiving', async () => {
    store.traditionalEmails = [
      makeEmail('today-1', Date.now() - HOUR),
      makeEmail('today-2', Date.now() - 2 * HOUR),
      makeEmail('today-3', Date.now() - 3 * HOUR),
    ]
    await wrapper.vm.$nextTick()
    await wrapper.findAll('.ni-row')[0].trigger('click')

    pressD()

    expect(store.archiveEmail.mock.calls[0][0].id).toBe('today-1')
    expect(store.openEmailId).toBe('today-2')
  })

  it('expands the date group when auto-advance crosses into another day', async () => {
    store.traditionalEmails = [
      makeEmail('today-1', Date.now() - HOUR),
      makeEmail('yesterday-1', Date.now() - DAY),
    ]
    await wrapper.vm.$nextTick()

    const yesterdayHeader = wrapper
      .findAll('.ni-group-header')
      .find((header) => header.text().includes('Yesterday'))
    expect(yesterdayHeader.attributes('aria-expanded')).toBe('false')
    await wrapper.find('.ni-row').trigger('click')

    pressD()
    await wrapper.vm.$nextTick()

    expect(store.openEmailId).toBe('yesterday-1')
    expect(yesterdayHeader.attributes('aria-expanded')).toBe('true')
    expect(wrapper.findAll('.ni-row').map((row) => row.text())).toContainEqual(
      expect.stringContaining('Subject yesterday-1'),
    )
  })

  it('falls back to the previous email when the archived one was last', async () => {
    store.traditionalEmails = [
      makeEmail('today-1', Date.now() - HOUR),
      makeEmail('today-2', Date.now() - 2 * HOUR),
    ]
    await wrapper.vm.$nextTick()
    await wrapper.findAll('.ni-row')[1].trigger('click')

    pressD()

    expect(store.archiveEmail.mock.calls[0][0].id).toBe('today-2')
    expect(store.openEmailId).toBe('today-1')
  })

  it('does nothing when no email is open', () => {
    store.closeReader()

    pressD()

    expect(store.archiveEmail).not.toHaveBeenCalled()
  })

  it("ignores 'd' typed into an input or textarea", () => {
    const textarea = document.createElement('textarea')
    document.body.appendChild(textarea)
    try {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }))
    } finally {
      textarea.remove()
    }

    expect(store.archiveEmail).not.toHaveBeenCalled()
  })

  it("ignores 'd' while the command palette is open", () => {
    store.isCommandPaletteOpen = true

    pressD()

    expect(store.archiveEmail).not.toHaveBeenCalled()
  })

  it("ignores auto-repeated 'd' events from a held key (one press = one archive)", async () => {
    // With auto-advance, each archive opens the next (unseen) email — a held
    // key must not chain-archive mail the user never looked at.
    store.traditionalEmails = [
      makeEmail('today-1', Date.now() - HOUR),
      makeEmail('today-2', Date.now() - 2 * HOUR),
      makeEmail('today-3', Date.now() - 3 * HOUR),
    ]
    await wrapper.vm.$nextTick()
    await wrapper.findAll('.ni-row')[0].trigger('click')

    pressD()
    pressD({ repeat: true })
    pressD({ repeat: true })

    expect(store.archiveEmail).toHaveBeenCalledTimes(1)
    expect(store.openEmailId).toBe('today-2')
  })

  it("ignores 'd' with a modifier key held (browser shortcuts like Cmd+D)", () => {
    pressD({ metaKey: true })
    pressD({ ctrlKey: true })
    pressD({ altKey: true })

    expect(store.archiveEmail).not.toHaveBeenCalled()
  })
})

describe('TraditionalInboxView search results', () => {
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useInboxStore()
    // Relevance order (from the API) deliberately differs from date order:
    // the most relevant result is the oldest, the least relevant is newest.
    store.traditionalEmails = [
      makeEmail('rel-1', Date.now() - 10 * DAY),
      makeEmail('rel-2', Date.now() - HOUR),
    ]
    store.activeSearchQuery = 'invoice'
  })

  it('preserves the server relevance order instead of bucketing by date', () => {
    const wrapper = mountView()

    // A single flat group, not the Today/Yesterday/Earlier date buckets.
    const headers = wrapper.findAll('.ni-group-header')
    expect(headers).toHaveLength(1)
    expect(headers[0].text()).not.toContain('Today')
    expect(headers[0].text()).not.toContain('Earlier')

    const subjects = wrapper.findAll('.ni-row .ni-subject').map((s) => s.text())
    expect(subjects[0]).toContain('Subject rel-1')
    expect(subjects[1]).toContain('Subject rel-2')
  })
})

// The AI Inbox's triage rows link to /inbox?open=<id>, so the view has to open
// that specific email rather than just landing on the list.
describe('opening an email from the route', () => {
  // This file shares one pinia across its tests, so the reader state has to be
  // cleared rather than assumed empty.
  function resetReader() {
    const store = useInboxStore()
    store.openEmailId = null
    store.traditionalEmails = []
    return store
  }

  it('opens the email named by ?open', async () => {
    const store = resetReader()
    store.traditionalEmails = [
      { id: 'm1', subject: 'First', sender: 'A', unread: true },
      { id: 'm2', subject: 'Second', sender: 'B', unread: true },
    ]
    await router.replace({ path: '/inbox', query: { open: 'm2' } })

    mountView()
    await nextTick()

    expect(store.openEmailId).toBe('m2')
  })

  it('leaves the reader closed when no ?open is given', async () => {
    const store = resetReader()
    store.traditionalEmails = [{ id: 'm1', subject: 'First', sender: 'A', unread: true }]
    await router.replace({ path: '/inbox' })

    mountView()
    await nextTick()

    expect(store.openEmailId).toBeNull()
  })

  // The list is usually still in flight when the route lands, so the view must
  // wait for the email to arrive rather than give up on the first miss.
  it('opens the email once the list finishes loading', async () => {
    const store = resetReader()
    await router.replace({ path: '/inbox', query: { open: 'm2' } })

    mountView()
    await nextTick()
    expect(store.openEmailId).toBeNull()

    store.traditionalEmails = [{ id: 'm2', subject: 'Second', sender: 'B', unread: true }]
    await nextTick()

    expect(store.openEmailId).toBe('m2')
  })

  it('marks the opened email read', async () => {
    const store = resetReader()
    store.traditionalEmails = [{ id: 'm2', subject: 'Second', sender: 'B', unread: true }]
    await router.replace({ path: '/inbox', query: { open: 'm2' } })

    mountView()
    await nextTick()

    expect(store.traditionalEmails[0].unread).toBe(false)
  })
})

describe('TraditionalInboxView inbox tabs', () => {
  let store

  function tabTexts(wrapper) {
    return wrapper
      .findAll('.ni-tab')
      .map((tab) => `${tab.find('.ni-tab-name').text()} ${tab.find('.ni-tab-count').text()}`)
  }

  function clickTab(wrapper, name) {
    return wrapper
      .findAll('.ni-tab')
      .find((tab) => tab.find('.ni-tab-name').text() === name)
      .trigger('click')
  }

  function rowSubjects(wrapper) {
    return wrapper.findAll('.ni-row').map((row) => row.find('.ni-subject-text').text())
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useInboxStore()
    store.categories = [
      { id: 'c-team', name: 'Team', color: '#2383e2' },
      { id: 'c-docs', name: 'Docs', color: '#8e4ec6' },
      { id: 'c-finance', name: 'Finance', color: '#2f9e44' },
    ]
    const team = makeEmail('team-1', Date.now() - HOUR)
    team.category = store.categories[0]
    team.isPriority = true
    const both = makeEmail('both-1', Date.now() - 2 * HOUR)
    both.category = store.categories[1]
    const plain = makeEmail('plain-1', Date.now() - 3 * HOUR)
    const system = makeEmail('system-1', Date.now() - 4 * HOUR)
    system.labels = [{ name: 'AI Generated', color: '#7c3aed' }]
    store.traditionalEmails = [team, both, plain, system]
  })

  it('lists Important first, then all categories and Other, including empty tabs', () => {
    const wrapper = mountView()

    expect(tabTexts(wrapper)).toEqual(['Important 1', 'Docs 1', 'Finance 0', 'Team 1', 'Other 2'])
    expect(wrapper.find('.ni-tabs').exists()).toBe(true)
    expect(wrapper.find('.ni-header').exists()).toBe(false)
    const important = wrapper.find('.ni-tab')
    expect(important.classes()).toContain('active')
    expect(important.attributes('aria-selected')).toBe('true')
    expect(rowSubjects(wrapper)).toEqual(['Subject team-1'])
  })

  it.each(['Important', ' important '])(
    'combines the %s category with priority mail without duplicate tabs or counts',
    async (name) => {
      const category = { id: 'c-important', name, color: '#2383e2' }
      store.categories.push(category)
      store.traditionalEmails[0].category = category
      store.traditionalEmails[1].category = category
      store.inboxTab = 'category:c-important'
      const wrapper = mountView()

      expect(tabTexts(wrapper)).toEqual(['Important 2', 'Docs 0', 'Finance 0', 'Team 0', 'Other 2'])
      expect(wrapper.find('.ni-tab.active .ni-tab-name').text()).toBe('Important')
      expect(rowSubjects(wrapper)).toEqual(['Subject team-1', 'Subject both-1'])

      await clickTab(wrapper, 'Other')
      expect(rowSubjects(wrapper)).toEqual(['Subject plain-1', 'Subject system-1'])
      await clickTab(wrapper, 'Important')
      expect(rowSubjects(wrapper)).toEqual(['Subject team-1', 'Subject both-1'])
    },
  )

  it('a category tab narrows the list to emails assigned to that category', async () => {
    const wrapper = mountView()

    await clickTab(wrapper, 'Team')

    expect(rowSubjects(wrapper)).toEqual(['Subject team-1'])
    const team = wrapper.findAll('.ni-tab').find((tab) => tab.text().includes('Team'))
    expect(team.attributes('aria-selected')).toBe('true')
    expect(wrapper.find('.ni-tab').attributes('aria-selected')).toBe('false')
    expect(store.inboxTab).toBe('category:c-team')
  })

  it('keeps an empty category selectable and selected when its last email leaves', async () => {
    const wrapper = mountView()
    await clickTab(wrapper, 'Finance')
    expect(wrapper.get('.ni-tab.active .ni-tab-name').text()).toBe('Finance')
    expect(wrapper.get('.ni-empty').text()).toBe('No emails in this category.')
    await clickTab(wrapper, 'Team')
    store.traditionalEmails = store.traditionalEmails.filter(
      (email) => email.category?.id !== 'c-team',
    )
    await nextTick()
    expect(wrapper.get('.ni-tab.active .ni-tab-name').text()).toBe('Team')
    expect(wrapper.get('.ni-tab.active .ni-tab-count').text()).toBe('0')
    expect(wrapper.get('.ni-empty').text()).toBe('No emails in this category.')
    wrapper.unmount()
  })

  it('Other collects mail that is neither important nor categorised', async () => {
    const wrapper = mountView()

    await clickTab(wrapper, 'Other')

    expect(rowSubjects(wrapper)).toEqual(['Subject plain-1', 'Subject system-1'])
  })

  it('always offers Important first, opening on the first tab with mail until it is picked', async () => {
    store.categories = []
    store.traditionalEmails[0].isPriority = false
    const wrapper = mountView()

    expect(tabTexts(wrapper)).toEqual(['Important 0', 'Other 4'])
    expect(wrapper.findAll('.ni-tab')[1].classes()).toContain('active')
    expect(rowSubjects(wrapper)).toHaveLength(4)

    await clickTab(wrapper, 'Important')
    expect(wrapper.find('.ni-tab').classes()).toContain('active')
    expect(rowSubjects(wrapper)).toHaveLength(0)
    expect(wrapper.find('.ni-empty').text()).toContain('No important emails')
    expect(wrapper.find('.ni-inbox-zero').exists()).toBe(false)
  })

  it('puts scheduled emails that are due, and follow-ups, under Important alone', async () => {
    const due = makeEmail('due-1', Date.now() - 3 * DAY)
    due.scheduledFor = new Date(Date.now() - 60 * 1000).toISOString()
    due.category = store.categories[0]
    const followUp = makeEmail('follow-1', Date.now() - 2 * DAY)
    followUp.followUpAt = new Date(Date.now() + DAY).toISOString()
    const later = makeEmail('later-1', Date.now() - DAY)
    later.scheduledFor = new Date(Date.now() + DAY).toISOString()
    store.traditionalEmails.push(due, followUp, later)
    const wrapper = mountView()

    expect(tabTexts(wrapper)).toEqual(['Important 3', 'Docs 1', 'Finance 0', 'Team 1', 'Other 3'])
    expect(rowSubjects(wrapper)).toEqual(['Subject due-1', 'Subject follow-1', 'Subject team-1'])
    expect(wrapper.find('.ni-group-header').text()).toContain('Due Today')

    // The due email carries the Team category, yet Team shows neither it nor a
    // Due Today group.
    await clickTab(wrapper, 'Team')
    expect(rowSubjects(wrapper)).toEqual(['Subject team-1'])
    expect(wrapper.findAll('.ni-group-header').map((h) => h.text())).not.toContainEqual(
      expect.stringContaining('Due Today'),
    )
  })

  it('hides tabs in filtered views but keeps all tabs with an empty inbox', async () => {
    await router.replace({ path: '/inbox', query: { filter: 'starred' } })
    let wrapper = mountView()
    expect(wrapper.find('.ni-tabs').exists()).toBe(false)
    wrapper.unmount()

    await router.replace({ path: '/inbox' })
    store.traditionalEmails = []
    wrapper = mountView()
    expect(tabTexts(wrapper)).toEqual(['Important 0', 'Docs 0', 'Finance 0', 'Team 0', 'Other 0'])
  })

  it('moves to a tab holding a linked email that sits outside the saved tab', async () => {
    store.inboxTab = 'category:c-docs'
    await router.replace({ path: '/inbox', query: { open: 'plain-1' } })
    const wrapper = mountView()
    await nextTick()

    expect(store.inboxTab).toBe('other')
    expect(store.openEmailId).toBe('plain-1')
    expect(wrapper.find('.ni-reader').exists()).toBe(true)
    expect(rowSubjects(wrapper)).toEqual(['Subject plain-1', 'Subject system-1'])
  })

  it('keeps the selected category active when its name changes', async () => {
    store.inboxTab = 'category:c-team'
    const wrapper = mountView()

    store.categories[0].name = 'People'
    await nextTick()

    expect(store.inboxTab).toBe('category:c-team')
    expect(wrapper.find('.ni-tab.active').text()).toContain('People')
    expect(rowSubjects(wrapper)).toEqual(['Subject team-1'])
  })

  it('falls back to the first tab once the selected category is deleted', async () => {
    store.inboxTab = 'category:c-team'
    const wrapper = mountView()
    expect(rowSubjects(wrapper)).toEqual(['Subject team-1'])

    store.categories = store.categories.filter((category) => category.id !== 'c-team')
    await nextTick()

    expect(rowSubjects(wrapper)).toEqual(['Subject team-1'])
    expect(wrapper.find('.ni-tab').text()).toContain('Important')
    expect(wrapper.find('.ni-tab').classes()).toContain('active')
  })
})

describe('reader recipient tooltip', () => {
  it.each([false, true])('shows full To addresses for isSent=%s', async (isSent) => {
    setActivePinia(createPinia())
    const store = useInboxStore()
    const email = {
      ...makeEmail('recipient-tooltip', Date.now() - HOUR),
      isSent,
      recipients: {
        to: [
          { name: 'Billing', address: 'billing@example.com' },
          { name: 'Accounts', address: 'accounts@example.com' },
        ],
        cc: [{ name: 'Other', address: 'other@example.com' }],
      },
    }
    store.traditionalEmails = [email]
    store.messageBodies.set(email.id, { thread: [], attachments: [] })
    const wrapper = mountView()
    try {
      store.openReader(email)
      await flushPromises()
      expect(wrapper.get('.ni-email-to').attributes('title')).toBe(
        'billing@example.com, accounts@example.com',
      )
    } finally {
      wrapper.unmount()
    }
  })
})
