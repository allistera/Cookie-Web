import { sanitizeEmailHtml } from './sanitizeEmailHtml.js'

// Personal email signature (rich HTML), persisted locally like the other
// composer/appearance preferences. Appended to new emails and edited in the
// settings panel.
//
// The stored value is injected straight into the composer's contenteditable via
// innerHTML, so it is sanitized on the way in *and* on the way out — localStorage
// is not a trust boundary, and a value written by anything other than the
// settings editor must not become live markup. Same treatment as snippets.js.
const SIGNATURE_KEY = 'cookie-signature-html'

export function getStoredSignature() {
  try {
    return sanitizeEmailHtml(localStorage.getItem(SIGNATURE_KEY))
  } catch {
    return ''
  }
}

// Returns the sanitized signature that was actually stored, so callers can keep
// their in-memory copy identical to the persisted one.
export function saveStoredSignature(html) {
  const cleaned = sanitizeEmailHtml(html)
  try {
    localStorage.setItem(SIGNATURE_KEY, cleaned)
  } catch (error) {
    console.error('Failed to save signature:', error)
  }
  return cleaned
}
