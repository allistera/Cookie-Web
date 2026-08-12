<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { BRIDGE_SOURCE, RESIZE_INTERVAL_MS } from '../lib/emailBodyBridgeConstants'
import { hasBlockedRemoteImages, sanitizeEmailHtml } from '../lib/sanitizeEmailHtml'
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
const SCRIPT_CLOSE = '</scr' + 'ipt>'
const emailBodyBridgeUrl = '/email-body-bridge.js'

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

// Remote images are blocked by default (see the CSP in srcdoc below) so a
// sender's tracking pixel can't silently fire just by opening the message.
// The reader is remounted per message (v-key on openEmail.id), so this
// naturally resets to blocked for every new email rather than needing a watch.
const imagesAllowed = ref(false)
const remoteImagesBlocked = computed(
  () => !imagesAllowed.value && hasBlockedRemoteImages(safeHtml.value),
)

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
  // Widened only once the reader clicks "Show images" for this message.
  const imgSrc = imagesAllowed.value ? 'data: cid: https: http:' : 'data: cid:'
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${scriptNonce}'; connect-src 'none'; img-src ${imgSrc}; media-src data: cid:; object-src 'none'; base-uri 'none'; form-action 'none'; style-src 'unsafe-inline'; font-src data:">
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
</style></head><body data-bridge-source="${BRIDGE_SOURCE}" data-bridge-token="${frameToken}" data-bridge-generation="${frameGeneration.value}" data-bridge-hint-source="${BRIDGE_HINT_SOURCE}" data-bridge-resize-interval="${RESIZE_INTERVAL_MS}">${safeHtml.value}
<script nonce="${scriptNonce}" src="${emailBodyBridgeUrl}">${SCRIPT_CLOSE}</body></html>`
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
  <div v-if="remoteImagesBlocked" class="ni-email-images-notice">
    <span class="material-symbols-outlined" aria-hidden="true">visibility_off</span>
    <span>Images are hidden to protect your privacy.</span>
    <button type="button" class="btn btn-secondary" @click.stop="imagesAllowed = true">
      Show images
    </button>
  </div>
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

.ni-email-images-notice {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--bg-input);
  color: var(--text-secondary);
  font-size: 13px;
}

.ni-email-images-notice .material-symbols-outlined {
  font-size: 18px;
}

.ni-email-images-notice span:nth-child(2) {
  flex: 1;
}
</style>
