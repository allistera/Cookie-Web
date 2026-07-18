// Converts plain text (e.g. an AI-generated draft) into simple HTML for the
// rich composer: blank-line-separated blocks become paragraphs and single
// newlines become <br>. Text is HTML-escaped first so it can't inject markup.
export function escapeHtml(text) {
  return (text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function plainTextToHtml(text) {
  const trimmed = (text || '').trim()
  if (!trimmed) return ''
  return trimmed
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

// Extracts the plain-text content of an HTML fragment (e.g. to mirror the rich
// composer body into the required text field).
export function htmlToText(html) {
  if (!html) return ''
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return (doc.body.textContent || '').trim()
}
