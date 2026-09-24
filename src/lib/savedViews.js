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
  let tokenStart = -1
  let quoted = false
  let match = null
  for (let index = 0; index <= query.length; index++) {
    const char = query[index]
    if (char === '"') quoted = !quoted
    if (index === query.length || (/\s/.test(char) && !quoted)) {
      if (tokenStart >= 0) {
        const folder = /^in:(all|inbox|sent|spam|snoozed|done)$/i.exec(
          query.slice(tokenStart, index),
        )
        if (folder) {
          match = { start: tokenStart, end: index, folder: folder[1].toLowerCase() }
          break
        }
        tokenStart = -1
      }
    } else if (tokenStart < 0) {
      tokenStart = index
    }
  }
  return {
    query: match
      ? [query.slice(0, match.start).trimEnd(), query.slice(match.end).trimStart()]
          .filter(Boolean)
          .join(' ')
      : query.trim(),
    folder: match?.folder ?? 'all',
  }
}

const MAX_VERIFIED_OFFSET = 999
const MAX_VERIFIED_PAGES = 50
const OFFSET_RE = /^(0|[1-9]\d*)$/

function validOffset(value) {
  return (
    value != null &&
    !Array.isArray(value) &&
    OFFSET_RE.test(value) &&
    Number.isSafeInteger(Number(value)) &&
    Number(value) <= MAX_VERIFIED_OFFSET
  )
}

// A bounded trail keeps cursor pages shareable and makes Previous independent
// of raw-hit gaps skipped by the Worker's verified pagination.
export function savedViewPageState(query) {
  const cursor = query.cursor
  const trail = query.trail
  if (cursor === undefined && trail === undefined) return { offset: 0, trail: [] }
  if (!validOffset(cursor)) return { offset: 0, trail: [] }
  if (trail === undefined) return { offset: Number(cursor), trail: [] }
  if (Array.isArray(trail) || !trail || String(trail).length > 200) {
    return { offset: 0, trail: [] }
  }
  const parts = String(trail).split(',')
  if (
    parts.length > MAX_VERIFIED_PAGES ||
    parts[0] !== '0' ||
    parts.some((part) => !validOffset(part))
  ) {
    return { offset: 0, trail: [] }
  }
  const offsets = parts.map(Number)
  if (offsets.some((offset, index) => offset >= (offsets[index + 1] ?? Number(cursor)))) {
    return { offset: 0, trail: [] }
  }
  return { offset: Number(cursor), trail: offsets }
}

export function savedViewNextPageQuery(query, nextOffset) {
  const { offset, trail } = savedViewPageState(query)
  if (
    !Number.isSafeInteger(nextOffset) ||
    nextOffset <= offset ||
    nextOffset > MAX_VERIFIED_OFFSET ||
    trail.length >= MAX_VERIFIED_PAGES
  ) {
    return null
  }
  const rest = { ...query }
  delete rest.page
  return { ...rest, cursor: String(nextOffset), trail: [...trail, offset].join(',') }
}

export function savedViewPreviousPageQuery(query) {
  const { trail } = savedViewPageState(query)
  if (!trail.length) return null
  const previousOffset = trail.at(-1)
  const previousTrail = trail.slice(0, -1)
  const rest = { ...query }
  delete rest.cursor
  delete rest.trail
  delete rest.page
  if (previousOffset) rest.cursor = String(previousOffset)
  if (previousTrail.length) rest.trail = previousTrail.join(',')
  return rest
}
