<script setup>
import { computed, ref } from 'vue'

import { sanitizeEmailHtml } from '../lib/sanitizeEmailHtml'

const props = defineProps({
  // Raw, untrusted, sender-controlled body_html (null until fetched / absent).
  html: { type: String, default: null },
  // Plain-text body, always available from the inbox list. Rendered instantly
  // and used as the permanent fallback when there is no HTML body.
  text: { type: String, default: '' },
  // Decorative sign-off shown only in the text-fallback rendering, matching
  // the reader's previous look.
  sender: { type: String, default: '' },
})

// Hard cap on the iframe height so a hostile email can't force a multi-million
// pixel frame; taller bodies scroll inside the frame.
const MAX_FRAME_HEIGHT = 12000

const frameRef = ref(null)
const frameHeight = ref(80)

// Layer 1: sanitize. Empty string when there is no usable HTML body, which
// switches the template to the plain-text fallback.
const safeHtml = computed(() => sanitizeEmailHtml(props.html))
const hasHtml = computed(() => safeHtml.value.trim().length > 0)

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
</style></head><body>${safeHtml.value}</body></html>`
})

// Auto-size the frame to its content. Requires sandbox="allow-same-origin" so
// the parent may read the (same-origin) srcdoc document's height. This does
// NOT grant the frame any capability: without allow-scripts nothing inside can
// execute, so the two defence layers (sanitize + no-script sandbox) stay
// independent. If the read ever throws (opaque origin), we keep the last
// height and the frame scrolls internally.
function resizeFrame() {
  const frame = frameRef.value
  if (!frame) return
  try {
    const doc = frame.contentDocument
    const h = doc?.documentElement?.scrollHeight || doc?.body?.scrollHeight || 0
    if (h) frameHeight.value = Math.min(h + 8, MAX_FRAME_HEIGHT)
  } catch {
    /* opaque origin — leave height as-is; frame scrolls internally */
  }
}
</script>

<template>
  <iframe
    v-if="hasHtml"
    ref="frameRef"
    class="ni-email-frame"
    title="Email content"
    sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
    referrerpolicy="no-referrer"
    :srcdoc="srcdoc"
    :style="{ height: frameHeight + 'px' }"
    @load="resizeFrame"
  />
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
</style>
