// The bucket: a short-lived collection of emails, documents, tasks and
// calendar events pinned from wherever they are open, kept in this browser.
//
// Each item records only what the panel needs to show it and open it again
// (a kind, the id and a few display fields), never the content itself. One
// bucket per account, each under its own localStorage key so accounts sharing
// a browser keep their own; it clears itself three days after it was made
// unless the panel's "Clears in" control says otherwise.

const STORAGE_PREFIX = 'cookie.bucket.'

export function bucketStorageKey(owner) {
  return `${STORAGE_PREFIX}${owner}`
}

export const BUCKET_KINDS = ['email', 'document', 'task', 'event']

export const BUCKET_DEFAULT_ICON = 'ms:work'

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

export const BUCKET_DEFAULT_TTL_MS = 3 * DAY_MS

// The "Clears in" control's choices, each measured from the moment it is
// picked.
export const BUCKET_TTL_CHOICES = [
  { id: 'day', label: '1 day', ms: DAY_MS },
  { id: 'three-days', label: '3 days', ms: 3 * DAY_MS },
  { id: 'week', label: '1 week', ms: 7 * DAY_MS },
]

const KIND_ICONS = {
  email: 'mail',
  document: 'description',
  task: 'task_alt',
  event: 'calendar_month',
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

export function bucketItemKey(item) {
  return `${item.kind}:${item.id}`
}

export function bucketItemIcon(kind) {
  return KIND_ICONS[kind] ?? 'bookmark'
}

// --- Items from what each app has open ---

// `folder` is the inbox's ?filter= the email was open in (sent, done, a
// label...), blank for the inbox itself. The reader can only open an email
// its lists hold, so the item routes back to that folder to load it.
export function emailBucketItem(email, { folder = '', label = '' } = {}) {
  if (!email?.id) return null
  const inFolder = String(folder ?? '')
  return {
    kind: 'email',
    id: String(email.id),
    title: String(email.subject ?? '').trim() || '(no subject)',
    meta: {
      sender: String(email.sender ?? ''),
      sentAt: String(email.sentAt ?? ''),
      folder: inFolder,
      label: inFolder === 'label' ? String(label ?? '') : '',
    },
  }
}

export function documentBucketItem(doc) {
  if (!doc?.id) return null
  return {
    kind: 'document',
    id: String(doc.id),
    title: String(doc.title ?? '').trim() || 'Untitled',
    meta: { updatedAt: String(doc.updated_at ?? '') },
  }
}

export function taskBucketItem(task, projectName) {
  if (!task?.id) return null
  return {
    kind: 'task',
    id: String(task.id),
    title: String(task.content ?? '').trim() || 'Untitled task',
    meta: {
      projectId: task.projectId ? String(task.projectId) : null,
      projectName: String(projectName ?? 'Inbox'),
      dueDate: DATE_KEY.test(String(task.dueDate ?? '')) ? task.dueDate : null,
    },
  }
}

export function eventBucketItem(event) {
  if (!event?.id || !DATE_KEY.test(String(event.date ?? ''))) return null
  return {
    kind: 'event',
    id: String(event.id),
    title: String(event.title ?? '').trim() || 'Untitled event',
    meta: {
      date: event.date,
      start: String(event.start ?? ''),
      duration: Number.isFinite(event.duration) ? event.duration : 0,
      allDay: Boolean(event.allDay),
    },
  }
}

// --- Opening an item again ---

export function bucketItemRoute(item) {
  switch (item.kind) {
    case 'email': {
      const query = {}
      if (item.meta?.folder) query.filter = item.meta.folder
      if (item.meta?.folder === 'label' && item.meta.label) query.label = item.meta.label
      query.open = item.id
      return { path: '/inbox', query }
    }
    case 'document':
      return { path: `/documents/${encodeURIComponent(item.id)}` }
    case 'task':
      return {
        path: '/tasks',
        query: { project: item.meta?.projectId ?? 'inbox', task: item.id },
      }
    case 'event':
      return { path: '/calendar', query: { date: item.meta?.date, event: item.id } }
    default:
      return { path: '/' }
  }
}

// --- Second lines ---

// Fixed locale, as the inbox list's own date column is.
const TIME_FMT = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' })
const DAY_FMT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' })
const WEEKDAY_FMT = new Intl.DateTimeFormat('en-GB', { weekday: 'short' })

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function localDate(key) {
  return DATE_KEY.test(String(key ?? '')) ? new Date(`${key}T12:00:00`) : null
}

// "09:42" today, "25 Jul" before that; the inbox list uses the same split.
function formatMoment(iso, now) {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  return at >= startOfDay(now) ? TIME_FMT.format(at) : DAY_FMT.format(at)
}

function formatRelative(iso, now) {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  const elapsed = now.getTime() - at.getTime()
  if (elapsed < MINUTE_MS) return 'just now'
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)} min ago`
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)}h ago`
  const days = Math.floor(elapsed / DAY_MS)
  return days < 7 ? `${days} day${days === 1 ? '' : 's'} ago` : DAY_FMT.format(at)
}

// "today", "tomorrow", a weekday within the week, else "25 Jul".
function formatDay(key, now) {
  const day = localDate(key)
  if (!day) return ''
  const diff = Math.round((startOfDay(day) - startOfDay(now)) / DAY_MS)
  if (diff === 0) return 'today'
  if (diff === 1) return 'tomorrow'
  if (diff === -1) return 'yesterday'
  if (diff > 1 && diff < 7) return WEEKDAY_FMT.format(day)
  return DAY_FMT.format(day)
}

function endTime(start, duration) {
  const [hours, minutes] = String(start).split(':').map(Number)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return ''
  const total = Math.min(hours * 60 + minutes + duration, 24 * 60 - 1)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

export function bucketItemSubtitle(item, now = new Date()) {
  const meta = item.meta ?? {}
  switch (item.kind) {
    case 'email':
      return [meta.sender, formatMoment(meta.sentAt, now)].filter(Boolean).join(' · ')
    case 'document': {
      const edited = formatRelative(meta.updatedAt, now)
      return edited ? `Documents · edited ${edited}` : 'Documents'
    }
    case 'task': {
      const due = formatDay(meta.dueDate, now)
      return [meta.projectName, due && `due ${due}`].filter(Boolean).join(' · ')
    }
    case 'event': {
      const day = formatDay(meta.date, now)
      if (meta.allDay || !meta.start) return [day, 'all day'].filter(Boolean).join(' · ')
      const end = endTime(meta.start, meta.duration)
      return `${day} ${meta.start}${end ? `-${end}` : ''}`.trim()
    }
    default:
      return ''
  }
}

// "Clears in 3 days", "Clears in 5 hours", "Clears in 20 min".
export function bucketExpiryLabel(expiresAt, now = Date.now()) {
  const remaining = Number(expiresAt) - now
  if (!(remaining > 0)) return 'Clears now'
  if (remaining < HOUR_MS) return `Clears in ${Math.max(1, Math.ceil(remaining / MINUTE_MS))} min`
  if (remaining < DAY_MS) {
    const hours = Math.max(1, Math.round(remaining / HOUR_MS))
    return `Clears in ${hours} hour${hours === 1 ? '' : 's'}`
  }
  const days = Math.max(1, Math.round(remaining / DAY_MS))
  return `Clears in ${days} day${days === 1 ? '' : 's'}`
}

// --- Storage ---

function parsedItem(raw) {
  const kind = String(raw?.kind ?? '')
  const id = String(raw?.id ?? '')
  if (!BUCKET_KINDS.includes(kind) || !id) return null
  const meta = raw.meta && !Array.isArray(raw.meta) ? raw.meta : {}
  return { kind, id, title: String(raw.title ?? ''), meta: { ...meta } }
}

// Anything that does not read as a bucket for this account is dropped here.
export function parseBucket(raw, owner) {
  if (!raw || Array.isArray(raw) || !owner || raw.owner !== owner) return null
  const createdAt = Number(raw.createdAt)
  const expiresAt = Number(raw.expiresAt)
  if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt)) return null
  const seen = new Set()
  const items = []
  for (const entry of Array.isArray(raw.items) ? raw.items : []) {
    const item = parsedItem(entry)
    if (!item || seen.has(bucketItemKey(item))) continue
    seen.add(bucketItemKey(item))
    items.push(item)
  }
  return {
    owner,
    title: String(raw.title ?? ''),
    icon: String(raw.icon ?? '') || BUCKET_DEFAULT_ICON,
    createdAt,
    expiresAt,
    items,
  }
}

export function readBucket(owner) {
  if (!owner) return null
  try {
    const raw = globalThis.localStorage?.getItem(bucketStorageKey(owner))
    return raw ? parseBucket(JSON.parse(raw), owner) : null
  } catch {
    return null
  }
}

export function writeBucket(bucket) {
  if (!bucket?.owner) return
  try {
    globalThis.localStorage?.setItem(bucketStorageKey(bucket.owner), JSON.stringify(bucket))
  } catch {
    // Private mode or a full quota: the bucket still works for this session.
  }
}

export function removeBucket(owner) {
  if (!owner) return
  try {
    globalThis.localStorage?.removeItem(bucketStorageKey(owner))
  } catch {
    // As above.
  }
}
