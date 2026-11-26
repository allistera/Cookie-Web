// Tracking images (open pixels) are remote images a sender puts in a message
// so that the request for the image tells them when, where and on what the
// message was opened. The reader keeps remote images behind "Show images",
// but Important mail and mail from accepted senders load theirs at once, and
// a reader who presses the button loads them all, pixel included. This
// module takes the pixels out of the sanitized body before it reaches the
// frame, whatever the image rule says, and counts them for the notice.
//
// An image is treated as a tracker when it is remote (a cid: or data: image
// makes no request, so it can report nothing) and either
//
// - every size the sender declared for it is at most one pixel (width or
//   height attributes, inline width, height, max-width or max-height), with
//   at least one declared: nothing a reader is meant to see is drawn that
//   small, while a spacer 1 pixel wide and 20 tall is kept; or
// - its address carries one of the open-tracking paths the common mail
//   platforms use, for the pixels that declare no size.
//
// The same two rules apply wherever a message can name an image: an img's
// src and srcset candidates, a picture's source srcset, the legacy
// background attribute and an inline style's url(). A tracking img or
// source is removed; a tracking background attribute is removed and a
// tracking url() becomes none, so the table cell or block that carried it
// stays.
//
// Hidden images (display: none) are left alone: templates hide their mobile
// images that way and show them again from a media query.
const REMOTE_REFERENCE_RE =
  /\b(?:src|srcset|background)\s*=\s*["']?[^"'>]*https?:\/\/|\burl\(\s*["']?\s*https?:\/\//i
const REMOTE_URL_RE = /^\s*https?:\/\//i
const CSS_REMOTE_URL_RE = /url\(\s*(["']?)\s*(https?:\/\/[^"')]*?)\s*\1\s*\)/gi

// Open-tracking endpoints, matched against the lower-cased address. Hosts are
// included only where the path alone would be too short to be distinctive.
const TRACKER_URL_PATTERNS = [
  '/track/open', // Mailchimp, Mandrill and others
  '/wf/open', // SendGrid, Klaviyo
  'track.hubspot.com/__ptq.gif',
  'mailtrack.io/trace/',
  't.yesware.com/t/',
  'app.mixmax.com/api/track/',
  'mailfoogae.appspot.com/t?', // Streak
  'r.superhuman.com/',
  'pstmrk.it/open', // Postmark
  'getresponse.com/open.html',
  'rs6.net/on.jsp', // Constant Contact
  'open.convertkit-mail',
  'awstrack.me/i0/', // Amazon SES
  'sendibm.com/tr/op/', // Brevo
  '/open.aspx', // Salesforce Marketing Cloud
  'google-analytics.com/collect',
]

// A declared length in pixels, or null for anything else (percentages,
// keywords, nothing). Attributes take a bare number; inline styles end in px.
function pixels(value) {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(?:px)?\s*$/i.exec(String(value ?? ''))
  return match ? Number(match[1]) : null
}

function declaredSizes(img) {
  const style = img.style
  return [
    img.getAttribute('width'),
    img.getAttribute('height'),
    style.getPropertyValue('width'),
    style.getPropertyValue('height'),
    style.getPropertyValue('max-width'),
    style.getPropertyValue('max-height'),
  ]
    .map(pixels)
    .filter((size) => size !== null)
}

// The addresses in a srcset: each candidate is an address and an optional
// width or density descriptor, candidates separated by commas.
function srcsetUrls(value) {
  return String(value ?? '')
    .split(',')
    .map((candidate) => candidate.trim().split(/\s+/)[0])
    .filter(Boolean)
}

function isPixelSized(element) {
  const sizes = declaredSizes(element)
  return sizes.length > 0 && sizes.every((size) => size <= 1)
}

function isTrackerUrl(url) {
  const address = url.toLowerCase()
  return TRACKER_URL_PATTERNS.some((pattern) => address.includes(pattern))
}

// Whether any of these image addresses, drawn at the element's declared
// size, would report the open.
function tracks(element, urls) {
  const remote = urls.filter((url) => REMOTE_URL_RE.test(url))
  return remote.length > 0 && (isPixelSized(element) || remote.some(isTrackerUrl))
}

export function isTrackingImage(img) {
  return tracks(img, [img.getAttribute('src') ?? '', ...srcsetUrls(img.getAttribute('srcset'))])
}

// Turns each tracking url() in the element's inline style into none.
// Returns whether it changed anything.
function stripTrackingStyleUrls(element) {
  const style = element.getAttribute('style') ?? ''
  const pixel = isPixelSized(element)
  let stripped = false
  const next = style.replace(CSS_REMOTE_URL_RE, (whole, _quote, url) => {
    if (!pixel && !isTrackerUrl(url)) return whole
    stripped = true
    return 'none'
  })
  if (stripped) element.setAttribute('style', next)
  return stripped
}

// Removes tracking images from already-sanitized reader HTML. Returns the
// HTML to render and how many images were removed; the HTML is the input
// itself when nothing was.
export function stripTrackingImages(safeHtml) {
  const html = String(safeHtml ?? '')
  if (html === '' || !globalThis.DOMParser || !REMOTE_REFERENCE_RE.test(html)) {
    return { html, blocked: 0 }
  }
  // The leading <body> keeps a style sheet that opens the content (the reader
  // carries the sender's sheets to the front) out of <head>, which the
  // serialized body would otherwise lose.
  const doc = new DOMParser().parseFromString(`<body>${html}`, 'text/html')
  const body = doc.body
  let blocked = 0
  for (const img of body.querySelectorAll('img')) {
    if (!isTrackingImage(img)) continue
    img.remove()
    blocked++
  }
  for (const source of body.querySelectorAll('picture > source[srcset]')) {
    if (!tracks(source, srcsetUrls(source.getAttribute('srcset')))) continue
    source.remove()
    blocked++
  }
  for (const element of body.querySelectorAll('[background]')) {
    if (!tracks(element, [element.getAttribute('background')])) continue
    element.removeAttribute('background')
    blocked++
  }
  for (const element of body.querySelectorAll('[style]')) {
    if (stripTrackingStyleUrls(element)) blocked++
  }
  if (blocked === 0) return { html, blocked: 0 }
  return { html: body.innerHTML, blocked }
}
