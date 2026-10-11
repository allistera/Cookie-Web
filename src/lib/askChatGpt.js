// ChatGPT prefills its composer from the `prompt` query parameter without
// submitting, so the person can add their own question before sending. The
// parameter is undocumented but stable; the server rejects very long URLs, so
// the body is capped before encoding.
const CHATGPT_URL = 'https://chatgpt.com/'
export const MAX_PROMPT_BODY_CHARS = 6000
const TRUNCATED_NOTE = '[Email truncated]'

function promptDate(sentAt) {
  const date = new Date(sentAt)
  if (Number.isNaN(date.getTime())) return String(sentAt ?? '')
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function promptAddress(name, address) {
  const person = String(name ?? '').trim()
  const email = String(address ?? '').trim()
  if (!person) return email
  if (!email || person.toLowerCase() === email.toLowerCase()) return person
  return `${person} <${email}>`
}

function promptRecipients(list) {
  return (list ?? [])
    .map((entry) => promptAddress(entry?.name, entry?.address))
    .filter(Boolean)
    .join(', ')
}

// Block elements and <br> become line breaks so an HTML-only email keeps its
// paragraphs; textContent alone would run "<p>Yes</p><p>No</p>" into "YesNo".
// Other whitespace collapses the way a browser renders it, so pretty-printed
// markup does not leak its indentation into the prompt.
const BLOCK_SELECTOR =
  'p, div, li, tr, h1, h2, h3, h4, h5, h6, blockquote, pre, table, ul, ol, hr, section, article, header, footer'

export function htmlToPromptText(html) {
  if (!html) return ''
  const doc = new DOMParser().parseFromString(html, 'text/html')
  for (const node of doc.body.querySelectorAll('script, style, template')) node.remove()
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.parentElement?.closest('pre')) node.data = node.data.replace(/\s+/g, ' ')
  }
  for (const br of doc.body.querySelectorAll('br')) br.replaceWith('\n')
  for (const block of doc.body.querySelectorAll(BLOCK_SELECTOR)) {
    block.prepend('\n')
    block.append('\n')
  }
  return (doc.body.textContent || '')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function promptBody(text, html) {
  const plain = String(text ?? '').trim() || htmlToPromptText(html)
  const squeezed = plain.replace(/\n{3,}/g, '\n\n')
  if (squeezed.length <= MAX_PROMPT_BODY_CHARS) return squeezed
  return `${squeezed.slice(0, MAX_PROMPT_BODY_CHARS).trimEnd()}\n\n${TRUNCATED_NOTE}`
}

export function buildChatGptPrompt({ sender, address, subject, sentAt, recipients, text, html }) {
  const headers = [
    `From: ${promptAddress(sender, address)}`,
    `Date: ${promptDate(sentAt)}`,
    `Subject: ${String(subject ?? '')}`,
  ]
  const to = promptRecipients(recipients?.to)
  if (to) headers.push(`To: ${to}`)
  const cc = promptRecipients(recipients?.cc)
  if (cc) headers.push(`Cc: ${cc}`)
  return `Here is an email I received. Help me with it.\n\n${headers.join('\n')}\n\n${promptBody(text, html)}`
}

export function chatGptUrl(prompt) {
  const url = new URL(CHATGPT_URL)
  url.searchParams.set('prompt', prompt)
  return url.toString()
}
