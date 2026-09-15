import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CategorySettings from '../CategorySettings.vue'
import { setAuth0Client } from '../../auth0-client'
import { useInboxStore } from '../../stores/inbox'

describe('Category settings', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    setAuth0Client({ getAccessTokenSilently: vi.fn().mockResolvedValue('test-access-token') })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('shows an enabled Notification checkbox for every category and persists changes', async () => {
    const store = useInboxStore()
    store.categories = [
      { id: 'c1', name: 'Projects', color: '#1a73e8', notifications_enabled: true },
      { id: 'c2', name: 'Newsletters', color: '#7048e8', notifications_enabled: true },
    ]
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ category: { ...store.categories[0], notifications_enabled: false } }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(CategorySettings)

    const checkboxes = wrapper.findAll('input[type="checkbox"]')
    expect(checkboxes).toHaveLength(2)
    expect(checkboxes.every((checkbox) => checkbox.element.checked)).toBe(true)
    await wrapper.get('input[aria-label="Notifications for Projects"]').setValue(false)
    await flushPromises()

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      id: 'c1',
      notifications_enabled: false,
    })
    expect(store.categories[0].notifications_enabled).toBe(false)
  })

  it('restores the checkbox when saving fails', async () => {
    const store = useInboxStore()
    store.categories = [
      { id: 'c1', name: 'Projects', color: '#1a73e8', notifications_enabled: true },
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const wrapper = mount(CategorySettings)

    await wrapper.get('input[aria-label="Notifications for Projects"]').setValue(false)
    await flushPromises()

    expect(wrapper.get('input[aria-label="Notifications for Projects"]').element.checked).toBe(true)
  })
})
