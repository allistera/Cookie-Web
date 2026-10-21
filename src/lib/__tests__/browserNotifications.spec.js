import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  browserNotificationPermission,
  browserNotificationPreferenceKey,
  browserNotificationsEnabled,
  browserNotificationsSupported,
  requestBrowserNotificationPermission,
  saveBrowserNotificationsEnabled,
  showNewEmailNotification,
} from '../browserNotifications'

beforeEach(() => localStorage.clear())
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('browser notification preferences', () => {
  it('separates account preferences and requires an account', () => {
    expect(browserNotificationPreferenceKey(null)).toBeNull()
    saveBrowserNotificationsEnabled(null, true)
    expect(localStorage.length).toBe(0)
    expect(browserNotificationsEnabled(null)).toBe(false)
    saveBrowserNotificationsEnabled('alice', true)
    saveBrowserNotificationsEnabled('bob', false)
    expect(browserNotificationsEnabled('alice')).toBe(true)
    expect(browserNotificationsEnabled('bob')).toBe(false)
    expect(browserNotificationsEnabled('carol')).toBe(false)
  })

  it.each(['not-json', '{"enabled":"true"}', '{"enabled":false}'])(
    'rejects invalid or disabled stored preference %s',
    (value) => {
      localStorage.setItem(browserNotificationPreferenceKey('alice'), value)
      expect(browserNotificationsEnabled('alice')).toBe(false)
    },
  )

  it('tolerates unavailable storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Storage blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Storage blocked')
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(browserNotificationsEnabled('alice')).toBe(false)
    saveBrowserNotificationsEnabled('alice', true)
    expect(console.error).toHaveBeenCalledWith(
      'Failed to save browser notification preference:',
      expect.any(Error),
    )
  })
})

describe('browser notification permission and delivery', () => {
  it('handles browsers without notification support', async () => {
    vi.stubGlobal('Notification', undefined)
    expect(browserNotificationsSupported()).toBe(false)
    expect(browserNotificationPermission()).toBe('unsupported')
    expect(await requestBrowserNotificationPermission()).toBe('unsupported')
    expect(showNewEmailNotification({ id: 'mail' })).toBeNull()
  })

  it.each(['denied', 'granted'])(
    'returns existing %s permission without prompting',
    async (permission) => {
      const requestPermission = vi.fn()
      vi.stubGlobal('Notification', { permission, requestPermission })
      expect(browserNotificationPermission()).toBe(permission)
      expect(await requestBrowserNotificationPermission()).toBe(permission)
      expect(requestPermission).not.toHaveBeenCalled()
    },
  )

  it('requests permission only when it has not been decided', async () => {
    const requestPermission = vi.fn().mockResolvedValue('granted')
    vi.stubGlobal('Notification', { permission: 'default', requestPermission })
    expect(browserNotificationsSupported()).toBe(true)
    expect(await requestBrowserNotificationPermission()).toBe('granted')
    expect(requestPermission).toHaveBeenCalledOnce()
  })

  it.each([
    [{ id: 'mail-1', sender: 'Alice', subject: 'Meeting' }, 'New email from Alice', 'Meeting'],
    [{ id: 'mail-2' }, 'New email from Unknown sender', '(No subject)'],
  ])('shows a notification for $0.id and focuses the app on click', (message, title, body) => {
    const close = vi.fn()
    const Notification = vi.fn(function () {
      this.close = close
    })
    vi.stubGlobal('Notification', Notification)
    const focus = vi.spyOn(window, 'focus').mockImplementation(() => {})
    const result = showNewEmailNotification(message)
    expect(Notification).toHaveBeenCalledExactlyOnceWith(title, {
      body,
      icon: '/icons/icon-192.png',
      tag: `cookie-email-${message.id}`,
    })
    result.onclick()
    expect(focus).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
  })

  it('ignores missing messages and handles rejected notification construction', () => {
    const Notification = vi.fn(function () {
      throw new Error('Permission denied')
    })
    vi.stubGlobal('Notification', Notification)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(showNewEmailNotification(null)).toBeNull()
    expect(Notification).not.toHaveBeenCalled()
    expect(showNewEmailNotification({ id: 'mail' })).toBeNull()
    expect(console.error).toHaveBeenCalledWith(
      'Failed to show browser notification:',
      expect.any(Error),
    )
  })
})
