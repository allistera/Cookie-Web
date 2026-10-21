import { shallowMount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick, ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { AUTH0_INJECTION_KEY } from '@auth0/auth0-vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App.vue'
import { useInboxStore } from '../stores/inbox'
import { useOutOfOfficeStore } from '../stores/outOfOffice'
import { useContactInsightsStore } from '../stores/contactInsights'
import { useSidebarWidth } from '../composables/useSidebarWidth'

let wrapper
let router
let store
let auth
beforeEach(() => {
  setActivePinia(createPinia())
  store = useInboxStore()
  auth = {
    isAuthenticated: ref(true),
    isLoading: ref(false),
    user: ref(null),
    loginWithRedirect: vi.fn(),
    logout: vi.fn(),
  }
  vi.spyOn(useOutOfOfficeStore(), 'load').mockResolvedValue(true)
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'ai-inbox', component: { template: '<div />' } },
      { path: '/inbox', name: 'traditional-inbox', component: { template: '<div />' } },
      { path: '/search', name: 'search', component: { template: '<div />' } },
      { path: '/calendar', name: 'calendar', component: { template: '<div />' } },
      { path: '/documents', name: 'documents', component: { template: '<div />' } },
      { path: '/tasks', name: 'tasks', component: { template: '<div />' } },
      {
        path: '/settings/:section',
        name: 'settings',
        meta: { layout: 'settings' },
        component: { template: '<div />' },
      },
    ],
  })
})
afterEach(async () => {
  wrapper?.unmount()
  await vi.dynamicImportSettled()
  document.body.innerHTML = ''
  useSidebarWidth().resetWidth()
  vi.useRealTimers()
  vi.restoreAllMocks()
})
async function render(path = '/') {
  await router.push(path)
  wrapper = shallowMount(App, {
    attachTo: document.body,
    global: {
      plugins: [router],
      provide: { [AUTH0_INJECTION_KEY]: auth },
      stubs: { RouterLink: false },
    },
  })
  await flushPromises()
}
async function key(value, options = {}) {
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...options }),
  )
  await nextTick()
}

describe('application shell', () => {
  it('shows loading and login states and starts authentication', async () => {
    auth.isLoading.value = true
    auth.isAuthenticated.value = false
    await render()
    expect(wrapper.text()).toContain('Loading Cookie...')
    auth.isLoading.value = false
    await nextTick()
    await wrapper.get('.login-btn').trigger('click')
    expect(auth.loginWithRedirect).toHaveBeenCalledOnce()
    expect(wrapper.find('.app-container').exists()).toBe(false)
  })

  it.each([
    ['/', 'Email'],
    ['/calendar', 'Calendar'],
    ['/documents', 'Documents'],
    ['/tasks', 'Tasks'],
  ])('selects the shell for %s', async (path, label) => {
    await render(path)
    expect(wrapper.get('.logo-suffix').text()).toBe(label)
    expect(wrapper.findAll('.app-switcher-menu-item')).toHaveLength(3)
  })

  it('toggles task navigation and closes it after navigation', async () => {
    await render('/tasks')
    await wrapper.get('.tasks-navigation-toggle').trigger('click')
    expect(wrapper.get('.tasks-navigation-toggle').attributes('aria-expanded')).toBe('true')
    await router.push('/tasks?project=work')
    await nextTick()
    expect(wrapper.get('.tasks-navigation-toggle').attributes('aria-expanded')).toBe('false')
  })

  it('opens profile settings and uses the standalone settings layout', async () => {
    auth.user.value = { name: 'Example User', email: 'user@example.com', picture: '/avatar.png' }
    await render()
    await wrapper.get('.profile-trigger').trigger('click')
    expect(wrapper.get('.user-name').text()).toBe('Example User')
    document.body.click()
    await nextTick()
    expect(wrapper.find('.profile-dropdown').exists()).toBe(false)
    await wrapper.get('.profile-trigger').trigger('click')
    await wrapper.get('.dropdown-menu-btn').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/settings/account')
    expect(wrapper.find('.app-container').exists()).toBe(false)
  })

  it('preserves local recovery copies when logout is cancelled', async () => {
    await render()
    store.draftRecoveries = [{ id: 'local', durable: false }]
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    await wrapper.get('.profile-trigger').trigger('click')
    await wrapper.get('.logout-btn').trigger('click')
    expect(auth.logout).not.toHaveBeenCalled()
    expect(store.draftRecoveries).toHaveLength(1)
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })

  it('debounces header search, preserves scope, and clears when leaving search', async () => {
    await render('/search?q=old&scope=mail')
    vi.useFakeTimers()
    const input = wrapper.get('[aria-label=Search]')
    expect(input.element.value).toBe('old')
    await input.setValue('new query')
    await vi.advanceTimersByTimeAsync(599)
    expect(router.currentRoute.value.query.q).toBe('old')
    await vi.advanceTimersByTimeAsync(1)
    expect(router.currentRoute.value.query).toEqual({ q: 'new query', scope: 'mail' })
    await wrapper.get('[aria-label="Clear search"]').trigger('click')
    expect(input.element.value).toBe('')
    await router.push('/inbox')
    await nextTick()
    expect(input.element.value).toBe('')
  })

  it('searches immediately on Enter but ignores single-character input', async () => {
    await render()
    const input = wrapper.get('[aria-label=Search]')
    await input.setValue('x')
    await input.trigger('keydown', { key: 'Enter' })
    expect(router.currentRoute.value.path).toBe('/')
    await input.setValue('invoice')
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(router.currentRoute.value.query.q).toBe('invoice')
  })

  it('opens shortcuts while leaving typing and modified keys alone', async () => {
    await render()
    await key('/', { ctrlKey: true })
    expect(store.isCommandPaletteOpen).toBe(false)
    await wrapper.get('[aria-label=Search]').trigger('keydown', { key: '/' })
    expect(store.isCommandPaletteOpen).toBe(false)
    await key('/')
    expect(store.isCommandPaletteOpen).toBe(true)
    store.isCommandPaletteOpen = false
    await key('?')
    expect(store.isShortcutsHelpOpen).toBe(true)
  })

  it('shows sender-review notifications and routes to the screening inbox', async () => {
    await render()
    store.screeningCount = 101
    await nextTick()
    expect(wrapper.get('.header-notification-count').text()).toBe('99+')
    await wrapper.get('.header-notification-btn').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.filter).toBe('screening')
    store.screeningCount = 1
    await nextTick()
    expect(wrapper.get('.header-notification-count').text()).toBe('1')
  })

  it('pauses, resumes and undoes pending sends from the toast', async () => {
    await render()
    store.pendingSend = { secondsLeft: 5 }
    const pause = vi.spyOn(store, 'pausePendingSend').mockImplementation(() => {})
    const resume = vi.spyOn(store, 'resumePendingSend').mockImplementation(() => {})
    const undo = vi.spyOn(store, 'undoPendingSend').mockImplementation(() => {})
    await nextTick()
    await wrapper.get('.undo-send-toast').trigger('mouseenter')
    expect(pause).toHaveBeenCalledOnce()
    await wrapper.get('.undo-send-toast').trigger('mouseleave')
    expect(resume).toHaveBeenCalledOnce()
    await wrapper.get('.undo-send-btn').trigger('click')
    expect(undo).toHaveBeenCalledOnce()
  })

  it('runs and dismisses toast actions and supports the undo shortcut', async () => {
    await render()
    store.toasts = [
      { id: 'notice', kind: 'error', message: 'Try again', action: { label: 'Undo' } },
    ]
    const run = vi.spyOn(store, 'runToastAction').mockImplementation(() => {})
    const dismiss = vi.spyOn(store, 'dismissToast').mockImplementation(() => {})
    const undo = vi.spyOn(store, 'undoLatestAction').mockImplementation(() => {})
    await nextTick()
    expect(wrapper.get('[role=alert]').text()).toContain('Try again')
    await wrapper.get('.toast-action').trigger('click')
    expect(run).toHaveBeenCalledWith('notice')
    await key('u')
    expect(undo).toHaveBeenCalledOnce()
    await wrapper.get('[aria-label="Dismiss notification"]').trigger('click')
    expect(dismiss).toHaveBeenCalledWith('notice')
  })

  it('applies the temporary sidebar width and closes contact insights when switching apps', async () => {
    await render()
    useSidebarWidth().setWidth(320)
    const close = vi.spyOn(useContactInsightsStore(), 'close')
    await nextTick()
    expect(wrapper.get('.app-body').attributes('style')).toContain('--sidebar-width: 320px')
    await router.push('/documents')
    await nextTick()
    expect(close).toHaveBeenCalled()
  })
})
