import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ScheduledSendsView from '../ScheduledSendsView.vue'
import { useInboxStore } from '../../stores/inbox'

// scheduledSends is mutated in place by the DELETE branch so a cancel in one
// test step is reflected the next time GET is (re-)read, mirroring the real
// API's persisted state.
function stubFetch(scheduledSends) {
  const fetchMock = vi.fn(async (url, options = {}) => {
    if (url === '/api/send?resource=scheduled' && (!options.method || options.method === 'GET')) {
      return { ok: true, json: async () => ({ scheduledSends: [...scheduledSends] }) }
    }
    if (url === '/api/send?resource=scheduled' && options.method === 'DELETE') {
      const { id } = JSON.parse(options.body)
      const index = scheduledSends.findIndex((item) => item.id === id)
      const [removed] = scheduledSends.splice(index, 1)
      return {
        ok: true,
        json: async () => ({
          scheduledSend: { ...removed, text: 'Body', html: null, replyToMessageId: null },
        }),
      }
    }
    throw new Error(`Unexpected fetch: ${options.method || 'GET'} ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  setActivePinia(createPinia())
  const store = useInboxStore()
  vi.spyOn(store, 'authHeaders').mockResolvedValue({})
  vi.spyOn(store, 'notify').mockImplementation(() => {})
})

describe('ScheduledSendsView', () => {
  it('shows an empty state when nothing is scheduled', async () => {
    stubFetch([])

    const wrapper = mount(ScheduledSendsView)
    await flushPromises()

    expect(wrapper.text()).toContain('Nothing is scheduled to send later.')
  })

  it("lists the authenticated user's pending scheduled sends", async () => {
    stubFetch([
      {
        id: 'sched-1',
        toAddresses: 'person@example.com',
        subject: 'Hello',
        scheduledFor: '2026-08-02T09:00:00.000Z',
        status: 'pending',
      },
    ])

    const wrapper = mount(ScheduledSendsView)
    await flushPromises()

    expect(wrapper.text()).toContain('Hello')
    expect(wrapper.text()).toContain('person@example.com')
  })

  it('marks a failed row distinctly instead of showing a send time', async () => {
    stubFetch([
      {
        id: 'sched-1',
        toAddresses: 'person@example.com',
        subject: 'Hello',
        scheduledFor: '2026-08-02T09:00:00.000Z',
        status: 'failed',
      },
    ])

    const wrapper = mount(ScheduledSendsView)
    await flushPromises()

    expect(wrapper.find('.scheduled-sends-time').text()).toBe('Failed to send')
    expect(wrapper.find('.scheduled-sends-time').classes()).toContain('is-failed')
  })

  it('cancels a scheduled send and removes it from the list', async () => {
    const fetchMock = stubFetch([
      {
        id: 'sched-1',
        toAddresses: 'person@example.com',
        subject: 'Hello',
        scheduledFor: '2026-08-02T09:00:00.000Z',
        status: 'pending',
      },
    ])
    const wrapper = mount(ScheduledSendsView)
    await flushPromises()

    await wrapper.find('.scheduled-sends-cancel').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Nothing is scheduled to send later.')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/send?resource=scheduled',
      expect.objectContaining({ method: 'DELETE' }),
    )

    const store = useInboxStore()
    expect(store.composerTo).toBe('person@example.com')
    expect(store.isComposerActive).toBe(true)
  })
})
