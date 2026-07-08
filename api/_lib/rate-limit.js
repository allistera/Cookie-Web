// Fixed-window in-memory rate limiter. Per-instance state: Vercel's Fluid
// Compute reuses function instances across requests, so this is meaningful
// abuse damping (a tight retry loop or scripted client hits the same warm
// instance), but it is NOT a strict global quota — a cold start resets it.

const buckets = new Map()
const MAX_BUCKETS = 1000

export function allowRequest(key, { limit, windowMs }) {
  const now = Date.now()
  const bucket = buckets.get(key)
  if (!bucket || now - bucket.start >= windowMs) {
    if (buckets.size >= MAX_BUCKETS) {
      // Drop expired buckets before evicting anything live.
      for (const [k, b] of buckets) {
        if (now - b.start >= windowMs) buckets.delete(k)
      }
    }
    buckets.set(key, { start: now, count: 1 })
    return true
  }
  bucket.count += 1
  return bucket.count <= limit
}
