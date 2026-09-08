import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { AUTH0_INJECTION_KEY } from '@auth0/auth0-vue'
import SettingsView from '../SettingsView.vue'
import ComposerEditor from '../../components/ComposerEditor.vue'
import { useInboxStore } from '../../stores/inbox'
import { setAuth0Client } from '../../auth0-client'
import { AI_API_URL, EMAILS_API_URL, LABELS_API_URL, TASKS_API_URL } from '../../lib/apiWorkers'

// useAuth0() is inject()-based, so providing under its key feeds the page a
// signed-in user through the real interface.
const auth0Fake = () => ({
  user: ref({
    name: 'Allister',
    email: 'allisteraall@gmail.com',
    picture: 'https://example.com/avatar.png',
  }),
  getAccessTokenSilently: vi.fn().mockRejectedValue(new Error('consent_required')),
})

const FIXTURE_LABELS = [
  {
    id: 'l1',
    name: 'Finance',
    color: '#2f9e44',
    kind: 'user',
    description: 'Bills',
    auto_apply: true,
    message_count: 2,
  },
  {
    id: 'l2',
    name: 'Home',
    color: '#e5484d',
    kind: 'user',
    description: null,
    auto_apply: false,
    message_count: 5,
  },
]

const FIXTURE_CATEGORIES = [
  {
    id: 'c1',
    name: 'Projects',
    color: '#1a73e8',
    description: 'Active work',
    message_count: 2,
  },
]

const FIXTURE_RULES = [
  {
    id: 'r1',
    name: 'Bills',
    action: 'apply_label',
    label_id: 'l1',
    match_type: 'all',
    enabled: true,
    conditions: [{ id: 'c1', field: 'subject', operator: 'contains', value: 'invoice' }],
  },
]

const FIXTURE_CALENDARS = [
  { id: 'work', name: 'Work', color: '#4f7c6b' },
  { id: 'personal', name: 'Personal', color: '#2db985' },
]

describe('SettingsView', () => {
  let pinia
  let router
  let store

  beforeEach(async () => {
    pinia = createPinia()
    setActivePinia(pinia)
    // The store's authHeaders sees no Auth0 client, matching stubbed-auth mode.
    setAuth0Client(null)
    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: { template: '<div />' } },
        {
          path: '/settings/:section?',
          name: 'settings',
          component: { template: '<div />' },
        },
      ],
    })
    await router.push('/settings/account')
    await router.isReady()
    store = useInboxStore()
    localStorage.clear()
    // The daily-notes pane mounts a real DocumentEditor (Editor.js), which
    // probes matchMedia during its async init — jsdom doesn't implement it.
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    )
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url) => ({
        ok: true,
        json: async () => {
          if (url === `${LABELS_API_URL}/labels/rules`) {
            return {
              rules: FIXTURE_RULES.map((rule) => ({
                ...rule,
                conditions: rule.conditions.map((c) => ({ ...c })),
              })),
            }
          }
          if (url === `${LABELS_API_URL}/categories`) {
            return { categories: FIXTURE_CATEGORIES.map((category) => ({ ...category })) }
          }
          if (String(url).includes('/tasks/interests')) return { interests: [] }
          if (String(url).includes('/tasks/enrichment-settings')) {
            return {
              enrichmentSettings: {
                model: 'gpt-5-nano',
                schedule: {
                  enabled: true,
                  days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
                  startHour: 9,
                  endHour: 19,
                  intervalHours: 1,
                  timezone: 'Europe/London',
                },
              },
            }
          }
          if (String(url).includes('/emails/spam-retention')) {
            return { spamRetentionDays: 30, defaultDays: 30, minDays: 1, maxDays: 365 }
          }
          if (String(url).includes('/calendars')) {
            return { calendars: FIXTURE_CALENDARS.map((calendar) => ({ ...calendar })) }
          }
          if (
            String(url).includes(`${TASKS_API_URL}/documents`) &&
            String(url).includes('templates')
          ) {
            return { templates: [] }
          }
          if (String(url).includes('/tasks/daily-note-seed')) return { blocks: [] }
          return { labels: FIXTURE_LABELS.map((label) => ({ ...label })) }
        },
      })),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function mountView() {
    return mount(SettingsView, {
      global: {
        plugins: [pinia, router],
        provide: { [AUTH0_INJECTION_KEY]: auth0Fake() },
      },
    })
  }

  async function openView() {
    const wrapper = mountView()
    await vi.waitFor(() => expect(store.labels).toHaveLength(2))
    await vi.waitFor(() => expect(store.rules).toHaveLength(1))
    await vi.waitFor(() => expect(store.categories).toHaveLength(1))
    await wrapper.vm.$nextTick()
    return wrapper
  }

  async function openPane(wrapper, section) {
    await router.push({ name: 'settings', params: { section } })
    await wrapper.vm.$nextTick()
  }

  async function openLabelsPane(wrapper) {
    await openPane(wrapper, 'labels')
  }

  async function openRulesPane(wrapper) {
    await openPane(wrapper, 'rules')
  }

  async function generateRule(wrapper, changes = {}) {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        draft: {
          name: 'Generated rule',
          kind: 'conditions',
          prompt: null,
          action: 'apply_label',
          label_id: 'l1',
          match_type: 'all',
          conditions: [{ field: 'subject', operator: 'contains', value: 'invoice' }],
          ...changes,
        },
      }),
    })
    await wrapper.get('[aria-label="Describe your filter"]').setValue('Tag invoices Finance')
    await wrapper.get('.rule-generator-form').trigger('submit')
    await flushPromises()
  }

  it('generates an editable draft without creating a rule', async () => {
    const wrapper = await openView()
    await openRulesPane(wrapper)
    expect(wrapper.find('.rule-editor-form').exists()).toBe(false)
    expect(wrapper.find('[aria-label="Rule type"]').exists()).toBe(false)
    await generateRule(wrapper)
    expect(fetch).toHaveBeenLastCalledWith(`${AI_API_URL}/rule-draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction: 'Tag invoices Finance' }),
    })
    expect(store.rules).toHaveLength(1)
    expect(wrapper.get('.rule-editor-form > input').element.value).toBe('Generated rule')
    expect(wrapper.get('.rule-condition-row input').element.value).toBe('invoice')
    await wrapper.get('.rule-editor-form > input').setValue('Corrected name')
    expect(store.rules).toHaveLength(1)
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Cancel')
      .trigger('click')
    expect(wrapper.find('.rule-editor-form').exists()).toBe(false)
    expect(store.rules).toHaveLength(1)
  })

  it('keeps the description and allows retry after generation fails', async () => {
    const wrapper = await openView()
    await openRulesPane(wrapper)
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({ error: 'Rules cannot forward mail.' }),
    })
    await wrapper.get('[aria-label="Describe your filter"]').setValue('Forward mail')
    await wrapper.get('.rule-generator-form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe('Rules cannot forward mail.')
    expect(wrapper.get('[aria-label="Describe your filter"]').element.value).toBe('Forward mail')
    expect(wrapper.find('.rule-editor-form').exists()).toBe(false)
    await generateRule(wrapper)
    expect(wrapper.find('.rule-editor-form').exists()).toBe(true)
  })

  it.each(['cancel', 'edit'])('ignores a late generation response after %s', async (action) => {
    const wrapper = await openView()
    await openRulesPane(wrapper)
    let finish
    const pending = new Promise((resolve) => {
      finish = resolve
    })
    fetch.mockReturnValueOnce(pending)
    await wrapper.get('[aria-label="Describe your filter"]').setValue('Tag bills')
    await wrapper.get('.rule-generator-form').trigger('submit')
    await flushPromises()
    const calls = fetch.mock.calls.length
    expect(wrapper.get('.rule-generator-form button[type="submit"]').element.disabled).toBe(true)
    await wrapper.get('.rule-generator-form').trigger('submit')
    expect(fetch.mock.calls).toHaveLength(calls)
    if (action === 'edit') await wrapper.get('[title="Edit Bills"]').trigger('click')
    else
      await wrapper
        .findAll('button')
        .find((button) => button.text() === 'Cancel')
        .trigger('click')
    finish({
      ok: true,
      json: async () => ({
        draft: { name: 'Late result', kind: 'ai', prompt: 'Bills', conditions: [] },
      }),
    })
    await flushPromises()
    expect(wrapper.find('.rule-editor-form').exists()).toBe(action === 'edit')
    expect(wrapper.element.querySelector('[aria-label="Rule name"]')?.value).toBe(
      action === 'edit' ? 'Bills' : undefined,
    )
    expect(store.rules).toHaveLength(1)
  })

  it('requires a tag selection when the generated tag is unresolved', async () => {
    const wrapper = await openView()
    await openRulesPane(wrapper)
    await generateRule(wrapper, { label_id: null })
    const calls = fetch.mock.calls.length
    await wrapper.get('.rule-editor-form').trigger('submit')
    expect(wrapper.get('[role="alert"]').text()).toBe('Choose a label to apply.')
    expect(fetch.mock.calls).toHaveLength(calls)
  })

  it('preserves a corrected draft if saving fails', async () => {
    const wrapper = await openView()
    await openRulesPane(wrapper)
    await generateRule(wrapper)
    await wrapper.get('[aria-label="Rule name"]').setValue('My correction')
    fetch.mockResolvedValueOnce({ ok: false, status: 500 })
    await wrapper.get('.rule-editor-form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe('Failed to save the rule.')
    expect(wrapper.get('[aria-label="Rule name"]').element.value).toBe('My correction')
    expect(store.rules).toHaveLength(1)
  })

  it('renders as a full page with grouped navigation and the Account pane', async () => {
    const wrapper = await openView()

    const navItems = wrapper.findAll('.settings-nav-item').map((n) => n.text())
    expect(navItems).toHaveLength(15)
    for (const [i, name] of [
      'Account',
      'Appearance',
      'Notifications',
      'Personalisation',
      'AI Today',
      'Signature',
      'Snippets',
      'Labels',
      'Categories',
      'Rules',
      'Auto Archive',
      'Spam',
      'Calendars',
      'Templates',
      'Time Management',
    ].entries()) {
      expect(navItems[i]).toContain(name)
    }
    expect(wrapper.findAll('.settings-nav-label').map((label) => label.text())).toEqual([
      'General',
      'Email',
      'Calendar',
      'Documents',
    ])
    expect(wrapper.find('.settings-page').exists()).toBe(true)
    expect(wrapper.find('.modal-overlay').exists()).toBe(false)
    expect(wrapper.get('.settings-page-header').text()).toBe('Account')
    expect(wrapper.find('.settings-account-name').text()).toBe('Allister')
    expect(wrapper.find('.settings-account-email').text()).toBe('allisteraall@gmail.com')
    expect(wrapper.find('.label-table').exists()).toBe(false)
  })

  it('filters the grouped navigation by setting name', async () => {
    const wrapper = await openView()

    await wrapper.get('.settings-search input').setValue('rules')

    expect(wrapper.findAll('.settings-nav-label').map((label) => label.text())).toEqual(['Email'])
    expect(
      wrapper.findAll('.settings-nav-item').map((item) => item.find('span:last-child').text()),
    ).toEqual(['Rules'])
  })

  it('opens calendar management from the Calendar settings group', async () => {
    const wrapper = await openView()

    await openPane(wrapper, 'calendar')
    await flushPromises()

    expect(wrapper.get('.settings-page-header').text()).toBe('Calendars')
    expect(wrapper.get('#your-calendars-heading').text()).toBe('Your calendars')
    expect(wrapper.text()).toContain('Work')
    expect(wrapper.text()).toContain('Subscriptions')
  })

  it('opens document template management from the Documents settings group', async () => {
    const wrapper = await openView()

    await openPane(wrapper, 'document-templates')
    await flushPromises()

    expect(wrapper.get('.settings-page-header').text()).toBe('Templates')
    expect(wrapper.text()).toContain('Document templates')
    expect(wrapper.text()).toContain('No templates yet')
  })

  it('opens the daily-notes editor from the Documents settings group', async () => {
    const wrapper = await openView()

    await openPane(wrapper, 'daily-notes')
    await flushPromises()

    expect(wrapper.get('.settings-page-header').text()).toBe('Time Management')
    expect(wrapper.text()).toContain('Time Management')
    expect(wrapper.text()).toContain('Today')
  })

  it('shows only the browser notifications toggle in the Notifications pane', async () => {
    const wrapper = await openView()

    await openPane(wrapper, 'notifications')

    // The stub email-summary / to-do / AI-suggestion toggles have been removed.
    const otherToggles = wrapper.findAll('.settings-switch:not(.browser-notifications-switch)')
    expect(otherToggles).toHaveLength(0)
    expect(wrapper.find('.browser-notifications-switch').exists()).toBe(true)

    const text = wrapper.text()
    expect(text).not.toContain('Email summaries')
    expect(text).not.toContain('To-do reminders')
    expect(text).not.toContain('AI suggestions')

    // Nothing writes the removed preference key anymore.
    expect(localStorage.getItem('cookie-settings-prefs')).toBeNull()
  })

  it('persists the theme preference from the Appearance pane', async () => {
    const wrapper = await openView()

    await openPane(wrapper, 'appearance')

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
    const wrapper = await openView()

    await openPane(wrapper, 'signature')

    const editor = wrapper.findComponent(ComposerEditor)
    expect(editor.exists()).toBe(true)

    editor.vm.$emit('update:modelValue', '<p>Cheers, Allister</p>')
    expect(store.signatureHtml).toBe('<p>Cheers, Allister</p>')
    expect(localStorage.getItem('cookie-signature-html')).toBe('<p>Cheers, Allister</p>')
  })

  it('saves a locally stored compose snippet from the Snippets pane', async () => {
    const wrapper = await openView()
    await openPane(wrapper, 'snippets')

    await wrapper.find('.snippet-editor-form > .label-input').setValue('Hello World')
    wrapper
      .findComponent(ComposerEditor)
      .vm.$emit('update:modelValue', '<p>Hello <strong>there</strong></p>')
    await wrapper.find('.snippet-editor-form').trigger('submit')

    expect(store.snippets).toEqual([
      expect.objectContaining({ name: 'hello-world', html: '<p>Hello <strong>there</strong></p>' }),
    ])
    expect(JSON.parse(localStorage.getItem('cookie-compose-snippets'))[0].name).toBe('hello-world')
  })

  it('requests browser permission and enables new-mail notifications for the current user', async () => {
    store.userId = '11111111-1111-1111-1111-111111111111'
    const requestPermission = vi.fn().mockResolvedValue('granted')
    vi.stubGlobal('Notification', { permission: 'default', requestPermission })
    const wrapper = await openView()

    await openPane(wrapper, 'notifications')
    await wrapper.find('.browser-notifications-switch').setValue(true)
    await vi.waitFor(() => expect(requestPermission).toHaveBeenCalledTimes(1))

    expect(wrapper.find('.browser-notifications-switch').element.checked).toBe(true)
    expect(
      JSON.parse(
        localStorage.getItem('cookie-browser-notifications:11111111-1111-1111-1111-111111111111'),
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
    const wrapper = await openView()

    await openPane(wrapper, 'notifications')
    await wrapper.find('.browser-notifications-switch').setValue(true)
    await vi.waitFor(() => expect(requestPermission).toHaveBeenCalledTimes(1))

    expect(wrapper.find('.browser-notifications-switch').element.checked).toBe(false)
    expect(wrapper.find('.browser-notifications-switch').element.disabled).toBe(true)
    expect(wrapper.find('.browser-notifications-status').text()).toContain('blocked')
  })

  describe('Spam pane', () => {
    it('sits in the Email group and shows the stored retention', async () => {
      const wrapper = await openView()
      await vi.waitFor(() => expect(store.spamRetentionLoaded).toBe(true))

      const emailGroup = wrapper
        .findAll('.settings-nav-group')
        .find((group) => group.text().includes('Email'))
      expect(emailGroup.text()).toContain('Spam')

      await openPane(wrapper, 'spam')
      const pane = wrapper.find('[data-testid="spam-section"]')
      expect(pane.exists()).toBe(true)
      expect(pane.text()).toContain('Delete spam automatically')
      expect(pane.find('input[type="number"]').element.value).toBe('30')
      expect(pane.find('button[type="submit"]').attributes('disabled')).toBeDefined()
    })

    it('saves a new retention and confirms it', async () => {
      const wrapper = await openView()
      await vi.waitFor(() => expect(store.spamRetentionLoaded).toBe(true))
      await openPane(wrapper, 'spam')
      const pane = wrapper.find('[data-testid="spam-section"]')
      fetch.mockImplementation(async () => ({
        ok: true,
        json: async () => ({ spamRetentionDays: 14, defaultDays: 30, minDays: 1, maxDays: 365 }),
      }))

      await pane.find('input[type="number"]').setValue('14')
      expect(pane.find('button[type="submit"]').attributes('disabled')).toBeUndefined()
      await pane.find('form').trigger('submit')
      await flushPromises()

      expect(fetch).toHaveBeenCalledWith(
        `${EMAILS_API_URL}/emails/spam-retention`,
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ spamRetentionDays: 14 }),
        }),
      )
      expect(store.spamRetentionDays).toBe(14)
      expect(store.toasts.at(-1).message).toBe('Spam will be deleted after 14 days.')
    })

    it('refuses an out-of-range value without calling the server', async () => {
      const wrapper = await openView()
      await vi.waitFor(() => expect(store.spamRetentionLoaded).toBe(true))
      await openPane(wrapper, 'spam')
      const pane = wrapper.find('[data-testid="spam-section"]')
      fetch.mockClear()

      await pane.find('input[type="number"]').setValue('0')
      await pane.find('form').trigger('submit')
      await flushPromises()

      expect(pane.find('[role="alert"]').text()).toBe('Enter a whole number of days from 1 to 365.')
      expect(fetch).not.toHaveBeenCalled()
      expect(store.spamRetentionDays).toBe(30)
    })
  })

  it('lists labels with colors and descriptions in the Labels pane', async () => {
    const wrapper = await openView()
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
    const wrapper = await openView()
    await openLabelsPane(wrapper)
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ label: {} }) })

    await wrapper.findAll('.label-auto-tag-switch')[1].setValue(true)

    expect(fetch).toHaveBeenLastCalledWith(`${LABELS_API_URL}/labels`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'l2', auto_apply: true }),
    })
    expect(store.labels[1].auto_apply).toBe(true)
  })

  it('renames a user label inline', async () => {
    const wrapper = await openView()
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
    await vi.waitFor(() =>
      expect(store.labels.find((label) => label.id === 'l1')?.name).toBe('Money'),
    )
    await wrapper.vm.$nextTick()

    expect(fetch).toHaveBeenLastCalledWith(`${LABELS_API_URL}/labels`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'l1', name: 'Money' }),
    })
    expect(wrapper.find('.label-rename-input').exists()).toBe(false)
    expect(wrapper.findAll('.ni-label-pill').some((pill) => pill.text() === 'Money')).toBe(true)
  })

  it('creates a label from the form and resets it', async () => {
    const wrapper = await openView()
    await openLabelsPane(wrapper)

    fetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({
        label: {
          id: 'l3',
          name: 'Receipts',
          color: '#1a73e8',
          kind: 'user',
          description: null,
          message_count: 0,
        },
      }),
    })

    await wrapper.find('.label-input').setValue('Receipts')
    await wrapper.find('.label-create-form').trigger('submit')
    await vi.waitFor(() => expect(store.labels).toHaveLength(3))
    await wrapper.vm.$nextTick()

    expect(fetch).toHaveBeenLastCalledWith(`${LABELS_API_URL}/labels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Receipts', color: '#1a73e8', description: '' }),
    })
    expect(wrapper.findAll('.label-table-row')).toHaveLength(3)
    expect(wrapper.find('.label-input').element.value).toBe('')
  })

  it('deletes a label from its row', async () => {
    const wrapper = await openView()
    await openLabelsPane(wrapper)

    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
    await wrapper.find('.label-delete-btn').trigger('click')
    await vi.waitFor(() => expect(store.labels).toHaveLength(1))

    expect(fetch).toHaveBeenLastCalledWith(`${LABELS_API_URL}/labels`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'l1' }),
    })
  })

  it('lists, creates and edits single-value Categories', async () => {
    const wrapper = await openView()
    await openPane(wrapper, 'categories')

    expect(wrapper.find('.ni-category-pill').text()).toBe('Projects')
    expect(wrapper.find('.label-description').text()).toBe('Active work')

    fetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({
        category: {
          id: 'c2',
          name: 'Clients',
          color: '#1a73e8',
          description: null,
          message_count: 0,
        },
      }),
    })
    await wrapper.find('input[placeholder="Category name"]').setValue('Clients')
    await wrapper.find('.category-settings .label-create-form').trigger('submit')
    await vi.waitFor(() => expect(store.categories).toHaveLength(2))

    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        category: {
          ...FIXTURE_CATEGORIES[0],
          name: 'Building projects',
          description: 'Current construction work',
        },
      }),
    })
    await wrapper.get('[title="Edit Projects"]').trigger('click')
    const name = wrapper.get('[aria-label="Edit name for Projects"]')
    const description = wrapper.get('[aria-label="Edit description for Projects"]')
    expect(description.element.value).toBe('Active work')
    await name.setValue('Building projects')
    await description.setValue('Current construction work')
    await description.trigger('keydown', { key: 'Enter' })
    await vi.waitFor(() =>
      expect(store.categories.find((category) => category.id === 'c1')?.name).toBe(
        'Building projects',
      ),
    )

    expect(fetch).toHaveBeenLastCalledWith(`${LABELS_API_URL}/categories`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'c1',
        name: 'Building projects',
        description: 'Current construction work',
      }),
    })
    expect(wrapper.find('.label-description').text()).toBe('Current construction work')
  })

  it('lists rules with their target label and condition summary', async () => {
    const wrapper = await openView()
    await openRulesPane(wrapper)

    const rows = wrapper.findAll('.rule-row')
    expect(rows).toHaveLength(1)
    expect(rows[0].find('.rule-row-name').text()).toBe('Bills')
    expect(rows[0].find('.ni-label-pill').text()).toBe('Finance')
    expect(rows[0].find('.rule-row-summary').text()).toContain('Subject contains "invoice"')
    expect(rows[0].find('input[type="checkbox"]').element.checked).toBe(true)
  })

  it('switches a rule to mark_done and drops its label_id', async () => {
    const wrapper = await openView()
    await openRulesPane(wrapper)

    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        rule: { ...FIXTURE_RULES[0], action: 'mark_done', label_id: null },
      }),
    })

    await wrapper.find('.rule-row .ni-action-btn').trigger('click')
    await wrapper.findAll('.rule-create-fields select')[1].setValue('mark_done')
    await wrapper.find('.rule-editor-form').trigger('submit')

    await vi.waitFor(() => expect(store.rules[0].action).toBe('mark_done'))

    expect(fetch).toHaveBeenLastCalledWith(`${LABELS_API_URL}/labels/rules`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'r1',
        name: 'Bills',
        kind: 'conditions',
        action: 'mark_done',
        match_type: 'all',
        conditions: [{ id: 'c1', field: 'subject', operator: 'contains', value: 'invoice' }],
      }),
    })
  })

  it('toggles whether a rule is enabled', async () => {
    const wrapper = await openView()
    await openRulesPane(wrapper)
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ rule: { ...FIXTURE_RULES[0], enabled: false } }),
    })

    await wrapper.find('.rule-row input[type="checkbox"]').setValue(false)

    expect(fetch).toHaveBeenLastCalledWith(`${LABELS_API_URL}/labels/rules`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'r1', enabled: false }),
    })
    expect(store.rules[0].enabled).toBe(false)
  })

  it('creates a rule from the form and resets it', async () => {
    const wrapper = await openView()
    await openRulesPane(wrapper)
    await generateRule(wrapper)

    fetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({
        rule: {
          id: 'r2',
          name: 'Newsletters',
          action: 'apply_label',
          label_id: 'l2',
          match_type: 'all',
          enabled: true,
          conditions: [{ field: 'from', operator: 'contains', value: 'news@', position: 0 }],
        },
      }),
    })

    await wrapper.find('.rule-editor-form > input.label-input').setValue('Newsletters')
    await wrapper.find('.rule-condition-row select').setValue('from')
    await wrapper.find('.rule-condition-row input.label-input').setValue('news@')
    await wrapper.findAll('.rule-create-fields select')[2].setValue('l2')
    await wrapper.find('.rule-editor-form').trigger('submit')

    await vi.waitFor(() => expect(store.rules).toHaveLength(2))

    expect(fetch).toHaveBeenLastCalledWith(`${LABELS_API_URL}/labels/rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Newsletters',
        kind: 'conditions',
        action: 'apply_label',
        match_type: 'all',
        conditions: [{ field: 'from', operator: 'contains', value: 'news@' }],
        label_id: 'l2',
      }),
    })
  })

  it('creates a Cookie AI rule from a plain-language prompt', async () => {
    const wrapper = await openView()
    await openRulesPane(wrapper)
    await generateRule(wrapper, { kind: 'ai', prompt: 'Shop receipts', conditions: [] })

    fetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({
        rule: {
          id: 'r2',
          name: 'Receipts',
          kind: 'ai',
          prompt: 'Receipts and order confirmations from online shops',
          action: 'apply_label',
          label_id: 'l2',
          match_type: 'all',
          enabled: true,
          conditions: [],
        },
      }),
    })

    await wrapper.find('.rule-editor-form > input.label-input').setValue('Receipts')
    expect(wrapper.find('.rule-condition-row').exists()).toBe(false)
    await wrapper
      .find('[aria-label="AI prompt"]')
      .setValue('Receipts and order confirmations from online shops')
    await wrapper.findAll('.rule-create-fields select')[1].setValue('l2')
    await wrapper.find('.rule-editor-form').trigger('submit')

    await vi.waitFor(() => expect(store.rules).toHaveLength(2))

    expect(fetch).toHaveBeenLastCalledWith(`${LABELS_API_URL}/labels/rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Receipts',
        kind: 'ai',
        action: 'apply_label',
        prompt: 'Receipts and order confirmations from online shops',
        label_id: 'l2',
      }),
    })
    const row = wrapper.findAll('.rule-row').find((node) => node.text().includes('Receipts'))
    expect(row.find('.rule-row-summary').text()).toContain(
      'Cookie AI: "Receipts and order confirmations from online shops"',
    )
  })

  it('refuses to save an AI rule with an empty prompt', async () => {
    const wrapper = await openView()
    await openRulesPane(wrapper)
    await generateRule(wrapper, { kind: 'ai', prompt: 'Shop receipts', conditions: [] })
    const calls = fetch.mock.calls.length

    await wrapper.get('[aria-label="AI prompt"]').setValue('')
    await wrapper.findAll('.rule-create-fields select')[1].setValue('l2')
    await wrapper.find('.rule-editor-form').trigger('submit')

    expect(wrapper.find('.snippet-error').text()).toBe('Describe the mail this rule should catch.')
    expect(fetch.mock.calls).toHaveLength(calls)
  })

  it('creates a mark_done rule without a label', async () => {
    const wrapper = await openView()
    await openRulesPane(wrapper)
    await generateRule(wrapper)

    fetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({
        rule: {
          id: 'r2',
          name: 'Spam',
          action: 'mark_done',
          label_id: null,
          match_type: 'all',
          enabled: true,
          conditions: [{ field: 'from', operator: 'contains', value: 'noreply@', position: 0 }],
        },
      }),
    })

    await wrapper.find('.rule-editor-form > input.label-input').setValue('Spam')
    await wrapper.find('.rule-condition-row select').setValue('from')
    await wrapper.find('.rule-condition-row input.label-input').setValue('noreply@')
    await wrapper.findAll('.rule-create-fields select')[1].setValue('mark_done')
    await wrapper.find('.rule-editor-form').trigger('submit')

    await vi.waitFor(() => expect(store.rules).toHaveLength(2))

    expect(fetch).toHaveBeenLastCalledWith(`${LABELS_API_URL}/labels/rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Spam',
        kind: 'conditions',
        action: 'mark_done',
        match_type: 'all',
        conditions: [{ field: 'from', operator: 'contains', value: 'noreply@' }],
      }),
    })
  })

  it('deletes a rule from its row', async () => {
    const wrapper = await openView()
    await openRulesPane(wrapper)

    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
    await wrapper.find('.rule-row .label-delete-btn').trigger('click')
    await vi.waitFor(() => expect(store.rules).toHaveLength(0))

    expect(fetch).toHaveBeenLastCalledWith(`${LABELS_API_URL}/labels/rules`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'r1' }),
    })
  })

  it('links back to the app', async () => {
    const wrapper = await openView()

    expect(wrapper.get('.settings-back-link').attributes('href')).toBe('/')
  })

  describe('Personalisation pane', () => {
    async function openPersonalisationPane(wrapper) {
      await openPane(wrapper, 'personalisation')
    }

    it('lists the stored topics and explains what they affect', async () => {
      store.interests = ['Cloudflare Workers', 'Postgres']
      store.interestsLoaded = true

      const wrapper = await openView()
      await openPersonalisationPane(wrapper)

      const section = wrapper.get('[data-testid="personalisation-section"]')
      expect(section.text()).toContain('UK headlines are never filtered')
      const chips = wrapper
        .get('[data-testid="interest-chips"]')
        .findAll('.interest-chip > span:first-child')
      expect(chips.map((c) => c.text())).toEqual(['Cloudflare Workers', 'Postgres'])
    })

    it('adds a topic and persists the whole list', async () => {
      store.interests = ['Postgres']
      store.interestsLoaded = true
      const saveInterests = vi.spyOn(store, 'saveInterests').mockResolvedValue(['Postgres', 'Vue'])

      const wrapper = await openView()
      await openPersonalisationPane(wrapper)
      await wrapper.get('.interest-add input').setValue('Vue')
      await wrapper.get('.interest-add').trigger('submit')
      await flushPromises()

      expect(saveInterests).toHaveBeenCalledWith(['Postgres', 'Vue'])
    })

    it('refuses a duplicate without calling the API', async () => {
      store.interests = ['Vue']
      store.interestsLoaded = true
      const saveInterests = vi.spyOn(store, 'saveInterests')

      const wrapper = await openView()
      await openPersonalisationPane(wrapper)
      await wrapper.get('.interest-add input').setValue('vue')
      await wrapper.get('.interest-add').trigger('submit')
      await flushPromises()

      expect(saveInterests).not.toHaveBeenCalled()
      expect(wrapper.get('.snippet-error').text()).toContain('Already on the list')
    })

    it('removes a topic', async () => {
      store.interests = ['Vue', 'Postgres']
      store.interestsLoaded = true
      const saveInterests = vi.spyOn(store, 'saveInterests').mockResolvedValue(['Postgres'])

      const wrapper = await openView()
      await openPersonalisationPane(wrapper)
      await wrapper.get('.interest-chip .interest-remove').trigger('click')
      await flushPromises()

      expect(saveInterests).toHaveBeenCalledWith(['Postgres'])
    })

    it('reports a failed save', async () => {
      store.interests = []
      store.interestsLoaded = true
      vi.spyOn(store, 'saveInterests').mockRejectedValue(new Error('boom'))

      const wrapper = await openView()
      await openPersonalisationPane(wrapper)
      await wrapper.get('.interest-add input').setValue('Vue')
      await wrapper.get('.interest-add').trigger('submit')
      await flushPromises()

      expect(wrapper.get('.snippet-error').text()).toContain('Could not save')
    })
  })
})
