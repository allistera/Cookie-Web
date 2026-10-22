import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { nextTick, ref } from 'vue'
import router from '../index'
import { setAuth0Client } from '../../auth0-client'

describe('router', () => {
  beforeEach(() => {
    // Stubbed auth, as in E2E mode, so the guard lets navigation through.
    setAuth0Client(null)
  })

  afterEach(() => {
    setAuth0Client(null)
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('redirects unknown paths to the AI inbox', async () => {
    await router.push('/no-such-page/deeper')
    expect(router.currentRoute.value.name).toBe('ai-inbox')
    expect(router.currentRoute.value.fullPath).toBe('/')
  })

  it.each([
    ['/', 'ai-inbox'],
    ['/inbox', 'traditional-inbox'],
    ['/calendar', 'calendar'],
    ['/drafts', 'drafts'],
    ['/scheduled', 'scheduled-sends'],
    ['/documents/file/upload-1', 'document-file'],
    ['/documents/doc-1', 'documents'],
    ['/search?q=work', 'search'],
    ['/tasks', 'tasks'],
    ['/settings/account', 'settings'],
  ])('loads the authenticated view for %s', async (path, name) => {
    const frame = vi.fn((complete) => {
      complete()
      return 1
    })
    vi.stubGlobal('requestAnimationFrame', frame)
    await router.push(path)
    await nextTick()
    expect(router.currentRoute.value.name).toBe(name)
    expect(router.currentRoute.value.meta.requiresAuth).toBe(true)
    expect(router.currentRoute.value.matched[0].components.default).toBeTruthy()
  })

  it('still resolves known routes', () => {
    expect(router.resolve('/settings/rules').name).toBe('settings')
  })
})

describe('route authentication', () => {
  afterEach(() => {
    setAuth0Client(null)
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('blocks an unauthenticated navigation without starting a login redirect', async () => {
    setAuth0Client(null)
    await router.push('/')
    const loginWithRedirect = vi.fn()
    setAuth0Client({ isLoading: ref(false), isAuthenticated: ref(false), loginWithRedirect })
    const failure = await router.push('/drafts')
    expect(failure).toBeTruthy()
    expect(router.currentRoute.value.path).toBe('/')
    expect(loginWithRedirect).not.toHaveBeenCalled()
  })

  it.each([true, false])(
    'waits for authentication initialization (authenticated=%s)',
    async (authenticated) => {
      setAuth0Client(null)
      await router.push('/')
      const auth = { isLoading: ref(true), isAuthenticated: ref(false) }
      const loadingRead = vi.spyOn(auth.isLoading, 'value', 'get')
      setAuth0Client(auth)
      let completed = false
      const navigation = router.push('/scheduled').then(() => {
        completed = true
      })
      await vi.waitFor(() => expect(loadingRead).toHaveBeenCalled())
      expect(completed).toBe(false)
      auth.isAuthenticated.value = authenticated
      auth.isLoading.value = false
      await navigation
      expect(router.currentRoute.value.path).toBe(authenticated ? '/scheduled' : '/')
    },
  )

  it('allows unprotected routes and completes route timing without animation-frame support', async () => {
    vi.stubGlobal('requestAnimationFrame', undefined)
    const remove = router.addRoute({ path: '/public-test', component: { template: '<div />' } })
    setAuth0Client({ isLoading: ref(false), isAuthenticated: ref(false) })
    try {
      await router.push('/public-test')
      await nextTick()
      expect(router.currentRoute.value.path).toBe('/public-test')
    } finally {
      remove()
    }
  })
})
