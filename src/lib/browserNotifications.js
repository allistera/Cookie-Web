const PREFERENCE_KEY_PREFIX = 'cookie-browser-notifications:'

export function browserNotificationsSupported() {
  return globalThis.Notification !== undefined
}

export function browserNotificationPermission() {
  return browserNotificationsSupported() ? globalThis.Notification.permission : 'unsupported'
}

export function browserNotificationPreferenceKey(userId) {
  return userId ? `${PREFERENCE_KEY_PREFIX}${userId}` : null
}

export function browserNotificationsEnabled(userId) {
  const key = browserNotificationPreferenceKey(userId)
  if (!key) return false
  try {
    return JSON.parse(localStorage.getItem(key) || '{}').enabled === true
  } catch {
    return false
  }
}

export function saveBrowserNotificationsEnabled(userId, enabled) {
  const key = browserNotificationPreferenceKey(userId)
  if (!key) return
  try {
    localStorage.setItem(key, JSON.stringify({ enabled: Boolean(enabled) }))
  } catch (error) {
    console.error('Failed to save browser notification preference:', error)
  }
}

export async function requestBrowserNotificationPermission() {
  if (!browserNotificationsSupported()) return 'unsupported'
  if (globalThis.Notification.permission !== 'default') return globalThis.Notification.permission
  return globalThis.Notification.requestPermission()
}

export function showNewEmailNotification(message) {
  if (!message || !browserNotificationsSupported()) return null
  try {
    const notification = new globalThis.Notification(
      `New email from ${message.sender || 'Unknown sender'}`,
      {
        body: message.subject || '(No subject)',
        icon: '/icons/icon-192.png',
        tag: `cookie-email-${message.id}`,
      },
    )
    notification.onclick = () => {
      globalThis.window?.focus()
      notification.close()
    }
    return notification
  } catch (error) {
    console.error('Failed to show browser notification:', error)
    return null
  }
}
