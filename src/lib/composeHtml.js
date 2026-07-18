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
