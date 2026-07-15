import { isSafeUnsubscribeUrl } from './isSafeUnsubscribeUrl'

export const BRIDGE_HINT_SOURCE = String.raw`unsub|\bopt(?:[\s_-]*out)\b|\bremove\b`

const BRIDGE_HINT_RE = new RegExp(BRIDGE_HINT_SOURCE, 'i')
const EXACT_LABEL_RE = /^(?:unsubscribe|opt[\s_-]*out)$/i
const LABEL_RE = /\bunsubscribe\b|\bopt[\s_-]*out\b/i
const MAX_HREF_LENGTH = 4096
const MAX_TEXT_LENGTH = 1000

function bounded(value, max = MAX_TEXT_LENGTH) {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

function decodedForMatching(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function bridgeCandidateIsPlausible(candidate) {
  const href = typeof candidate?.href === 'string' ? candidate.href : ''
  if (!href || href.length > MAX_HREF_LENGTH) return false
  const values = [
    href,
    decodedForMatching(href),
    bounded(candidate.text),
    bounded(candidate.ariaLabel),
    bounded(candidate.title),
    bounded(candidate.imageAlt),
    bounded(candidate.context),
  ]
  return BRIDGE_HINT_RE.test(values.join(' '))
}

function parseMailto(raw) {
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    return null
  }
  if (parsed.protocol !== 'mailto:' || parsed.pathname.includes(',') || parsed.pathname.includes(';')) {
    return null
  }
  const address = parsed.pathname.trim()
  if (/%|[\r\n]/.test(address) || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address)) {
    return null
  }
  const keys = [...parsed.searchParams.keys()]
  if (keys.length > 1 || keys.some((key) => key.toLowerCase() !== 'subject')) return null
  const subject = parsed.searchParams.get('subject')
  if (subject && (subject.length > 200 || /[\r\n]/.test(subject))) return null
  const href = `mailto:${address}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}`
  return { href, url: null, mailto: { address, subject: subject || null } }
}

function parseTarget(raw) {
  if (typeof raw !== 'string' || !raw || raw.length > MAX_HREF_LENGTH) return null
  const mailto = parseMailto(raw)
  if (mailto) return mailto
  if (!isSafeUnsubscribeUrl(raw)) return null
  try {
    const parsed = new URL(raw)
    return { href: parsed.href, url: parsed.href, mailto: null }
  } catch {
    return null
  }
}

function urlHasUnsubscribeSemantics(raw) {
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    return false
  }
  const parts = [decodedForMatching(parsed.pathname)]
  for (const [key, value] of parsed.searchParams) {
    parts.push(decodedForMatching(key), decodedForMatching(value))
  }
  return LABEL_RE.test(parts.join(' ')) || /\bunsub/i.test(parts.join(' '))
}

function rankCandidate(candidate) {
  const text = bounded(candidate.text).trim()
  if (EXACT_LABEL_RE.test(text)) return 6
  if (LABEL_RE.test(text)) return 5

  const accessible = [candidate.ariaLabel, candidate.title, candidate.imageAlt]
    .map((value) => bounded(value).trim())
    .filter(Boolean)
  if (accessible.some((value) => EXACT_LABEL_RE.test(value))) return 4
  if (accessible.some((value) => LABEL_RE.test(value))) return 3
  if (LABEL_RE.test(bounded(candidate.context))) return 2
  if (urlHasUnsubscribeSemantics(candidate.href)) return 1
  return 0
}

export function selectUnsubscribeTarget(candidates) {
  try {
    if (!Array.isArray(candidates)) return null
    const ranked = []
    for (const candidate of candidates.slice(0, 200)) {
      if (!bridgeCandidateIsPlausible(candidate)) continue
      const target = parseTarget(candidate.href)
      const rank = target ? rankCandidate(candidate) : 0
      if (rank) ranked.push({ rank, target })
    }
    if (!ranked.length) return null
    const bestRank = Math.max(...ranked.map(({ rank }) => rank))
    const best = ranked.filter(({ rank }) => rank === bestRank)
    const hrefs = new Set(best.map(({ target }) => target.href))
    if (hrefs.size !== 1) return null
    return { oneClick: false, ...best[0].target, source: 'content' }
  } catch {
    return null
  }
}

export function selectPlainTextUnsubscribeTarget(text) {
  if (typeof text !== 'string' || !text) return null
  try {
    const lines = text.slice(0, 512 * 1024).split(/\r?\n/)
    const candidates = []
    const targetRe = /(?:https:\/\/[^\s<>"']+|mailto:[^\s<>"']+)/gi
    for (const line of lines) {
      const matches = line.match(targetRe) || []
      if (!matches.length) continue
      const relevant = LABEL_RE.test(line) || matches.some(urlHasUnsubscribeSemantics)
      if (!relevant || matches.length !== 1) continue
      candidates.push({ href: matches[0].replace(/[),.;]+$/, ''), context: line })
    }
    return selectUnsubscribeTarget(candidates)
  } catch {
    return null
  }
}
