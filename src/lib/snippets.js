import { sanitizeEmailHtml } from './sanitizeEmailHtml.js'

const SNIPPETS_KEY = 'cookie-compose-snippets'
const RESERVED_NAMES = new Set([
  'generate',
  'heading',
  'bullet',
  'numbered',
  'bold',
  'quote',
  'divider',
])
const MAX_SNIPPETS = 50
const MAX_NAME_LENGTH = 50

export function normalizeSnippetName(value) {
  return (value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_NAME_LENGTH)
}

export function sanitizeStoredSnippets(value) {
  if (!Array.isArray(value)) return []
  const seenNames = new Set()
  const seenIds = new Set()
  const snippets = []
  for (const raw of value) {
    const id = String(raw?.id ?? '')
    const name = normalizeSnippetName(raw?.name)
    const html = sanitizeEmailHtml(raw?.html)
    if (!id || !name || !html || RESERVED_NAMES.has(name) || seenNames.has(name) || seenIds.has(id))
      continue
    seenNames.add(name)
    seenIds.add(id)
    snippets.push({ id, name, html })
    if (snippets.length === MAX_SNIPPETS) break
  }
  return snippets
}

// The unscoped key is a migration source only. Never use it as active state.
export function getLegacySnippets() {
  try {
    return sanitizeStoredSnippets(JSON.parse(localStorage.getItem(SNIPPETS_KEY) || '[]'))
  } catch {
    return []
  }
}

export function clearLegacySnippets() {
  try {
    localStorage.removeItem(SNIPPETS_KEY)
  } catch {
    // Storage may be disabled; the server save has still succeeded.
  }
}

export function getSlashSnippetCommands(snippets) {
  return sanitizeStoredSnippets(snippets).map((snippet) => ({
    id: `snippet:${snippet.id}`,
    type: 'snippet',
    title: snippet.name,
    hint: 'Snippet',
    icon: 'bookmark',
    keywords: snippet.name,
    html: snippet.html,
  }))
}

export function snippetNameIsReserved(name) {
  return RESERVED_NAMES.has(normalizeSnippetName(name))
}
