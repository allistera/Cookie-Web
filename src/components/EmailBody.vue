<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { sanitizeEmailHtml } from '../lib/sanitizeEmailHtml'
import {
  BRIDGE_HINT_SOURCE,
  selectPlainTextUnsubscribeTarget,
  selectUnsubscribeTarget,
} from '../lib/unsubscribeContent'

const props = defineProps({
  // Raw, untrusted, sender-controlled body_html (null until fetched / absent).
  html: { type: String, default: null },
  // Plain-text body, always available from the inbox list. Rendered instantly
  // and used as the permanent fallback when there is no HTML body.
  text: { type: String, default: '' },
  // Decorative sign-off shown only in the text-fallback rendering, matching
  // the reader's previous look.
  sender: { type: String, default: '' },
  // Whether this message is known to have an HTML body (from the list
  // endpoint's cheap boolean), before its body_html has been fetched. Lets the
  // reader show a spinner during the fetch instead of flashing the text body.
  hasHtmlBody: { type: Boolean, default: false },
  // Whether the body fetch is currently in flight.
  loading: { type: Boolean, default: false },
  // True once the owned-message body request has resolved and header-derived
  // unsubscribe metadata is therefore known (including a confirmed null).
  bodyResolved: { type: Boolean, default: false },
})

const emit = defineEmits(['keydown', 'unsubscribe-link'])

// Hard cap on the iframe height so a hostile email can't force a multi-million
// pixel frame; taller bodies scroll inside the frame.
const MAX_FRAME_HEIGHT = 12000
const BRIDGE_SOURCE = 'cookie-email-body'
const RESIZE_INTERVAL_MS = 250
const SCRIPT_CLOSE = '</scr' + 'ipt>'

function randomToken() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

const frameRef = ref(null)
const frameHeight = ref(80)
const frameToken = randomToken()
const frameGeneration = ref(randomToken())
const scriptNonce = randomToken().replaceAll('-', '')
let lastResizeAt = Number.NEGATIVE_INFINITY
let pendingResizeHeight = null
let resizeTimer = null
let latestLinksRevision = 0

// Layer 1: sanitize. Empty string when there is no usable HTML body, which
// switches the template to the plain-text fallback.
const safeHtml = computed(() => sanitizeEmailHtml(props.html))
const hasHtml = computed(() => safeHtml.value.trim().length > 0)

watch(
  safeHtml,
  () => {
    frameGeneration.value = randomToken()
    latestLinksRevision = 0
    emit('unsubscribe-link', null)
  },
)

watch(
  () => [hasHtml.value, props.text, props.bodyResolved],
  ([htmlPresent, text, bodyResolved]) => {
    if (!bodyResolved || htmlPresent) return
    emit('unsubscribe-link', selectPlainTextUnsubscribeTarget(text))
  },
  { immediate: true },
)

// Show a spinner only while an HTML body is still being fetched: the message is
// known to have HTML, the fetch is in flight, and no usable sanitized HTML has
// arrived yet. Once the fetch settles (html present → iframe; html empty/absent
// → text fallback) the spinner never lingers.
const showSpinner = computed(() => !hasHtml.value && props.hasHtmlBody && props.loading)

const paragraphs = computed(() => (props.text || '').split('\n\n'))

function currentTheme() {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
}

// The iframe document. Its only dynamic input is the already-sanitized body;
// the surrounding chrome (doctype, base CSS) is a fixed string we control.
const srcdoc = computed(() => {
  if (!hasHtml.value) return ''
  const dark = currentTheme() === 'dark'
  const fg = dark ? '#e6e6e6' : '#1f1f1f'
  const link = dark ? '#7cc4ff' : '#2383e2'
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${scriptNonce}'; connect-src 'none'; img-src data: cid:; media-src data: cid:; object-src 'none'; base-uri 'none'; form-action 'none'; style-src 'unsafe-inline'; font-src data:">
<style>
:root { color-scheme: ${dark ? 'dark' : 'light'}; }
html, body { margin: 0; padding: 0; background: transparent; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  font-size: 14px; line-height: 1.55; color: ${fg};
  word-wrap: break-word; overflow-wrap: break-word;
}
img { max-width: 100%; height: auto; }
table { max-width: 100%; border-collapse: collapse; }
a { color: ${link}; }
</style></head><body>${safeHtml.value}
<script nonce="${scriptNonce}">
(() => {
  const source = ${JSON.stringify(BRIDGE_SOURCE)}
  const token = ${JSON.stringify(frameToken)}
  const generation = ${JSON.stringify(frameGeneration.value)}
  const hintPattern = new RegExp(${JSON.stringify(BRIDGE_HINT_SOURCE)}, 'i')
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
    resizeTimer = setTimeout(sendResize, ${RESIZE_INTERVAL_MS})
  }
  const decodedForMatching = (value) => {
    try { return decodeURIComponent(value) } catch { return value }
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
      !event.metaKey && !event.ctrlKey && !event.altKey &&
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
})()
${SCRIPT_CLOSE}</body></html>`
})

function applyFrameHeight(height) {
  pendingResizeHeight = null
  lastResizeAt = Date.now()
  if (frameHeight.value !== height) frameHeight.value = height
}

function scheduleFrameResize(height) {
  const nextHeight = Math.min(height + 8, MAX_FRAME_HEIGHT)
  const elapsed = Date.now() - lastResizeAt
  if (elapsed >= RESIZE_INTERVAL_MS) {
    applyFrameHeight(nextHeight)
    return
  }
  pendingResizeHeight = nextHeight
  if (resizeTimer !== null) return
  resizeTimer = setTimeout(() => {
    resizeTimer = null
    if (pendingResizeHeight !== null) applyFrameHeight(pendingResizeHeight)
  }, RESIZE_INTERVAL_MS - elapsed)
}

function onFrameMessage(event) {
  const frame = frameRef.value
  const data = event.data
  if (
    !frame ||
    event.source !== frame.contentWindow ||
    data?.source !== BRIDGE_SOURCE ||
    data?.token !== frameToken
  ) {
    return
  }
  if (data.type === 'resize' && Number.isFinite(data.height) && data.height > 0) {
    scheduleFrameResize(data.height)
    return
  }
  if (
    data.type === 'unsubscribe-links' &&
    data.generation === frameGeneration.value &&
    Number.isInteger(data.revision) &&
    data.revision > latestLinksRevision
  ) {
    latestLinksRevision = data.revision
    emit('unsubscribe-link', selectUnsubscribeTarget(data.candidates))
    return
  }
  if (data.type === 'keydown' && typeof data.key === 'string') {
    emit(
      'keydown',
      new KeyboardEvent('keydown', {
        key: data.key,
        code: typeof data.code === 'string' ? data.code : '',
        repeat: Boolean(data.repeat),
        metaKey: Boolean(data.metaKey),
        ctrlKey: Boolean(data.ctrlKey),
        altKey: Boolean(data.altKey),
        shiftKey: Boolean(data.shiftKey),
        bubbles: true,
        cancelable: true,
      }),
    )
  }
}

onMounted(() => window.addEventListener('message', onFrameMessage))
onBeforeUnmount(() => {
  window.removeEventListener('message', onFrameMessage)
  if (resizeTimer !== null) clearTimeout(resizeTimer)
})
</script>

<template>
  <iframe
    v-if="hasHtml"
    ref="frameRef"
    class="ni-email-frame"
    title="Email content"
    sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
    referrerpolicy="no-referrer"
    :data-bridge-token="frameToken"
    :data-bridge-generation="frameGeneration"
    :srcdoc="srcdoc"
    :style="{ height: frameHeight + 'px' }"
  />
  <div
    v-else-if="showSpinner"
    class="ni-email-loading"
    role="status"
    aria-label="Loading email"
  >
    <div class="spinner ni-email-spinner"></div>
  </div>
  <div v-else class="ni-email-body">
    <p v-for="(paragraph, i) in paragraphs" :key="i">{{ paragraph }}</p>
    <p class="ni-email-signoff">Kind regards,<br />{{ sender }}</p>
  </div>
</template>

<style scoped>
.ni-email-frame {
  display: block;
  width: 100%;
  border: 0;
  background: transparent;
}

/* Reuses the app's global .spinner (main.css) for visual consistency, sized
   down and centred for the reading panel. */
.ni-email-loading {
  display: flex;
  justify-content: center;
  padding: 32px 0;
}

.ni-email-spinner {
  width: 28px;
  height: 28px;
  border-width: 3px;
  margin-bottom: 0;
}
</style>
