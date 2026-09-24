export const SAVED_VIEW_FOLDERS = [
  { value: 'all', label: 'All mail' },
  { value: 'inbox', label: 'Inbox' },
  { value: 'sent', label: 'Sent' },
  { value: 'spam', label: 'Spam' },
  { value: 'snoozed', label: 'Snoozed' },
  { value: 'done', label: 'Done' },
]

export function savedViewRoute(view) {
  return {
    name: 'search',
    query: {
      q: `${view.query} in:${view.folder}`,
      scope: 'mail',
      mode: 'keyword',
      view: view.id,
    },
  }
}

export function savedViewMatchesRoute(view, route) {
  if (!view || route.query.view !== view.id) return false
  const target = savedViewRoute(view).query
  return (
    route.query.q === target.q && route.query.scope === 'mail' && route.query.mode === 'keyword'
  )
}

// Ad-hoc search can contain in: directly. Move a recognized folder into the
// explicit selector when saving, leaving all other query text for validation.
export function savedViewDraftFromQuery(query) {
  const match = /(?:^|\s)in:(all|inbox|sent|spam|snoozed|done)(?=\s|$)/i.exec(query)
  return {
    query: match
      ? `${query.slice(0, match.index)} ${query.slice(match.index + match[0].length)}`.trim()
      : query.trim(),
    folder: match ? match[1].toLowerCase() : 'all',
  }
}
