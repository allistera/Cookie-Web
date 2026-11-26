import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import { setAuth0Client } from '../../auth0-client'
import { MESSAGES_API_URL } from '../../lib/apiWorkers'
import { useInboxStore } from '../../stores/inbox'
import EmailAttachmentsFolder from '../EmailAttachmentsFolder.vue'

const LIST_URL = `${MESSAGES_API_URL}/messages/attachments`

function attachment(overrides = {}) {
  return {
    id: 'attachment-1',
    filename: 'invoice.pdf',
    contentType: 'application/pdf',
    sizeBytes: 2048,
    downloadable: true,
    embedded: false,
    direction: 'received',
    messageId: 'message-1',
    subject: 'Your invoice',
    correspondent: { name: 'Northwind Billing', address: 'billing@northwind.example', others: 0 },
    date: '2026-11-20T08:00:00.000Z',
    unread: false,
    starred: false,
    archived: false,
    ...overrides,
  }
}

const ok = (payload) => ({ ok: true, status: 200, json: async () => payload })
const page = (attachments, nextCursor = null) => ok({ attachments, nextCursor })

// `respond` answers each GET /messages/attachments from its query.
function stubList(respond) {
  const fetchMock = vi.fn(async (url) => {
    const { origin, pathname, searchParams } = new URL(url)
    if (`${origin}${pathname}` !== LIST_URL) throw new Error(`Unexpected fetch: ${url}`)
    return respond(searchParams)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

let router
let inbox

async function mountFolder() {
  const wrapper = mount(EmailAttachmentsFolder, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

const rowNames = (wrapper) =>
  wrapper.findAll('.attachment-row .attachment-name').map((name) => name.text())

beforeEach(async () => {
  setActivePinia(createPinia())
  setAuth0Client(null)
  inbox = useInboxStore()
  vi.spyOn(inbox, 'notify').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/documents', name: 'documents', component: { template: '<div />' } },
      { path: '/inbox', name: 'traditional-inbox', component: { template: '<div />' } },
    ],
  })
  await router.push('/documents?folder=email-attachments')
  await router.isReady()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('EmailAttachmentsFolder', () => {
  it('lists received and sent files under a heading per month', async () => {
    stubList(() =>
      page([
        attachment(),
        attachment({
          id: 'attachment-2',
          filename: 'contract.docx',
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          sizeBytes: 3 * 1024 * 1024,
          direction: 'sent',
          subject: 'Signed contract',
          correspondent: { name: 'Sam Carter', address: 'sam@example.com', others: 2 },
          date: '2026-10-03T08:00:00.000Z',
        }),
      ]),
    )
    const wrapper = await mountFolder()

    expect(wrapper.findAll('.attachments-month-heading').map((heading) => heading.text())).toEqual([
      'November 2026',
      'October 2026',
    ])
    const [received, sent] = wrapper.findAll('.attachment-row')
    expect(received.find('.attachment-name').text()).toBe('invoice.pdf')
    expect(received.find('.attachment-meta').text()).toBe(
      'Received From Northwind Billing · Your invoice',
    )
    expect(received.find('.attachment-kind').text()).toBe('PDF')
    expect(received.find('.attachment-size').text()).toBe('2.0 KB')
    expect(received.find('.attachment-date').text()).toBe('20 Nov')
    expect(sent.find('.attachment-meta').text()).toBe(
      'Sent To Sam Carter and 2 others · Signed contract',
    )
    expect(sent.find('.attachment-kind').text()).toBe('Text')
    expect(sent.find('.attachment-size').text()).toBe('3.0 MB')
  })

  it('names a file that has no name, subject, sender, size or date', async () => {
    stubList(() =>
      page([
        attachment({
          filename: null,
          subject: null,
          correspondent: null,
          sizeBytes: null,
          date: null,
        }),
      ]),
    )
    const wrapper = await mountFolder()

    expect(wrapper.get('.attachments-month-heading').text()).toBe('Undated')
    const row = wrapper.get('.attachment-row')
    expect(row.get('.attachment-name').text()).toBe('Untitled attachment')
    expect(row.get('.attachment-meta').text()).toBe('Received (no subject)')
    expect(row.get('.attachment-size').text()).toBe('')
    expect(row.get('.attachment-date').text()).toBe('')
  })

  it('shows one side of the mailbox when asked, without the direction chip', async () => {
    const sentFile = attachment({ id: 'attachment-sent', filename: 'sent.pdf', direction: 'sent' })
    const fetchMock = stubList((query) =>
      page(query.get('direction') === 'sent' ? [sentFile] : [attachment(), sentFile]),
    )
    const wrapper = await mountFolder()
    expect(rowNames(wrapper)).toEqual(['invoice.pdf', 'sent.pdf'])

    await wrapper.get('button[data-direction="sent"]').trigger('click')
    await flushPromises()

    expect(fetchMock.mock.calls.at(-1)[0]).toBe(`${LIST_URL}?direction=sent`)
    expect(rowNames(wrapper)).toEqual(['sent.pdf'])
    expect(wrapper.find('.attachment-direction').exists()).toBe(false)
    expect(wrapper.get('button[data-direction="sent"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.get('button[data-direction="all"]').attributes('aria-pressed')).toBe('false')
  })

  it('leaves pictures from email bodies out until they are asked for', async () => {
    const logo = attachment({
      id: 'attachment-logo',
      filename: 'image001.png',
      contentType: 'image/png',
      embedded: true,
    })
    const fetchMock = stubList((query) =>
      page(query.get('embedded') === '1' ? [attachment(), logo] : [attachment()]),
    )
    const wrapper = await mountFolder()
    expect(fetchMock.mock.calls[0][0]).toBe(LIST_URL)
    expect(rowNames(wrapper)).toEqual(['invoice.pdf'])

    await wrapper.get('.attachments-embedded input').setValue(true)
    await flushPromises()

    expect(fetchMock.mock.calls.at(-1)[0]).toBe(`${LIST_URL}?embedded=1`)
    expect(rowNames(wrapper)).toEqual(['invoice.pdf', 'image001.png'])
    expect(wrapper.findAll('.attachment-kind').at(-1).text()).toBe('Picture in email')
  })

  it('downloads a file from its name and from its download button', async () => {
    stubList(() => page([attachment()]))
    const download = vi.spyOn(inbox, 'downloadAttachment').mockResolvedValue(true)
    const wrapper = await mountFolder()

    await wrapper.get('button.attachment-name').trigger('click')
    await wrapper.get('[aria-label="Download invoice.pdf"]').trigger('click')

    expect(download).toHaveBeenCalledTimes(2)
    expect(download).toHaveBeenCalledWith({
      id: 'attachment-1',
      downloadable: true,
      filename: 'invoice.pdf',
    })
  })

  it('lists a file that was never stored without offering it for download', async () => {
    stubList(() => page([attachment({ downloadable: false })]))
    const download = vi.spyOn(inbox, 'downloadAttachment').mockResolvedValue(false)
    const wrapper = await mountFolder()

    expect(wrapper.find('button.attachment-name').exists()).toBe(false)
    expect(wrapper.get('span.attachment-name').text()).toBe('invoice.pdf')
    const button = wrapper.get('[aria-label="invoice.pdf was not stored and cannot be downloaded"]')
    expect(button.attributes('disabled')).toBeDefined()
    await button.trigger('click')
    expect(download).not.toHaveBeenCalled()
  })

  it('opens the email a file came with in the reader', async () => {
    stubList(() => page([attachment({ unread: true })]))
    const open = vi.spyOn(inbox, 'openEmailFromSearch').mockImplementation(() => {})
    const push = vi.spyOn(router, 'push').mockResolvedValue()
    const wrapper = await mountFolder()

    await wrapper.get('[aria-label="Open the email with invoice.pdf"]').trigger('click')

    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'message-1',
        from_address: 'billing@northwind.example',
        subject: 'Your invoice',
        is_sent: false,
        is_unread: true,
      }),
    )
    expect(push).toHaveBeenCalledWith('/inbox')
  })

  it('adds the older page below the files already listed', async () => {
    const older = attachment({
      id: 'attachment-old',
      filename: 'old.pdf',
      date: '2026-09-01T08:00:00.000Z',
    })
    const fetchMock = stubList((query) =>
      query.get('before') === 'cursor-1' ? page([older]) : page([attachment()], 'cursor-1'),
    )
    const wrapper = await mountFolder()

    await wrapper.get('.attachments-pagination button').trigger('click')
    await flushPromises()

    expect(fetchMock.mock.calls.at(-1)[0]).toBe(`${LIST_URL}?before=cursor-1`)
    expect(rowNames(wrapper)).toEqual(['invoice.pdf', 'old.pdf'])
    expect(wrapper.find('.attachments-pagination').exists()).toBe(false)
  })

  it('keeps the list and says so when the older page cannot be loaded', async () => {
    stubList((query) =>
      query.get('before')
        ? { ok: false, status: 500, json: async () => ({}) }
        : page([attachment()], 'cursor-1'),
    )
    const wrapper = await mountFolder()

    await wrapper.get('.attachments-pagination button').trigger('click')
    await flushPromises()

    expect(rowNames(wrapper)).toEqual(['invoice.pdf'])
    expect(inbox.notify).toHaveBeenCalledWith(
      'Could not load older attachments. Please try again.',
      'error',
    )
    expect(wrapper.get('.attachments-pagination button').attributes('disabled')).toBeUndefined()
  })

  it('says when nothing has been received or sent with a file', async () => {
    stubList(() => page([]))
    const wrapper = await mountFolder()
    expect(wrapper.get('.attachments-empty').text()).toBe(
      'No email attachments yet. Files you receive or send by email appear here.',
    )

    await wrapper.get('button[data-direction="received"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('.attachments-empty').text()).toBe('No files received by email yet.')

    await wrapper.get('button[data-direction="sent"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('.attachments-empty').text()).toBe('No files sent by email yet.')
  })

  it('reports a failed load instead of an empty folder, and loads again on request', async () => {
    let fail = true
    stubList(() =>
      fail ? { ok: false, status: 500, json: async () => ({}) } : page([attachment()]),
    )
    const wrapper = await mountFolder()

    expect(wrapper.get('[role="alert"]').text()).toContain('Could not load your email attachments.')
    expect(wrapper.find('.attachments-empty').exists()).toBe(false)

    fail = false
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()

    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(rowNames(wrapper)).toEqual(['invoice.pdf'])
  })

  it('drops a slower answer for the tab that was left', async () => {
    let releaseAll
    const allAnswer = new Promise((resolve) => {
      releaseAll = () => resolve(page([attachment({ filename: 'from-all.pdf' })]))
    })
    stubList((query) =>
      query.get('direction') === 'sent'
        ? page([
            attachment({ id: 'attachment-sent', filename: 'from-sent.pdf', direction: 'sent' }),
          ])
        : allAnswer,
    )
    const wrapper = mount(EmailAttachmentsFolder, { global: { plugins: [router] } })
    await flushPromises()

    await wrapper.get('button[data-direction="sent"]').trigger('click')
    await flushPromises()
    releaseAll()
    await flushPromises()

    expect(rowNames(wrapper)).toEqual(['from-sent.pdf'])
  })
})
