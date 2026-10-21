import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AgentSendSettings from '../AgentSendSettings.vue'
import { useInboxStore } from '../../stores/inbox'

let wrapper
beforeEach(() => {
  setActivePinia(createPinia())
  vi.spyOn(useInboxStore(), 'authHeaders').mockResolvedValue({ Authorization: 'Bearer test-token' })
  vi.spyOn(useInboxStore(), 'notify').mockImplementation(() => {})
})
afterEach(() => {
  wrapper?.unmount()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('agent send confirmations', () => {
  it('creates a confirmation, displays its expiry, and copies it', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ confirmation: 'one-use-code', expiresAt: '2026-10-21T12:10:00Z' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const writeText = vi.fn().mockResolvedValue()
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    wrapper = mount(AgentSendSettings)
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledWith('/api/send?resource=confirmation', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token' },
    })
    expect(wrapper.get('code').text()).toBe('one-use-code')
    expect(wrapper.text()).toContain('Expires 2026-10-21T12:10:00Z')
    await wrapper.findAll('button')[1].trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith('one-use-code')
    expect(useInboxStore().notify).toHaveBeenCalledWith('Send confirmation copied.')
  })

  it.each([
    [{ error: 'Please sign in' }, 'Please sign in'],
    [{}, 'Could not create a send confirmation'],
  ])('shows the server failure and enables retry: %j', async (body, message) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => body }))
    wrapper = mount(AgentSendSettings)
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role=alert]').text()).toBe(message)
    expect(wrapper.get('button').element.disabled).toBe(false)
    expect(wrapper.find('code').exists()).toBe(false)
  })

  it('recovers from an unreadable response without showing an empty code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          throw new Error('Invalid JSON')
        },
      }),
    )
    wrapper = mount(AgentSendSettings)
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(wrapper.find('code').exists()).toBe(false)
    expect(wrapper.get('button').element.disabled).toBe(false)
  })

  it('reports non-Error request failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue('offline'))
    wrapper = mount(AgentSendSettings)
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role=alert]').text()).toBe('Could not create a send confirmation')
  })

  it('reports clipboard failure and clears the previous code while creating another', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ confirmation: 'code' }) })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    })
    wrapper = mount(AgentSendSettings)
    await wrapper.get('button').trigger('click')
    await flushPromises()
    await wrapper.findAll('button')[1].trigger('click')
    await flushPromises()
    expect(wrapper.get('[role=alert]').text()).toBe('Could not copy the confirmation.')
    let resolve
    fetchMock.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done
      }),
    )
    await wrapper.get('button').trigger('click')
    expect(wrapper.find('code').exists()).toBe(false)
    expect(wrapper.find('[role=alert]').exists()).toBe(false)
    expect(wrapper.get('button').element.disabled).toBe(true)
    resolve({ ok: true, json: async () => ({ confirmation: 'replacement' }) })
    await flushPromises()
    expect(wrapper.get('code').text()).toBe('replacement')
    expect(wrapper.get('button').element.disabled).toBe(false)
  })
})
