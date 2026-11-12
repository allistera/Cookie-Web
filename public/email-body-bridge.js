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

// Dark theme only (the reader passes its panel colour as data-bridge-surface).
// The frame is transparent, so an email that hard-codes dark text without
// painting a background of its own would render dark-on-dark. Text that sits
// directly on the reader's panel and lacks contrast against it is recoloured;
// anything on a background the email painted itself is left as authored.
const MIN_TEXT_CONTRAST = 4.5
const SOLID_ALPHA = 0.5

const parseColor = (value) => {
  const parts = /^rgba?\(([^)]+)\)$/
    .exec(value || '')?.[1]
    .split(/[\s,/]+/)
    .map(Number)
  if (!parts || parts.length < 3 || parts.some(Number.isNaN)) return null
  return { rgb: parts.slice(0, 3), alpha: parts[3] ?? 1 }
}

const luminance = (rgb) => {
  const [r, g, b] = rgb.map((channel) => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const fixTextContrast = () => {
  const surface = parseColor(document.body.dataset.bridgeSurface)
  if (!surface) return
  const surfaceLuminance = luminance(surface.rgb)
  const { bridgeText, bridgeLink } = document.body.dataset

  const paintsBackground = new Map()
  const sitsOnSurface = (element) => {
    if (!element) return true
    const known = paintsBackground.get(element)
    if (known !== undefined) return known
    const style = getComputedStyle(element)
    const background = parseColor(style.backgroundColor)
    const painted =
      style.backgroundImage !== 'none' || !background || background.alpha >= SOLID_ALPHA
    const result = !painted && sitsOnSurface(element.parentElement)
    paintsBackground.set(element, result)
    return result
  }

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const elements = new Set()
  while (walker.nextNode()) {
    const parent = walker.currentNode.parentElement
    if (parent && walker.currentNode.nodeValue.trim() && !parent.closest('style, script')) {
      elements.add(parent)
    }
  }
  for (const element of elements) {
    const color = parseColor(getComputedStyle(element).color)
    if (!color || !sitsOnSurface(element)) continue
    const textLuminance = luminance(color.rgb)
    const contrast =
      (Math.max(textLuminance, surfaceLuminance) + 0.05) /
      (Math.min(textLuminance, surfaceLuminance) + 0.05)
    if (contrast >= MIN_TEXT_CONTRAST) continue
    element.style.setProperty('color', element.closest('a') ? bridgeLink : bridgeText, 'important')
  }
}

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
  fixTextContrast()
  sendResize()
  scheduleLinkSnapshot()
})

new ResizeObserver(scheduleResize).observe(document.documentElement)
fixTextContrast()
sendResize()
scheduleLinkSnapshot()
