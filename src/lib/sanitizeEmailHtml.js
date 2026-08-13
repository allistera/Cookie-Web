import DOMPurify from 'dompurify'

// Layer 1 of the email-HTML defence-in-depth (layer 2 is the opaque-origin,
// CSP-restricted sandboxed <iframe> the reader renders this into). body_html
// is arbitrary, sender-controlled HTML — treat every byte as hostile.
//
// DOMPurify already, by default: strips <script>, all on* event-handler
// attributes, and href/src values whose scheme is not in its allow-list
// (javascript: and data: on <a href> are rejected). We additionally FORBID a
// set of tags that are either script/navigation vectors (iframe/object/embed/
// base/meta/link/form/input/map/area) so a future DOMPurify default change
// can't let them through, and we pin every surviving <a> to a safe new-tab
// target. Forbidding image maps prevents an <area> from navigating the iframe
// itself and escaping the initial document's CSP.

const CONFIG = {
  FORBID_TAGS: [
    'script',
    'iframe',
    'object',
    'embed',
    'form',
    'input',
    'textarea',
    'button',
    'select',
    'option',
    'map',
    'area',
    'base',
    'meta',
    'link',
  ],
  // on* handlers are already blocked by default; these close form-action and
  // nested-srcdoc vectors explicitly.
  FORBID_ATTR: ['formaction', 'srcdoc', 'ping'],
  ADD_ATTR: ['target'],
  ALLOW_DATA_ATTR: false,
  // Never allow full documents / <html> wrappers — we supply our own srcdoc.
  WHOLE_DOCUMENT: false,
}

let hookInstalled = false

function installLinkHook() {
  if (hookInstalled) return
  // Force every anchor that survives sanitization to open in a new,
  // disowned tab. rel=noopener noreferrer prevents reverse-tabnabbing and
  // referrer leakage; target=_blank keeps navigation out of the app frame.
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.nodeName && node.nodeName.toLowerCase() === 'a') {
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noopener noreferrer')
    }
  })
  hookInstalled = true
}

// Returns a sanitized HTML string safe to embed in the reader iframe's
// srcdoc. Empty string for empty / missing input.
export function sanitizeEmailHtml(dirty) {
  const html = String(dirty ?? '')
  if (html === '') return ''
  installLinkHook()
  return DOMPurify.sanitize(html, CONFIG)
}

// Whether this (already-sanitized) HTML references a remote image the
// reader's default img-src (data:/cid: only) will have blocked, so the
// "Show images" control only appears when there is actually something for
// it to unblock. Deliberately narrow to <img src> and CSS background-image/
// legacy background= (both governed by the img-src CSP directive) rather
// than any https?:// substring, so a plain link in the body text doesn't
// trigger a false positive.
const REMOTE_IMG_TAG_RE = /<img\b[^>]*\bsrc\s*=\s*["']?\s*https?:\/\//i
const REMOTE_BACKGROUND_URL_RE = /\burl\(\s*['"]?\s*https?:\/\//i
const REMOTE_BACKGROUND_ATTR_RE = /\bbackground\s*=\s*["']?\s*https?:\/\//i

export function hasBlockedRemoteImages(safeHtml) {
  const html = String(safeHtml ?? '')
  if (html === '') return false
  return (
    REMOTE_IMG_TAG_RE.test(html) ||
    REMOTE_BACKGROUND_URL_RE.test(html) ||
    REMOTE_BACKGROUND_ATTR_RE.test(html)
  )
}
