// Theme preference: 'light' | 'dark' | 'system'. 'system' follows the OS via
// prefers-color-scheme and tracks live changes. The resolved value ('light' or
// 'dark') is written to <html data-theme=…>, which the CSS variables in
// main.css — and EmailBody.vue's iframe theming — read. data-theme is never set
// to 'system'; it always holds a concrete resolved theme.

const THEME_KEY = 'cookie-theme'
export const THEME_OPTIONS = ['light', 'dark', 'system']
const DEFAULT_THEME = 'system'

function darkMediaQuery() {
  return globalThis.matchMedia?.('(prefers-color-scheme: dark)') ?? null
}

export function getStoredTheme() {
  try {
    const value = localStorage.getItem(THEME_KEY)
    return THEME_OPTIONS.includes(value) ? value : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

// Collapses a preference to the concrete theme to render: 'system' resolves
// against the OS, everything else is returned as-is.
export function resolveTheme(preference = getStoredTheme()) {
  if (preference === 'light' || preference === 'dark') return preference
  return darkMediaQuery()?.matches ? 'dark' : 'light'
}

export function applyResolvedTheme(preference = getStoredTheme()) {
  document.documentElement.setAttribute('data-theme', resolveTheme(preference))
}

export function setTheme(preference) {
  const value = THEME_OPTIONS.includes(preference) ? preference : DEFAULT_THEME
  try {
    localStorage.setItem(THEME_KEY, value)
  } catch (error) {
    console.error('Failed to save theme preference:', error)
  }
  applyResolvedTheme(value)
}

// Applies the stored theme and keeps 'system' in sync with the OS. Call once at
// boot, before mount, so the first paint already carries the right data-theme.
export function initTheme() {
  applyResolvedTheme()
  darkMediaQuery()?.addEventListener?.('change', () => {
    if (getStoredTheme() === 'system') applyResolvedTheme('system')
  })
}
