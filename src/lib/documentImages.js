import { TASKS_API_URL } from './apiWorkers'
import { authHeaders } from './authHeaders'

// Document images live in Cookie's private Blob store. A document keeps the
// permanent private URL; to show one, the tasks Worker issues a short-lived
// signed link for the caller's own image (GET /tasks/document-image).

const PRIVATE_BLOB_HOST = /\.private\.blob\.vercel-storage\.com$/i
// Ask for a new link this long before the current one expires.
const EXPIRY_MARGIN_MS = 60 * 1000

const signed = new Map()

export function isPrivateDocumentImage(url) {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && PRIVATE_BLOB_HOST.test(parsed.hostname)
  } catch {
    return false
  }
}

async function requestSignedUrl(url, getHeaders) {
  const headers = await getHeaders()
  const response = await fetch(
    `${TASKS_API_URL}/tasks/document-image?url=${encodeURIComponent(url)}`,
    { headers, cache: 'no-store' },
  )
  if (!response.ok) throw new Error(`GET document image responded ${response.status}`)
  const { url: signedUrl, expiresAt } = await response.json()
  return { url: signedUrl, expiresAt: Date.parse(expiresAt) }
}

/**
 * A URL that can be used as <img src> for a stored document image: the
 * image itself for ordinary URLs, a cached signed link for private ones.
 *
 * @param {string} url
 * @param {{ now?: () => number, getHeaders?: () => Promise<Record<string, string>> }} [options]
 */
export function resolveDocumentImageUrl(url, { now = Date.now, getHeaders = authHeaders } = {}) {
  if (!isPrivateDocumentImage(url)) return Promise.resolve(url)
  const cached = signed.get(url)
  if (cached && (!cached.expiresAt || cached.expiresAt - EXPIRY_MARGIN_MS > now())) {
    return cached.promise.then(({ url: signedUrl }) => signedUrl)
  }
  const entry = { expiresAt: 0, promise: null }
  entry.promise = requestSignedUrl(url, getHeaders).then(
    (result) => {
      entry.expiresAt = result.expiresAt
      return result
    },
    (error) => {
      // Let the next render retry rather than caching the failure.
      if (signed.get(url) === entry) signed.delete(url)
      throw error
    },
  )
  signed.set(url, entry)
  return entry.promise.then(({ url: signedUrl }) => signedUrl)
}

export function clearDocumentImageCache() {
  signed.clear()
}

/**
 * Wraps Editor.js's image tool so private images render through a signed
 * link while the block keeps saving the permanent private URL.
 *
 * The tool stores and shows an image through its `image` setter, which its
 * constructor also calls for saved blocks, so the override covers both a
 * reopened document and a fresh upload. It mirrors @editorjs/image's setter
 * (the file goes in this._data.file); the private-image test in
 * e2e/documents.spec.js exercises the real tool.
 *
 * @param {any} ImageTool
 * @param {(url: string) => Promise<string>} [resolve]
 */
export function withPrivateDocumentImages(
  ImageTool,
  resolve = (url) => resolveDocumentImageUrl(url),
) {
  return class PrivateDocumentImageTool extends ImageTool {
    set image(file) {
      this._data.file = file || { url: '' }
      const url = file?.url
      if (!url) return
      if (!isPrivateDocumentImage(url)) {
        this.ui.fillImage(url)
        return
      }
      // The signed <img> arrives after the block has rendered; mark the
      // container so Editor.js does not treat it as a content edit.
      const container = this.ui.nodes?.imageContainer
      if (container) container.dataset.mutationFree = 'true'
      resolve(url).then(
        (signedUrl) => this.ui.fillImage(signedUrl),
        (error) => console.error('Failed to load document image:', error),
      )
    }
  }
}
