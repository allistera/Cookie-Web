import { escapeHtml, plainTextToHtml } from './composeHtml'
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
