import { sanitizeEmailHtml } from './sanitizeEmailHtml.js'

// The old key was shared by every account using this browser. Read it only
// for the reviewed import in Settings; active signatures live on the server.
const SIGNATURE_KEY = 'cookie-signature-html'

export function getLegacySignature() {
  try {
    return sanitizeEmailHtml(localStorage.getItem(SIGNATURE_KEY))
  } catch {
    return ''
  }
}

export function clearLegacySignature() {
  try {
    localStorage.removeItem(SIGNATURE_KEY)
  } catch {
    // Storage may be disabled; the server save has still succeeded.
  }
}
