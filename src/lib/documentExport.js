import DOMPurify from 'dompurify'

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function inline(value) {
  return DOMPurify.sanitize(String(value ?? ''), {
    ALLOWED_TAGS: ['b', 'strong', 'i', 'em', 'u', 's', 'del', 'code', 'a', 'br'],
    ALLOWED_ATTR: ['href'],
  })
}

function itemText(item) {
  return item?.content ?? item?.text ?? item ?? ''
}
function checked(item) {
  return item?.meta?.checked ?? item?.checked ?? false
}

function listMarkdown(items, style, depth = 0, start = 1) {
  return items
    .map((item, index) => {
      const prefix =
        style === 'ordered'
          ? `${start + index}.`
          : style === 'checklist'
            ? `- [${checked(item) ? 'x' : ' '}]`
            : '-'
      return (
        `${'    '.repeat(depth)}${prefix} ${inline(itemText(item))}\n` +
        listMarkdown(item?.items ?? [], style, depth + 1)
      )
    })
    .join('')
}

function listHTML(items, style, start = 1) {
  const tag = style === 'ordered' ? 'ol' : 'ul'
  return (
    `<${tag}${tag === 'ol' ? ` start="${start}"` : ''}>` +
    items
      .map(
        (item) =>
          `<li>${style === 'checklist' ? (checked(item) ? '☑ ' : '☐ ') : ''}${inline(itemText(item))}${item?.items?.length ? listHTML(item.items, style) : ''}</li>`,
      )
      .join('') +
    `</${tag}>`
  )
}

function tableSheets(data) {
  if (!data.workbook) {
    return [{ name: '', rows: Array.isArray(data.content) ? data.content : [] }]
  }
  const { sheets = {}, sheetOrder = Object.keys(sheets) } = data.workbook
  return sheetOrder.map((id) => {
    const sheet = sheets[id]
    if (!sheet) throw new Error('A spreadsheet sheet is missing from the document.')
    const cells = []
    for (const [r, row] of Object.entries(sheet.cellData ?? {})) {
      for (const [c, cell] of Object.entries(row ?? {})) {
        const value = cell?.v ?? cell?.p?.body?.dataStream?.trimEnd() ?? cell?.f ?? ''
        if (value !== '') cells.push([Number(r), Number(c), value])
      }
    }
    const height = Math.max(0, ...cells.map(([r]) => r + 1))
    const width = Math.max(0, ...cells.map(([, c]) => c + 1))
    if (
      !Number.isSafeInteger(height * width) ||
      height * width > 10000 ||
      cells.some(([r, c]) => r < 0 || c < 0 || !Number.isInteger(r) || !Number.isInteger(c))
    ) {
      throw new Error('This spreadsheet is too large to export; reduce its used range first.')
    }
    const rows = Array.from({ length: height }, () => Array(width).fill(''))
    for (const [r, c, value] of cells) rows[r][c] = escapeHtml(value)
    return { name: sheet.name ?? '', rows }
  })
}

function tablesMarkdown(data) {
  return tableSheets(data)
    .map(({ name, rows }) => {
      if (!rows.length) return name ? `### ${escapeHtml(name)}\n\n` : ''
      const width = Math.max(...rows.map((row) => row.length))
      const line = (row) =>
        `| ${Array.from({ length: width }, (_, i) => inline(row[i]).replaceAll('|', '&#124;').replaceAll('\n', '<br>')).join(' | ')} |\n`
      return (
        (name ? `### ${escapeHtml(name)}\n\n` : '') +
        line(rows[0]) +
        line(Array(width).fill('---')) +
        rows.slice(1).map(line).join('') +
        '\n'
      )
    })
    .join('')
}

function tablesHTML(data) {
  return tableSheets(data)
    .map(
      ({ name, rows }) =>
        (name ? `<h3>${escapeHtml(name)}</h3>` : '') +
        '<table>' +
        rows
          .map((row) => '<tr>' + row.map((cell) => `<td>${inline(cell)}</td>`).join('') + '</tr>')
          .join('') +
        '</table>',
    )
    .join('')
}

function imageURL(data) {
  const url = data.file?.url || data.url || ''
  if (!/^(https?:|data:image\/(png|jpeg|webp);base64,)/i.test(url))
    throw new Error('An image could not be exported.')
  return url
}

// Render saved scenes only when exporting; neither the drawing runtime nor
// the image conversion adds work to ordinary document loading.
export async function prepareExportBlocks(blocks) {
  return Promise.all(
    blocks.map(async (block) => {
      if (block.type !== 'excalidraw' || block.data.file?.url || block.data.url) return block
      if (!block.data.elements?.some((element) => !element.isDeleted)) return null
      const { exportToBlob } = await import('@excalidraw/excalidraw')
      const blob = await exportToBlob({
        elements: block.data.elements,
        files: block.data.files ?? {},
        appState: { ...block.data.appState, exportBackground: true },
        mimeType: 'image/png',
      })
      const url = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = () => reject(new Error('Could not render the drawing.'))
        reader.readAsDataURL(blob)
      })
      return { type: 'image', data: { file: { url }, caption: '' } }
    }),
  ).then((prepared) => prepared.filter(Boolean))
}

export function convertBlocksToMarkdown(blocks, title = '') {
  let markdown = title ? `# ${escapeHtml(title)}\n\n` : ''
  for (const { type, data } of blocks) {
    switch (type) {
      case 'header':
        markdown += `${'#'.repeat(Math.min(6, Math.max(1, data.level || 1)))} ${inline(data.text)}\n\n`
        break
      case 'paragraph':
        markdown += `${inline(data.text)}\n\n`
        break
      case 'list':
        markdown += listMarkdown(data.items ?? [], data.style, 0, data.meta?.start ?? 1) + '\n'
        break
      case 'code': {
        const runs = String(data.code ?? '').match(/`+/g) ?? []
        const fence = '`'.repeat(Math.max(3, ...runs.map((run) => run.length + 1)))
        markdown += `${fence}\n${data.code ?? ''}\n${fence}\n\n`
        break
      }
      case 'delimiter':
        markdown += '---\n\n'
        break
      case 'image':
      case 'excalidraw':
        markdown += `![${escapeHtml(data.caption).replaceAll(']', '&#93;')}](${imageURL(data).replaceAll(')', '%29')})\n\n`
        break
      case 'table':
        markdown += tablesMarkdown(data)
        break
      case 'kanban':
        markdown += (data.lanes ?? [])
          .map(
            (lane) =>
              `### ${escapeHtml(lane.title)}\n\n` +
              (lane.tasks ?? [])
                .map(
                  (task) =>
                    `- **${escapeHtml(task.title)}**${task.description ? `: ${escapeHtml(task.description)}` : ''}\n`,
                )
                .join('') +
              '\n',
          )
          .join('')
        break
      default:
        throw new Error(`The ${type} block cannot be exported.`)
    }
  }
  return markdown
}

export function convertBlocksToHTML(blocks, title = '') {
  let html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(title) || 'Document'}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      max-width: 800px;
      margin: 0 auto;
      padding: 40px;
      line-height: 1.6;
      color: #333;
    }
    h1, h2, h3 {
      margin-top: 1.5em;
      margin-bottom: 0.5em;
      line-height: 1.2;
    }
    h1 { font-size: 2em; }
    h2 { font-size: 1.5em; }
    h3 { font-size: 1.25em; }
    p { margin-bottom: 1em; }
    ul, ol { margin-bottom: 1em; padding-left: 2em; }
    code {
      background: #f4f4f4;
      padding: 0.2em 0.4em;
      border-radius: 3px;
      font-family: monospace;
    }
    pre {
      background: #f4f4f4;
      padding: 1em;
      border-radius: 6px;
      overflow-x: auto;
    }
    pre code {
      background: none;
      padding: 0;
    }
    img {
      max-width: 100%;
      height: auto;
      display: block;
      margin: 1em 0;
    }
    hr {
      border: none;
      border-top: 1px solid #ddd;
      margin: 2em 0;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 1em;
    }
    table td, table th {
      border: 1px solid #ddd;
      padding: 8px;
      text-align: left;
    }
  </style>
</head>
<body>
  ${title ? `<h1>${escapeHtml(title)}</h1>` : ''}
`

  for (const { type, data } of blocks) {
    switch (type) {
      case 'header': {
        const level = Math.min(6, Math.max(1, data.level || 1))
        html += `<h${level}>${inline(data.text)}</h${level}>`
        break
      }
      case 'paragraph':
        html += `<p>${inline(data.text)}</p>`
        break
      case 'list':
        html += listHTML(data.items ?? [], data.style, data.meta?.start ?? 1)
        break
      case 'code':
        html += `<pre><code>${escapeHtml(data.code)}</code></pre>`
        break
      case 'delimiter':
        html += '<hr>'
        break
      case 'image':
      case 'excalidraw':
        html += `<img src="${escapeHtml(imageURL(data))}" alt="${escapeHtml(data.caption)}">${data.caption ? `<p>${escapeHtml(data.caption)}</p>` : ''}`
        break
      case 'table':
        html += tablesHTML(data)
        break
      case 'kanban':
        html += (data.lanes ?? [])
          .map(
            (lane) =>
              `<h3>${escapeHtml(lane.title)}</h3><ul>` +
              (lane.tasks ?? [])
                .map(
                  (task) =>
                    `<li><strong>${escapeHtml(task.title)}</strong>${task.description ? `<p>${escapeHtml(task.description)}</p>` : ''}</li>`,
                )
                .join('') +
              '</ul>',
          )
          .join('')
        break
      default:
        throw new Error(`The ${type} block cannot be exported.`)
    }
  }
  return html + '</body></html>'
}

/**
 * Generates and downloads a PDF from document content
 * @param {string} html - HTML content to convert to PDF
 * @param {string} filename - Output filename (without .pdf extension)
 */
export async function downloadPDF(html, filename = 'document') {
  const options = {
    margin: [10, 10, 10, 10],
    filename: `${filename}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
  }

  try {
    // Lazy-loaded: exports are rare, so paying for html2pdf (+html2canvas +
    // jsPDF, several hundred KB) on every document open is pure waste.
    const { default: html2pdf } = await import('html2pdf.js')
    await html2pdf().set(options).from(html).save()
  } catch (error) {
    console.error('PDF generation failed:', error)
    throw new Error('Failed to generate PDF', { cause: error })
  }
}

/**
 * Downloads a markdown file
 * @param {string} markdown - Markdown content
 * @param {string} filename - Output filename (without .md extension)
 */
export function downloadMarkdown(markdown, filename = 'document') {
  const blob = new Blob([markdown], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${filename}.md`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * Sanitizes filename by removing special characters
 * @param {string} filename - Original filename
 * @returns {string} Sanitized filename
 */
export function sanitizeFilename(filename) {
  return (
    filename
      .replace(/[<>:"/\\|?*]/g, '') // Remove invalid characters
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .substring(0, 100) // Limit length
      .trim() || 'document'
  )
}
