import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ThreadMessage from '../ThreadMessage.vue'
import { useInboxStore } from '../../stores/inbox'
import { MESSAGES_API_URL } from '../../lib/apiWorkers'
import { setAuth0Client } from '../../auth0-client'

setAuth0Client(null)

const MESSAGE = {
  id: 'msg-1',
  from_name: 'Alice',
  from_address: 'alice@example.com',
  snippet: 'A short preview',
  sent_at: '2026-01-01T10:00:00Z',
  is_sent: false,
}

let store

beforeEach(() => {
  setActivePinia(createPinia())
  store = useInboxStore()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ThreadMessage', () => {
  it('collapsed: shows the sender and snippet and emits toggle on click, without fetching', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(ThreadMessage, { props: { message: MESSAGE, expanded: false } })

    expect(wrapper.get('.ni-thread-message').text()).toContain('Alice')
    expect(wrapper.text()).toContain('A short preview')
    await wrapper.get('.ni-thread-message').trigger('click')

    expect(wrapper.emitted('toggle')).toHaveLength(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('expanded: fetches the full message once and renders its body and attachments', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'msg-1',
        body_html: null,
        body_text: 'The whole message',
        attachments: [
          {
            id: 'att-1',
            filename: 'plan.pdf',
            content_type: 'application/pdf',
            size_bytes: 2048,
            downloadable: true,
          },
        ],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(ThreadMessage, { props: { message: MESSAGE, expanded: true } })

    expect(wrapper.text()).toContain('Loading…')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(`${MESSAGES_API_URL}/messages?id=msg-1`)
    expect(wrapper.text()).toContain('The whole message')
    expect(wrapper.text()).toContain('alice@example.com')
    expect(wrapper.get('.ni-attachment').text()).toContain('plan.pdf')

    await wrapper.setProps({ expanded: false })
    await wrapper.setProps({ expanded: true })
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reuses a body already cached by the store', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    store.messageBodies.set('msg-1', { html: null, text: 'Cached text', attachments: [] })
    const wrapper = mount(ThreadMessage, { props: { message: MESSAGE, expanded: true } })
    await flushPromises()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Cached text')
  })

  it('shows a failure line when the message cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const wrapper = mount(ThreadMessage, { props: { message: MESSAGE, expanded: true } })
    await flushPromises()

    expect(wrapper.get('.ni-thread-message-status').text()).toBe("Couldn't load this message.")
  })

  it('the Collapse button emits toggle', async () => {
    store.messageBodies.set('msg-1', { html: null, text: 'Cached text', attachments: [] })
    const wrapper = mount(ThreadMessage, { props: { message: MESSAGE, expanded: true } })

    await wrapper.get('[aria-label="Collapse message"]').trigger('click')

    expect(wrapper.emitted('toggle')).toHaveLength(1)
  })
})
