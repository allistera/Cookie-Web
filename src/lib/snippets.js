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
  const snippets = []
  for (const raw of value) {
    const id = String(raw?.id ?? '')
    const name = normalizeSnippetName(raw?.name)
    const html = sanitizeEmailHtml(raw?.html)
    if (!id || !name || !html || RESERVED_NAMES.has(name) || seenNames.has(name)) continue
    seenNames.add(name)
    snippets.push({ id, name, html })
    if (snippets.length === MAX_SNIPPETS) break
  }
  return snippets
}

export function getStoredSnippets() {
  try {
    return sanitizeStoredSnippets(JSON.parse(localStorage.getItem(SNIPPETS_KEY) || '[]'))
  } catch {
    return []
  }
}

export function saveStoredSnippets(snippets) {
  const cleaned = sanitizeStoredSnippets(snippets)
  try {
    localStorage.setItem(SNIPPETS_KEY, JSON.stringify(cleaned))
  } catch (error) {
    console.error('Failed to save snippets:', error)
  }
  return cleaned
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
