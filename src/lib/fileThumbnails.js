// Object URLs for the image thumbnails in the Documents folder browser. The
// content route needs the bearer header, so bytes are fetched and shown
// through an object URL; this cache keeps those URLs per file so leaving and
// re-entering a folder never refetches, and bounds how many stay alive since
// each holds the full upload in memory. Pure apart from the URL factory,
// which is injected so the eviction rules can be tested without a DOM.

import { isPreviewable } from './documentFiles'

export const MAX_CACHED_THUMBNAILS = 40

// Only the sniffed image types: the Worker serves nothing else inline, and
// the browser should not render a file the server would not.
export function hasThumbnail(mimeType) {
  const type = String(mimeType || '').toLowerCase()
  return type.startsWith('image/') && isPreviewable(type)
}

export function createThumbnailCache({
  createUrl = (blob) => URL.createObjectURL(blob),
  revokeUrl = (url) => URL.revokeObjectURL(url),
  limit = MAX_CACHED_THUMBNAILS,
} = {}) {
  // Map keeps insertion order, so re-inserting on a hit makes it an LRU.
  const urls = new Map()
  const pending = new Map()

  function get(id) {
    const url = urls.get(id)
    if (url === undefined) return undefined
    urls.delete(id)
    urls.set(id, url)
    return url
  }

  function set(id, blob) {
    remove(id)
    const url = createUrl(blob)
    urls.set(id, url)
    while (urls.size > limit) {
      const [oldest, oldestUrl] = urls.entries().next().value
      urls.delete(oldest)
      revokeUrl(oldestUrl)
    }
    return url
  }

  function remove(id) {
    const url = urls.get(id)
    if (url === undefined) return
    urls.delete(id)
    revokeUrl(url)
  }

  // Concurrent callers for one file (a card in the grid and, say, a
  // re-render) share a single fetch. A failed fetch is not cached, so the
  // next visible card tries again.
  function load(id, fetchBlob) {
    const cached = get(id)
    if (cached !== undefined) return Promise.resolve(cached)
    const inFlight = pending.get(id)
    if (inFlight) return inFlight
    const promise = Promise.resolve()
      .then(() => fetchBlob(id))
      .then((blob) => set(id, blob))
      .finally(() => pending.delete(id))
    pending.set(id, promise)
    return promise
  }

  function clear() {
    for (const url of urls.values()) revokeUrl(url)
    urls.clear()
    pending.clear()
  }

  return {
    get,
    set,
    remove,
    load,
    clear,
    get size() {
      return urls.size
    },
  }
}

export const thumbnailCache = createThumbnailCache()
