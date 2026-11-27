const STORAGE_PREFIX = 'cookie.bucket.'

export function bucketStorageKey(owner) {
  return `${STORAGE_PREFIX}${owner}`
}

const BUCKET_KINDS = ['email', 'document', 'task', 'event']

export const BUCKET_DEFAULT_ICON = 'ms:work'

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

export const BUCKET_DEFAULT_TTL_MS = 3 * DAY_MS

export function bucketItemKey(item) {
  return `${item.kind}:${item.id}`
}

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
