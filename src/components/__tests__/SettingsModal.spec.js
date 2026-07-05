import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'
import SettingsModal from '../SettingsModal.vue'
import { useInboxStore } from '../../stores/inbox'

vi.mock('@auth0/auth0-vue', () => ({
  useAuth0: () => ({
    user: ref({
      name: 'Allister',
      email: 'allisteraall@gmail.com',
      picture: 'https://example.com/avatar.png',
    }),
    getAccessTokenSilently: vi.fn().mockRejectedValue(new Error('consent_required')),
  }),
}))

describe('SettingsModal', () => {
  let pinia

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    localStorage.clear()
  })

  function mountModal() {
    return mount(SettingsModal, { global: { plugins: [pinia] } })
  }

  it('is hidden until the settings modal is activated', async () => {
    const wrapper = mountModal()
    expect(wrapper.find('.modal-overlay').classes()).not.toContain('active')

    const store = useInboxStore()
    store.activeModal = 'settings'
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.modal-overlay').classes()).toContain('active')
  })

  it('shows account info from Auth0 and all settings sections', async () => {
    const store = useInboxStore()
    store.activeModal = 'settings'
    const wrapper = mountModal()
    await wrapper.vm.$nextTick()

    const titles = wrapper.findAll('.settings-section-title').map((n) => n.text())
    expect(titles).toEqual(['Account', 'Appearance', 'Notifications'])
    expect(wrapper.find('.settings-account-name').text()).toBe('Allister')
    expect(wrapper.find('.settings-account-email').text()).toBe('allisteraall@gmail.com')
  })

  it('persists notification preferences to localStorage', async () => {
    const store = useInboxStore()
    store.activeModal = 'settings'
    const wrapper = mountModal()
    await wrapper.vm.$nextTick()

    const toggles = wrapper.findAll('.settings-switch')
    // First switch is dark mode; the next three are notification prefs
    await toggles[1].setValue(false)

    const saved = JSON.parse(localStorage.getItem('cookie-settings-prefs'))
    expect(saved.emailSummaries).toBe(false)
  })

  it('closes via the footer button', async () => {
    const store = useInboxStore()
    store.activeModal = 'settings'
    const wrapper = mountModal()
    await wrapper.vm.$nextTick()

    await wrapper.find('.modal-footer .btn-secondary').trigger('click')
    expect(store.activeModal).toBe(null)
  })
})
