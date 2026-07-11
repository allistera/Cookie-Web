import DOMPurify from 'dompurify'

// Layer 1 of the email-HTML defence-in-depth (layer 2 is the no-script
// sandboxed <iframe> the reader renders this into). body_html is arbitrary,
// sender-controlled HTML — treat every byte as hostile.
//
// DOMPurify already, by default: strips <script>, all on* event-handler
// attributes, and href/src values whose scheme is not in its allow-list
// (javascript: and data: on <a href> are rejected). We additionally FORBID a
// set of tags that are either script/navigation vectors (iframe/object/embed/
// base/meta/link/form/input) so a future DOMPurify default change can't let
// them through, and we pin every surviving <a> to a safe new-tab target.

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
// srcdoc. Empty string for empty / non-string input.
export function sanitizeEmailHtml(dirty) {
  if (typeof dirty !== 'string' || dirty === '') return ''
  installLinkHook()
  return DOMPurify.sanitize(dirty, CONFIG)
}
