import { escapeHtml, htmlToText, plainTextToHtml } from './composeHtml'
import { sanitizeForwardedEmailHtml } from './sanitizeEmailHtml'

export function forwardSubject(subject) {
  const value = String(subject ?? '').trim()
  return /^(?:fw|fwd):/i.test(value) ? value : `Fwd: ${value}`
}

function forwardDate(sentAt) {
  const date = new Date(sentAt)
  if (Number.isNaN(date.getTime())) return String(sentAt ?? '')
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function forwardFrom(sender, address) {
  const name = String(sender ?? '').trim()
  const email = String(address ?? '').trim()
  if (!name) return email
  if (!email || name.toLowerCase() === email.toLowerCase()) return name
  return `${name} <${email}>`
}

function quotePlainText(text) {
  return String(text ?? '')
    .split('\n')
    .map((line) => `> ${line}`.trimEnd())
    .join('\n')
}

export function buildForwardDraft({ sender, address, subject, sentAt, text, html }) {
  const from = forwardFrom(sender, address)
  const date = forwardDate(sentAt)
  const subjectText = String(subject ?? '')
  const originalText = String(text ?? '')
  const forwardedHeaders = [
    '---------- Forwarded message ----------',
    `From: ${from}`,
    `Date: ${date}`,
    `Subject: ${subjectText}`,
  ]
  const safeOriginalHtml = html ? sanitizeForwardedEmailHtml(html) : plainTextToHtml(originalText)
  const headerHtml = forwardedHeaders.map(escapeHtml).join('<br>')

  return {
    text: `\n\n${forwardedHeaders.join('\n')}\n\n${quotePlainText(originalText)}`,
    html: `<p><br></p><div class="forwarded-message"><p>${headerHtml}</p><blockquote>${safeOriginalHtml}</blockquote></div>`,
  }
}

// Replies quote the message they answer below the new text, the way mail
// clients do: an attribution line, then the original as a cited blockquote.
// The original usually carries its own quoted history, so the whole thread
// comes along. The wrapper class lets a reply that comes back for editing
// (a cancelled scheduled send) drop the quote again before it is re-sent.
const REPLY_QUOTE_CLASS = 'cookie-reply-quote'

export function buildReplyQuote({ sender, address, sentAt, text, html }) {
  const attribution = `On ${forwardDate(sentAt)}, ${forwardFrom(sender, address)} wrote:`
  const originalText = String(text ?? '') || htmlToText(html)
  const safeOriginalHtml = html ? sanitizeForwardedEmailHtml(html) : plainTextToHtml(originalText)
  return {
    text: `\n\n${attribution}\n${quotePlainText(originalText)}`,
    html:
      `<div class="${REPLY_QUOTE_CLASS}"><p>${escapeHtml(attribution)}</p>` +
      '<blockquote type="cite" style="margin:0 0 0 0.8ex;border-left:1px solid #ccc;padding-left:1ex">' +
      `${safeOriginalHtml}</blockquote></div>`,
  }
}

export function stripReplyQuote(html) {
  const value = String(html ?? '')
  if (!value.includes(REPLY_QUOTE_CLASS)) return value
  const doc = new DOMParser().parseFromString(value, 'text/html')
  for (const quote of doc.body.querySelectorAll(`.${REPLY_QUOTE_CLASS}`)) quote.remove()
  return doc.body.innerHTML
}
