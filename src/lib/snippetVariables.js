import { parseRecipients } from './recipients'
import { sanitizeEmailHtml } from './sanitizeEmailHtml'

// Only these explicit namespaces have meaning. Legacy snippets and other
// brace-containing text remain literal, including unknown {{tokens}}.
const TOKEN_RE =
  /\{\{(recipient\.(?:first_name|name|email)|fill:([A-Za-z][A-Za-z0-9 _-]{0,49}))\}\}/g
const RECIPIENT_LABELS = {
  'recipient.first_name': 'Recipient first name',
  'recipient.name': 'Recipient name',
  'recipient.email': 'Recipient email',
}

export function snippetFields(html) {
  const seen = new Set()
  const fields = []
  for (const match of String(html ?? '').matchAll(TOKEN_RE)) {
    const key = match[1]
    if (seen.has(key)) continue
    seen.add(key)
    fields.push({ key, label: match[2] || RECIPIENT_LABELS[key], token: match[0] })
  }
  return fields
}

export function unresolvedSnippetFields(html, text = '') {
  return snippetFields(`${html ?? ''} ${text ?? ''}`)
}

export function unresolvedSnippetWarning(fields) {
  return `Fill or remove unresolved snippet fields before sending: ${fields.map((field) => field.label).join(', ')}.`
}

// The compose address field contains only addresses. A contact name is safe
// to use only when it belongs to the one selected address without conflict.
export function snippetRecipientValues(addresses, candidates = []) {
  const selected = parseRecipients(addresses)
  if (selected.length !== 1 || !selected[0].includes('@')) return {}

  const email = selected[0]
  const names = new Set(
    (Array.isArray(candidates) ? candidates : [])
      .filter(
        (candidate) =>
          String(candidate?.address ?? '')
            .trim()
            .toLowerCase() === email.toLowerCase(),
      )
      .map((candidate) => String(candidate.name ?? '').trim())
      .filter((name) => name && !name.includes('@')),
  )
  const name = names.size === 1 ? [...names][0] : ''
  return {
    'recipient.email': email,
    'recipient.name': name,
    'recipient.first_name': name ? name.split(/\s+/)[0] : '',
  }
}

export function renderSnippetPreview(html, values = {}) {
  const template = document.createElement('template')
  template.innerHTML = sanitizeEmailHtml(html)
  const unresolved = new Set()
  const replace = (value) =>
    value.replace(TOKEN_RE, (token, key) => {
      const replacement = String(values[key] ?? '').trim()
      if (replacement) return replacement
      unresolved.add(key)
      return token
    })

  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node) {
    node.textContent = replace(node.textContent)
    node = walker.nextNode()
  }
  for (const element of template.content.querySelectorAll('*')) {
    for (const attribute of element.attributes) {
      element.setAttribute(attribute.name, replace(attribute.value))
    }
  }

  return {
    html: sanitizeEmailHtml(template.innerHTML),
    unresolved: snippetFields(html).filter((field) => unresolved.has(field.key)),
  }
}
