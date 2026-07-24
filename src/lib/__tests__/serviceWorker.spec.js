import { afterEach, describe, expect, it, vi } from 'vitest'

import { clearCachedMail, registerServiceWorker } from '../serviceWorker'

describe('service worker helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('registers the worker in production', async () => {
    const registration = { active: {} }
    const serviceWorker = { register: vi.fn().mockResolvedValue(registration) }

    await expect(registerServiceWorker({ isProduction: true, serviceWorker })).resolves.toBe(
      registration,
    )
    expect(serviceWorker.register).toHaveBeenCalledWith('/sw.js')
  })

  it('does not register the worker outside production', async () => {
    const serviceWorker = { register: vi.fn() }

    await expect(registerServiceWorker({ isProduction: false, serviceWorker })).resolves.toBeNull()
    expect(serviceWorker.register).not.toHaveBeenCalled()
  })

  it('keeps startup working when registration fails', async () => {
    const error = new Error('registration failed')
    const serviceWorker = { register: vi.fn().mockRejectedValue(error) }
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(registerServiceWorker({ isProduction: true, serviceWorker })).resolves.toBeNull()
    expect(console.error).toHaveBeenCalledWith('Failed to register service worker:', error)
  })

  it('asks the active worker to clear private mail on logout', () => {
    const postMessage = vi.fn()

    clearCachedMail({ controller: { postMessage } })

    expect(postMessage).toHaveBeenCalledWith({ type: 'CLEAR_MAIL_CACHE' })
  })
})
