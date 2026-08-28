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

export function getStoredExpandedIds(key) {
  try {
    return sanitizeStoredFolderIds(JSON.parse(localStorage.getItem(key) || '[]'))
  } catch {
    return []
  }
}

export function saveExpandedIds(key, ids) {
  const cleaned = sanitizeStoredFolderIds(Array.from(ids))
  try {
    localStorage.setItem(key, JSON.stringify(cleaned))
  } catch (error) {
    console.error('Failed to save expanded ids:', error)
  }
  return cleaned
}

export function getStoredExpandedFolderIds() {
  return getStoredExpandedIds(EXPANDED_FOLDERS_KEY)
}

export function saveExpandedFolderIds(ids) {
  return saveExpandedIds(EXPANDED_FOLDERS_KEY, ids)
}
