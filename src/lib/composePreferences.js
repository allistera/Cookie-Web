import { sanitizeEmailHtml } from './sanitizeEmailHtml'
import { sanitizeStoredSnippets } from './snippets'

// Values from the API are untrusted HTML, just like the legacy browser keys.
// This also keeps the in-memory copy identical to what may enter the editor.
export function parseComposePreferences(value) {
  if (!value || !Number.isSafeInteger(value.revision) || value.revision < 0) {
    throw new Error('Invalid composer preferences response')
  }
  return {
    revision: value.revision,
    signatureHtml: sanitizeEmailHtml(value.signatureHtml),
    snippets: sanitizeStoredSnippets(value.snippets),
  }
}
