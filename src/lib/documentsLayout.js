// The browser's grid/list choice, remembered per browser like the sidebar's
// expanded folders.
const LAYOUT_KEY = 'cookie-documents-layout'
const LAYOUTS = new Set(['grid', 'list'])

export function getStoredLayout() {
  try {
    const value = localStorage.getItem(LAYOUT_KEY)
    return LAYOUTS.has(value) ? value : 'grid'
  } catch {
    return 'grid'
  }
}

export function saveLayout(layout) {
  if (!LAYOUTS.has(layout)) return
  try {
    localStorage.setItem(LAYOUT_KEY, layout)
  } catch (error) {
    console.error('Failed to save documents layout:', error)
  }
}
