const EXPANDED_FOLDERS_KEY = 'cookie-documents-expanded-folders'
const MAX_STORED_IDS = 500

export function sanitizeStoredFolderIds(value) {
  if (!Array.isArray(value)) return []
  const ids = []
  const seen = new Set()
  for (const raw of value) {
    const id = String(raw ?? '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
    if (ids.length === MAX_STORED_IDS) break
  }
  return ids
}

export function getStoredExpandedFolderIds() {
  try {
    return sanitizeStoredFolderIds(JSON.parse(localStorage.getItem(EXPANDED_FOLDERS_KEY) || '[]'))
  } catch {
    return []
  }
}

export function saveExpandedFolderIds(ids) {
  const cleaned = sanitizeStoredFolderIds(Array.from(ids))
  try {
    localStorage.setItem(EXPANDED_FOLDERS_KEY, JSON.stringify(cleaned))
  } catch (error) {
    console.error('Failed to save expanded folders:', error)
  }
  return cleaned
}
