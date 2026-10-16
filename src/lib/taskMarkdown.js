import DOMPurify from 'dompurify'

// A task description is plain text on the wire, read as a small markdown:
// headings, paragraphs, bullet and numbered lists, quotes, fenced code, and
// bold, italic, strikethrough, code spans and links inline. The panel renders
// it read-only and edits it in a textarea with a toolbar that writes the same
// syntax, so a description written anywhere else (Todoist, the API) reads the
// same way here and nothing is lost in a round trip.

const ALLOWED_TAGS = [
  'h1',
  'h2',
  'h3',
  'p',
  'br',
  'strong',
  'em',
  's',
  'code',
  'pre',
  'ul',
  'ol',
  'li',
  'blockquote',
  'a',
]

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Only web and mail links become anchors; anything else stays as the text
// that was typed. The text is already escaped, so the pattern sees
// `&quot;` where a quote was and never breaks out of the attribute.
function isSafeHref(href) {
  return /^(https?:\/\/|mailto:)/i.test(href)
}

// Code spans are lifted out before the other inline marks run, so a `*` or
// `_` inside code is left alone, and put back once they have.
function inline(escaped) {
  const spans = []
  let text = escaped.replace(/`([^`\n]+)`/g, (_match, code) => {
    spans.push(`<code>${code}</code>`)
    return `\uE000${spans.length - 1}\uE000`
  })
  text = text.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (match, label, href) =>
    isSafeHref(href)
      ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`
      : match,
  )
  text = text.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  text = text.replace(/~~([^~\n]+)~~/g, '<s>$1</s>')
  text = text.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
  text = text.replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>')
  return text.replace(/\uE000(\d+)\uE000/g, (_match, index) => spans[Number(index)])
}

const HEADING = /^(#{1,3})\s+(.*)$/
const BULLET = /^[-*]\s+(.*)$/
const NUMBERED = /^\d+[.)]\s+(.*)$/
const QUOTE = /^>\s?(.*)$/
const FENCE = /^```/

function blocks(text) {
  const lines = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
  const out = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    if (FENCE.test(line)) {
      const code = []
      index += 1
      while (index < lines.length && !FENCE.test(lines[index])) code.push(lines[index++])
      index += 1
      out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`)
      continue
    }
    if (!line.trim()) {
      index += 1
      continue
    }
    const heading = line.match(HEADING)
    if (heading) {
      out.push(`<h${heading[1].length}>${inline(escapeHtml(heading[2]))}</h${heading[1].length}>`)
      index += 1
      continue
    }
    const list = BULLET.test(line) ? 'ul' : NUMBERED.test(line) ? 'ol' : null
    if (list) {
      const pattern = list === 'ul' ? BULLET : NUMBERED
      const rows = []
      while (index < lines.length && pattern.test(lines[index])) {
        rows.push(`<li>${inline(escapeHtml(lines[index++].match(pattern)[1]))}</li>`)
      }
      out.push(`<${list}>${rows.join('')}</${list}>`)
      continue
    }
    if (QUOTE.test(line)) {
      const rows = []
      while (index < lines.length && QUOTE.test(lines[index])) {
        rows.push(inline(escapeHtml(lines[index++].match(QUOTE)[1])))
      }
      out.push(`<blockquote><p>${rows.join('<br>')}</p></blockquote>`)
      continue
    }
    const rows = []
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index])) {
      rows.push(inline(escapeHtml(lines[index++])))
    }
    out.push(`<p>${rows.join('<br>')}</p>`)
  }
  return out
}

function isBlockStart(line) {
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    BULLET.test(line) ||
    NUMBERED.test(line) ||
    QUOTE.test(line)
  )
}

// HTML for a description. Everything is escaped before any tag is added and
// the result still goes through DOMPurify, so a description can carry no
// markup of its own; '' for an empty one.
export function renderTaskMarkdown(text) {
  if (!String(text ?? '').trim()) return ''
  return DOMPurify.sanitize(blocks(text).join(''), {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ['href', 'target', 'rel'],
    ALLOW_DATA_ATTR: false,
  })
}

// Markdown marks the toolbar can apply, each as the text around a selection
// (`wrap`) or at the start of every selected line (`prefix`).
export const MARKDOWN_FORMATS = {
  heading: { prefix: '# ', label: 'Heading' },
  bold: { wrap: '**', label: 'Bold' },
  italic: { wrap: '*', label: 'Italic' },
  strike: { wrap: '~~', label: 'Strikethrough' },
  link: { label: 'Link' },
  code: { wrap: '`', label: 'Code' },
  bullet: { prefix: '- ', label: 'Bulleted list' },
  numbered: { prefix: '1. ', numbered: true, label: 'Numbered list' },
  quote: { prefix: '> ', label: 'Quote' },
}

const LINE_MARK = /^(#{1,3} |[-*] |\d+[.)] |> )/

// Applies a format to the selection [start, end) of `value` and says where
// the selection should sit afterwards, so the textarea can be updated and
// re-selected in one go. Wrapping marks toggle off when the selection is
// already wrapped; line marks replace whatever mark the line already has and
// toggle off when every selected line carries this one. A code format over
// several lines makes a fenced block rather than a span.
export function applyMarkdownFormat(value, start, end, format) {
  const text = String(value ?? '')
  const from = Math.max(0, Math.min(start, end))
  const to = Math.min(text.length, Math.max(start, end))
  const selected = text.slice(from, to)
  const spec = MARKDOWN_FORMATS[format]
  if (!spec) return { value: text, selectionStart: from, selectionEnd: to }

  if (format === 'link') {
    const label = selected || 'link text'
    const url = 'https://'
    const inserted = `[${label}](${url})`
    const urlStart = from + label.length + 3
    return {
      value: text.slice(0, from) + inserted + text.slice(to),
      selectionStart: urlStart,
      selectionEnd: urlStart + url.length,
    }
  }

  if (spec.wrap) {
    const mark = format === 'code' && selected.includes('\n') ? '\n```\n' : spec.wrap
    const before = text.slice(from - mark.length, from)
    const after = text.slice(to, to + mark.length)
    if (before === mark && after === mark) {
      return {
        value: text.slice(0, from - mark.length) + selected + text.slice(to + mark.length),
        selectionStart: from - mark.length,
        selectionEnd: to - mark.length,
      }
    }
    return {
      value: text.slice(0, from) + mark + selected + mark + text.slice(to),
      selectionStart: from + mark.length,
      selectionEnd: to + mark.length,
    }
  }

  // Line marks work on whole lines: the block runs from the start of the
  // first selected line to the end of the last one.
  const blockStart = text.lastIndexOf('\n', from - 1) + 1
  const lineEnd = text.indexOf('\n', to)
  const blockEnd = lineEnd === -1 ? text.length : lineEnd
  const lines = text.slice(blockStart, blockEnd).split('\n')
  const bare = lines.map((line) => line.replace(LINE_MARK, ''))
  const marked = (line, index) => (spec.numbered ? `${index + 1}. ` : spec.prefix) + line
  const already = lines.every((line, index) => line === marked(bare[index], index))
  const next = already ? bare : bare.map(marked)
  const block = next.join('\n')
  return {
    value: text.slice(0, blockStart) + block + text.slice(blockEnd),
    selectionStart: blockStart,
    selectionEnd: blockStart + block.length,
  }
}
