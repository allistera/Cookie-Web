// Web Badging API: badges the app icon (macOS Dock, Windows taskbar, Android
// home screen) once Cookie is installed as a PWA. A no-op in an ordinary
// browser tab, where there is no icon to badge.
function resolveNavigator(nav) {
  return nav ?? (typeof navigator === 'undefined' ? null : navigator)
}

export function appBadgeSupported(nav = resolveNavigator()) {
  return Boolean(nav && typeof nav.setAppBadge === 'function' && typeof nav.clearAppBadge === 'function')
}

export function setAppBadge(count, nav = resolveNavigator()) {
  if (!appBadgeSupported(nav)) return
  const safeCount = Number.isFinite(count) && count > 0 ? Math.trunc(count) : 0
  const request = safeCount > 0 ? nav.setAppBadge(safeCount) : nav.clearAppBadge()
  request?.catch?.((error) => console.error('Failed to update app badge:', error))
}

export function clearAppBadge(nav = resolveNavigator()) {
  if (!appBadgeSupported(nav)) return
  nav.clearAppBadge()?.catch?.((error) => console.error('Failed to clear app badge:', error))
}
