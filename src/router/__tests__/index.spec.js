import { describe, it, expect, beforeEach } from 'vitest'

import router from '../index'
import { setAuth0Client } from '../../auth0-client'

describe('router', () => {
  beforeEach(() => {
    // Stubbed auth, as in E2E mode, so the guard lets navigation through.
    setAuth0Client(null)
  })

  it('redirects unknown paths to the AI inbox', async () => {
    await router.push('/no-such-page/deeper')
    expect(router.currentRoute.value.name).toBe('ai-inbox')
    expect(router.currentRoute.value.fullPath).toBe('/')
  })

  it('still resolves known routes', () => {
    expect(router.resolve('/settings/rules').name).toBe('settings')
  })
})
