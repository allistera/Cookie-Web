import { DEFAULT_LABEL_COLOR } from './labelPalette'

// Mirrors the Worker's normalizeTaskLabels (taskMetadata.js): lowercase,
// trimmed, leading @ dropped, 1–40 characters, no whitespace, @ or #.
// Returns '' for anything the server would refuse, so callers never send
// a name that comes back as a 400.
const NAME_RE = /^[^\s@#]{1,40}$/

export function normalizeLabelName(value) {
  const name = String(value ?? '')
    .trim()
    .replace(/^@/, '')
    .toLowerCase()
  return NAME_RE.test(name) ? name : ''
}

// Text in the label's colour on a 12% tint of it — the treatment category
// pills already use.
export function labelChipStyle(color) {
  const resolved = color || DEFAULT_LABEL_COLOR
  return { color: resolved, backgroundColor: `${resolved}1f` }
}
