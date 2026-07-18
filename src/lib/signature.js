// Personal email signature (rich HTML), persisted locally like the other
// composer/appearance preferences. Appended to new emails and edited in the
// settings panel.
const SIGNATURE_KEY = 'cookie-signature-html'

export function getStoredSignature() {
  try {
    return localStorage.getItem(SIGNATURE_KEY) || ''
  } catch {
    return ''
  }
}

export function saveStoredSignature(html) {
  try {
    localStorage.setItem(SIGNATURE_KEY, html || '')
  } catch (error) {
    console.error('Failed to save signature:', error)
  }
}
