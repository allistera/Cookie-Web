import { htmlToText } from './composeHtml'

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

function promptBody(text, html) {
  const plain = String(text ?? '').trim() || htmlToText(html)
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
