import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import SettingsModal from '../SettingsModal.vue'
import ComposerEditor from '../ComposerEditor.vue'
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

vi.mock('../../auth0-client', () => ({
  getAuth0: () => null,
}))

const FIXTURE_LABELS = [
  { id: 'l1', name: 'Finance', color: '#2f9e44', kind: 'user', description: 'Bills', auto_apply: true, message_count: 2 },
  { id: 'l2', name: 'Home', color: '#e5484d', kind: 'user', description: null, auto_apply: false, message_count: 5 },
]

describe('SettingsModal', () => {
  let pinia
  let router
  let store

  beforeEach(async () => {
    pinia = createPinia()
    setActivePinia(pinia)
    router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: { template: '<div />' } }],
    })
    await router.push('/')
    await router.isReady()
    store = useInboxStore()
    localStorage.clear()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ labels: FIXTURE_LABELS.map((label) => ({ ...label })) }),
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function mountModal() {
    return mount(SettingsModal, { global: { plugins: [pinia, router] } })
  }

  async function openModal() {
    store.activeModal = 'settings'
    const wrapper = mountModal()
    await vi.waitFor(() => expect(store.labels).toHaveLength(2))
    await wrapper.vm.$nextTick()
    return wrapper
  }

  async function openLabelsPane(wrapper) {
    await wrapper
      .findAll('.settings-nav-item')
      .find((n) => n.text().includes('Labels'))
      .trigger('click')
  }

  it('is hidden until the settings modal is activated', async () => {
    const wrapper = mountModal()
    expect(wrapper.find('.modal-overlay').classes()).not.toContain('active')

    store.activeModal = 'settings'
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.modal-overlay').classes()).toContain('active')
  })

  it('shows the category sidebar and defaults to the Account pane', async () => {
    const wrapper = await openModal()

    const navItems = wrapper.findAll('.settings-nav-item').map((n) => n.text())
    expect(navItems).toHaveLength(5)
    for (const [i, name] of ['Account', 'Appearance', 'Signature', 'Notifications', 'Labels'].entries()) {
      expect(navItems[i]).toContain(name)
    }
    expect(wrapper.find('.settings-account-name').text()).toBe('Allister')
    expect(wrapper.find('.settings-account-email').text()).toBe('allisteraall@gmail.com')
    expect(wrapper.find('.label-table').exists()).toBe(false)
  })

  it('persists notification preferences to localStorage', async () => {
    const wrapper = await openModal()

    await wrapper
      .findAll('.settings-nav-item')
      .find((n) => n.text().includes('Notifications'))
      .trigger('click')
    const toggles = wrapper.findAll('.settings-switch:not(.browser-notifications-switch)')
    await toggles[0].setValue(false)

    const saved = JSON.parse(localStorage.getItem('cookie-settings-prefs'))
    expect(saved.emailSummaries).toBe(false)
  })

  it('persists the theme preference from the Appearance pane', async () => {
    const wrapper = await openModal()

    await wrapper
      .findAll('.settings-nav-item')
      .find((n) => n.text().includes('Appearance'))
      .trigger('click')

    const select = wrapper.find('.settings-select')
    expect(select.exists()).toBe(true)
    const values = select.findAll('option').map((o) => o.element.value)
    expect(values).toEqual(['light', 'dark', 'system'])

    await select.setValue('dark')
    expect(localStorage.getItem('cookie-theme')).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('edits and persists the personal signature from the Signature pane', async () => {
    localStorage.clear()
    const wrapper = await openModal()

    await wrapper
      .findAll('.settings-nav-item')
      .find((n) => n.text().includes('Signature'))
      .trigger('click')

    const editor = wrapper.findComponent(ComposerEditor)
    expect(editor.exists()).toBe(true)

    editor.vm.$emit('update:modelValue', '<p>Cheers, Allister</p>')
    expect(store.signatureHtml).toBe('<p>Cheers, Allister</p>')
    expect(localStorage.getItem('cookie-signature-html')).toBe('<p>Cheers, Allister</p>')
  })

  it('requests browser permission and enables new-mail notifications for the current user', async () => {
    store.userId = '11111111-1111-1111-1111-111111111111'
    const requestPermission = vi.fn().mockResolvedValue('granted')
    vi.stubGlobal('Notification', { permission: 'default', requestPermission })
    const wrapper = await openModal()

    await wrapper
      .findAll('.settings-nav-item')
      .find((n) => n.text().includes('Notifications'))
      .trigger('click')
    await wrapper.find('.browser-notifications-switch').setValue(true)
    await vi.waitFor(() => expect(requestPermission).toHaveBeenCalledTimes(1))

    expect(wrapper.find('.browser-notifications-switch').element.checked).toBe(true)
    expect(
      JSON.parse(
        localStorage.getItem(
          'cookie-browser-notifications:11111111-1111-1111-1111-111111111111',
        ),
      ),
    ).toEqual({ enabled: true })
    expect(wrapper.find('.browser-notifications-status').text()).toContain('sender and subject')
  })

  it('keeps browser notifications off when permission is denied', async () => {
    store.userId = '11111111-1111-1111-1111-111111111111'
    const requestPermission = vi.fn().mockImplementation(async () => {
      Notification.permission = 'denied'
      return 'denied'
    })
    vi.stubGlobal('Notification', { permission: 'default', requestPermission })
    const wrapper = await openModal()

    await wrapper
      .findAll('.settings-nav-item')
      .find((n) => n.text().includes('Notifications'))
      .trigger('click')
    await wrapper.find('.browser-notifications-switch').setValue(true)
    await vi.waitFor(() => expect(requestPermission).toHaveBeenCalledTimes(1))

    expect(wrapper.find('.browser-notifications-switch').element.checked).toBe(false)
    expect(wrapper.find('.browser-notifications-switch').element.disabled).toBe(true)
    expect(wrapper.find('.browser-notifications-status').text()).toContain('blocked')
  })

  it('lists labels with colors and descriptions in the Labels pane', async () => {
    const wrapper = await openModal()
    await openLabelsPane(wrapper)

    const rows = wrapper.findAll('.label-table-row')
    expect(rows).toHaveLength(2)
    expect(rows[0].find('.ni-label-pill').text()).toBe('Finance')
    expect(rows[0].find('.label-description').text()).toBe('Bills')
    expect(rows[1].find('.label-description').text()).toBe('—')
    expect(rows[0].find('.label-auto-tag-switch').element.checked).toBe(true)
    expect(rows[1].find('.label-auto-tag-switch').element.checked).toBe(false)
  })

  it('updates whether a label can be auto-tagged', async () => {
    const wrapper = await openModal()
    await openLabelsPane(wrapper)
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ label: {} }) })

    await wrapper.findAll('.label-auto-tag-switch')[1].setValue(true)

    expect(fetch).toHaveBeenLastCalledWith('/api/labels', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'l2', auto_apply: true }),
    })
    expect(store.labels[1].auto_apply).toBe(true)
  })

  it('renames a user label inline', async () => {
    const wrapper = await openModal()
    await openLabelsPane(wrapper)
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ label: { ...FIXTURE_LABELS[0], name: 'Money' } }),
    })

    await wrapper.find('.label-edit-btn').trigger('click')
    const input = wrapper.find('.label-rename-input')
    expect(input.element.value).toBe('Finance')
    await input.setValue('Money')
    await input.trigger('keydown', { key: 'Enter' })
    await vi.waitFor(() => expect(store.labels.find((label) => label.id === 'l1')?.name).toBe('Money'))
    await wrapper.vm.$nextTick()

    expect(fetch).toHaveBeenLastCalledWith('/api/labels', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'l1', name: 'Money' }),
    })
    expect(wrapper.find('.label-rename-input').exists()).toBe(false)
    expect(wrapper.findAll('.ni-label-pill').some((pill) => pill.text() === 'Money')).toBe(true)
  })

  it('creates a label from the form and resets it', async () => {
    const wrapper = await openModal()
    await openLabelsPane(wrapper)

    fetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({
        label: { id: 'l3', name: 'Receipts', color: '#1a73e8', kind: 'user', description: null, message_count: 0 },
      }),
    })

    await wrapper.find('.label-input').setValue('Receipts')
    await wrapper.find('.label-create-form').trigger('submit')
    await vi.waitFor(() => expect(store.labels).toHaveLength(3))
    await wrapper.vm.$nextTick()

    expect(fetch).toHaveBeenLastCalledWith('/api/labels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Receipts', color: '#1a73e8', description: '' }),
    })
    expect(wrapper.findAll('.label-table-row')).toHaveLength(3)
    expect(wrapper.find('.label-input').element.value).toBe('')
  })

  it('deletes a label from its row', async () => {
    const wrapper = await openModal()
    await openLabelsPane(wrapper)

    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
    await wrapper.find('.label-delete-btn').trigger('click')
    await vi.waitFor(() => expect(store.labels).toHaveLength(1))

    expect(fetch).toHaveBeenLastCalledWith('/api/labels', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'l1' }),
    })
  })

  it('closes via the footer button', async () => {
    const wrapper = await openModal()

    await wrapper.find('.modal-footer .btn-secondary').trigger('click')
    expect(store.activeModal).toBe(null)
  })
})
