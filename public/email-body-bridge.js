// Runs inside the sandboxed email-body iframe. This file lives in public/ so
// Vite serves it byte-for-byte in development: transforming it as a worker
// injects an ES-module import that cannot run in an opaque-origin srcdoc frame.
// Configuration and per-message identifiers travel as data attributes on
// <body>, allowing one cacheable bridge file to serve every open message.
//
// Bridge revision: 2
// Browsers keep this file for a day (vercel.json). When it changes, bump the
// revision above and the ?v= on emailBodyBridgeUrl in
// src/components/EmailBody.vue together, so no reader runs a cached copy.
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
// directly on the reader's panel and lacks contrast against it is recoloured.
//
// On a background the email painted itself, text is left as authored, with
// one exception: text the email gave no colour at all. That text was written
// for a browser's black default but inherits the reader's light one, so on a
// pale background it takes the light theme's colours (data-bridge-ink) instead.
const MIN_TEXT_CONTRAST = 4.5
const SOLID_ALPHA = 0.5

const parseColor = (value) => {
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value || '')
  if (hex) return { rgb: hex.slice(1).map((pair) => Number.parseInt(pair, 16)), alpha: 1 }
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

const contrast = (one, other) => {
  const [lighter, darker] = [luminance(one), luminance(other)].sort((a, b) => b - a)
  return (lighter + 0.05) / (darker + 0.05)
}

const sameColor = (one, other) => one.every((channel, index) => channel === other[index])

const fixTextContrast = () => {
  const surface = parseColor(document.body.dataset.bridgeSurface)
  if (!surface) return
  const { bridgeText, bridgeLink, bridgeInk, bridgeInkLink } = document.body.dataset
  // The reader's own colours, each paired with its light-theme counterpart.
  const readerColors = [
    [parseColor(bridgeText), bridgeInk],
    [parseColor(bridgeLink), bridgeInkLink],
  ]

  // The solid colour behind an element's text: the reader's panel (the very
  // surface.rgb array, so callers can tell it apart) unless the email painted
  // one further in. Null behind an image or gradient, where it is unknown.
  const backdrops = new Map()
  const backdropOf = (element) => {
    if (!element) return surface.rgb
    if (backdrops.has(element)) return backdrops.get(element)
    const style = getComputedStyle(element)
    const background = parseColor(style.backgroundColor)
    let backdrop = null
    if (style.backgroundImage === 'none' && background) {
      backdrop =
        background.alpha >= SOLID_ALPHA ? background.rgb : backdropOf(element.parentElement)
    }
    backdrops.set(element, backdrop)
    return backdrop
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
    const backdrop = backdropOf(element)
    if (!color || !backdrop || contrast(color.rgb, backdrop) >= MIN_TEXT_CONTRAST) continue
    const replacement =
      backdrop === surface.rgb
        ? element.closest('a')
          ? bridgeLink
          : bridgeText
        : readerColors.find(([reader]) => reader && sameColor(color.rgb, reader.rgb))?.[1]
    if (replacement) element.style.setProperty('color', replacement, 'important')
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
