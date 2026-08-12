// Runs inside the sandboxed email-body iframe. This file lives in public/ so
// Vite serves it byte-for-byte in development: transforming it as a worker
// injects an ES-module import that cannot run in an opaque-origin srcdoc frame.
// Configuration and per-message identifiers travel as data attributes on
// <body>, allowing one cacheable bridge file to serve every open message.
const source = document.body.dataset.bridgeSource
const token = document.body.dataset.bridgeToken
const generation = document.body.dataset.bridgeGeneration
const hintPattern = new RegExp(document.body.dataset.bridgeHintSource, 'i')
const resizeInterval = Number(document.body.dataset.bridgeResizeInterval)
const send = (type, detail) => parent.postMessage({ source, token, type, ...detail }, '*')

let lastHeight = 0
let resizeTimer = null
let linksRevision = 0

const sendResize = () => {
  resizeTimer = null
  const height = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0)
  if (height === lastHeight) return
  lastHeight = height
  send('resize', { height })
}

const scheduleResize = () => {
  if (resizeTimer !== null) return
  resizeTimer = setTimeout(sendResize, resizeInterval)
}

const decodedForMatching = (value) => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

const collectLinkSnapshot = () => {
  const plausible = []
  for (const anchor of document.querySelectorAll('a[href]')) {
    const href = anchor.getAttribute('href') || ''
    if (!href || href.length > 4096) continue
    const imageAlt = Array.from(anchor.querySelectorAll('img[alt]'))
      .map((image) => image.getAttribute('alt') || '')
      .join(' ')
      .slice(0, 1000)
    const cheap = {
      href,
      text: (anchor.textContent || '').slice(0, 1000),
      ariaLabel: (anchor.getAttribute('aria-label') || '').slice(0, 1000),
      title: (anchor.getAttribute('title') || '').slice(0, 1000),
      imageAlt,
      context: (anchor.parentElement?.textContent || '').slice(0, 1000),
    }
    const haystack = [
      cheap.href,
      decodedForMatching(cheap.href),
      cheap.text,
      cheap.ariaLabel,
      cheap.title,
      cheap.imageAlt,
      cheap.context,
    ].join(' ')
    if (!hintPattern.test(haystack)) continue
    plausible.push({ anchor, cheap })
    if (plausible.length > 200) {
      send('unsubscribe-links', { generation, revision: ++linksRevision, candidates: [] })
      return
    }
  }

  const candidates = plausible.flatMap(({ anchor, cheap }) => {
    const style = getComputedStyle(anchor)
    const hiddenAncestor = anchor.closest('[hidden], [aria-hidden="true"]')
    if (
      hiddenAncestor ||
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      Number.parseFloat(style.opacity) === 0 ||
      anchor.getClientRects().length === 0
    ) {
      return []
    }
    return [{ ...cheap, text: (anchor.innerText || cheap.text).slice(0, 1000) }]
  })
  send('unsubscribe-links', { generation, revision: ++linksRevision, candidates })
}

const scheduleLinkSnapshot = () => requestAnimationFrame(collectLinkSnapshot)

addEventListener('keydown', (event) => {
  const target = event.target instanceof Element ? event.target : null
  if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
  if (
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    (event.key === 'd' || event.key === '/' || event.key === 'Escape')
  ) {
    event.preventDefault()
  }
  send('keydown', {
    key: event.key,
    code: event.code,
    repeat: event.repeat,
    metaKey: event.metaKey,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
  })
})

addEventListener('load', () => {
  sendResize()
  scheduleLinkSnapshot()
})

new ResizeObserver(scheduleResize).observe(document.documentElement)
sendResize()
scheduleLinkSnapshot()
