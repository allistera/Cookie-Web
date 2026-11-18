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

// The reader's frame also takes the style sheets from the sender's <head>
// (see carryDocumentStyling). FORCE_BODY keeps a <style> that opens the
// content: without it the parser files the element under <head>, which is not
// part of what DOMPurify returns.
const READER_CONFIG = { ...CONFIG, FORCE_BODY: true }

// A forwarded body is inserted into the live contenteditable composer rather
// than the reader's sandboxed iframe. Strip resources and presentation hooks
// that could track the user or escape the quote's visual boundaries.
const FORWARD_CONFIG = {
  ...CONFIG,
  FORBID_TAGS: [
    ...CONFIG.FORBID_TAGS,
    'style',
    'img',
    'picture',
    'source',
    'video',
    'audio',
    'svg',
    'math',
  ],
  FORBID_ATTR: [
    ...CONFIG.FORBID_ATTR,
    'style',
    'class',
    'id',
    'src',
    'srcset',
    'background',
    'poster',
  ],
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

// Sanitizing keeps only the contents of the sender's <body>, which loses two
// things the message needs to look as it was written.
//
// A page colour set on the body itself (inline style or legacy bgcolor):
// emails that paint their text white on a dark body would render as white on
// the reader's own light panel, so that background goes on a wrapper <div>.
//
// Style sheets in <head> (headSheets, the reader only): most marketing mail
// keeps every class rule there (hidden preheaders, column widths, which of
// the desktop and mobile images shows), so without them the reader shows the
// bare markup. They are moved to the front of the content. The HTML parser
// also files a <style> that opens a headless fragment under <head>, so those
// are carried the same way. A sheet restyles the whole document it lands in,
// which is why only the reader's sandboxed frame asks for them: content bound
// for the composer sits in the app's own page.
//
// Everything carried is part of the string DOMPurify sanitizes, so it is
// vetted exactly like the rest of the message and any other body attribute
// (event handlers included) is dropped. The wrapper is built with
// setAttribute so a quote in the value (a quoted font-family, say) is
// serialized escaped rather than ending the attribute early.
function carryDocumentStyling(html, headSheets) {
  if (!globalThis.DOMParser) return html
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const body = doc.body
  if (!body) return html
  const sheets = headSheets ? [...doc.querySelectorAll('head style')] : []
  const style = body.getAttribute('style')?.trim() ?? ''
  const bgcolor = body.getAttribute('bgcolor')?.trim() ?? ''
  const paintsBody = Boolean(style || bgcolor)
  if (sheets.length === 0 && !paintsBody) return html
  // Older templates and everything Outlook writes wrap the sheet in an HTML
  // comment. CSS ignores those delimiters, but DOMPurify drops a <style> whose
  // text looks like markup, so they come out first.
  const carriedSheets = sheets
    .map((sheet) => {
      sheet.textContent = sheet.textContent.replaceAll(/<!--|-->/g, '')
      return sheet.outerHTML
    })
    .join('')
  if (!paintsBody) return `${carriedSheets}${body.innerHTML}`
  const background = bgcolor ? `background-color: ${bgcolor};` : ''
  const separator = background && style ? ' ' : ''
  const wrapper = doc.createElement('div')
  wrapper.setAttribute('style', `${background}${separator}${style}`)
  wrapper.append(...body.childNodes)
  return `${carriedSheets}${wrapper.outerHTML}`
}

function sanitize(dirty, config, headSheets) {
  const html = String(dirty ?? '')
  if (html === '') return ''
  installLinkHook()
  return DOMPurify.sanitize(carryDocumentStyling(html, headSheets), config)
}

// Returns a sanitized HTML string safe to embed in the reader iframe's
// srcdoc, style sheets from the sender's <head> included. Empty string for
// empty / missing input. Only for that sandboxed frame: use sanitizeEmailHtml
// for anything that ends up in the app's own page.
export const sanitizeEmailHtmlForReader = (dirty) => sanitize(dirty, READER_CONFIG, true)

// Returns a sanitized HTML string for the composer (drafts, signatures,
// snippets, pasted content). Empty string for empty / missing input.
export const sanitizeEmailHtml = (dirty) => sanitize(dirty, CONFIG, false)

export function sanitizeForwardedEmailHtml(dirty) {
  const html = String(dirty ?? '')
  if (html === '') return ''
  installLinkHook()
  return DOMPurify.sanitize(html, FORWARD_CONFIG)
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
