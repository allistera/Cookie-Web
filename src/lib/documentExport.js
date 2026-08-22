/**
 * Escapes plain-text values interpolated into the export HTML. Rich
 * header/paragraph block content stays as-is (Editor.js stores intentional
 * inline markup there); everything else — code, tables, captions, URLs,
 * titles — is plain text and must not be able to inject markup.
 * @param {string} value
 * @returns {string}
 */
function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/**
 * Converts Editor.js blocks to markdown format
 * @param {Array} blocks - Editor.js blocks array
 * @param {string} title - Document title
 * @returns {string} Markdown formatted document
 */
export function convertBlocksToMarkdown(blocks, title = '') {
  let markdown = title ? `# ${title}\n\n` : ''

  for (const block of blocks) {
    switch (block.type) {
      case 'header': {
        const level = block.data.level || 1
        const headerText = block.data.text || ''
        markdown += `${'#'.repeat(level)} ${headerText}\n\n`
        break
      }

      case 'paragraph': {
        const paragraphText = block.data.text || ''
        markdown += `${paragraphText}\n\n`
        break
      }

      case 'list': {
        const items = block.data.items || []
        const style = block.data.style || 'unordered'

        for (const item of items) {
          if (style === 'ordered') {
            markdown += `1. ${item}\n`
          } else if (style === 'checklist') {
            const checked = item.checked ? '[x]' : '[ ]'
            markdown += `- ${checked} ${item.text}\n`
          } else {
            markdown += `- ${item}\n`
          }
        }
        markdown += '\n'
        break
      }

      case 'code': {
        const codeText = block.data.code || ''
        markdown += '```\n'
        markdown += `${codeText}\n`
        markdown += '```\n\n'
        break
      }

      case 'delimiter':
        markdown += '---\n\n'
        break

      case 'image': {
        const imageUrl = block.data.file?.url || block.data.url || ''
        const caption = block.data.caption || ''
        markdown += `![${caption}](${imageUrl})\n\n`
        break
      }

      case 'table':
        // Handle table blocks from UniverSheetTool
        if (block.data.content) {
          markdown += convertTableToMarkdown(block.data.content)
        }
        break

      case 'excalidraw': {
        // For Excalidraw drawings, add a placeholder with the image URL
        const excalidrawUrl = block.data.file?.url || block.data.url || ''
        markdown += `*Excalidraw drawing: ${excalidrawUrl}*\n\n`
        break
      }

      case 'kanban':
        // For Kanban boards, add a placeholder
        markdown += `*Kanban board*\n\n`
        break

      default:
        // Skip unknown block types
        break
    }
  }

  return markdown
}

/**
 * Converts table content to markdown format
 * @param {Object} tableData - Table data from UniverSheetTool
 * @returns {string} Markdown formatted table
 */
function convertTableToMarkdown(tableData) {
  // This is a simplified table conversion
  // You may need to adapt this based on your actual table data structure
  let markdown = ''

  if (tableData.rows && Array.isArray(tableData.rows)) {
    for (const row of tableData.rows) {
      if (row.cells && Array.isArray(row.cells)) {
        const cellTexts = row.cells.map((cell) => cell?.value || '')
        markdown += `| ${cellTexts.join(' | ')} |\n`
      }
    }
    markdown += '\n'
  }

  return markdown
}

/**
 * Converts Editor.js blocks to HTML for PDF generation
 * @param {Array} blocks - Editor.js blocks array
 * @param {string} title - Document title
 * @returns {string} HTML formatted document
 */
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
    .checklist-item {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .checklist-checkbox {
      width: 16px;
      height: 16px;
      border: 2px solid #333;
      border-radius: 2px;
    }
    .checklist-checkbox.checked {
      background: #333;
    }
  </style>
</head>
<body>
  ${title ? `<h1>${escapeHtml(title)}</h1>` : ''}
`

  for (const block of blocks) {
    switch (block.type) {
      case 'header': {
        const level = block.data.level || 1
        const headerText = block.data.text || ''
        html += `<h${level}>${headerText}</h${level}>`
        break
      }

      case 'paragraph': {
        const paragraphText = block.data.text || ''
        html += `<p>${paragraphText}</p>`
        break
      }

      case 'list': {
        const items = block.data.items || []
        const style = block.data.style || 'unordered'
        const listTag = style === 'ordered' ? 'ol' : 'ul'

        html += `<${listTag}>`
        for (const item of items) {
          if (style === 'checklist') {
            const checked = item.checked ? 'checked' : ''
            html += `<li class="checklist-item">
              <div class="checklist-checkbox ${checked}"></div>
              <span>${escapeHtml(item.text)}</span>
            </li>`
          } else {
            const itemText = String(item.text || item.content || item)
            html += `<li>${escapeHtml(itemText)}</li>`
          }
        }
        html += `</${listTag}>`
        break
      }

      case 'code': {
        const codeText = block.data.code || ''
        html += `<pre><code>${escapeHtml(codeText)}</code></pre>`
        break
      }

      case 'delimiter':
        html += '<hr>'
        break

      case 'image': {
        const imageUrl = block.data.file?.url || block.data.url || ''
        const caption = block.data.caption || ''
        html += `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(caption)}" />`
        if (caption) {
          html += `<p><em>${escapeHtml(caption)}</em></p>`
        }
        break
      }

      case 'table':
        if (block.data.content) {
          html += convertTableToHTML(block.data.content)
        }
        break

      case 'excalidraw': {
        const excalidrawUrl = block.data.file?.url || block.data.url || ''
        html += `<p><em>Excalidraw drawing:</em></p>`
        html += `<img src="${escapeHtml(excalidrawUrl)}" alt="Excalidraw drawing" />`
        break
      }

      case 'kanban':
        html += `<p><em>Kanban board</em></p>`
        break

      default:
        break
    }
  }

  html += `
</body>
</html>`

  return html
}

/**
 * Converts table content to HTML format
 * @param {Object} tableData - Table data from UniverSheetTool
 * @returns {string} HTML formatted table
 */
function convertTableToHTML(tableData) {
  let html = '<table>'

  if (tableData.rows && Array.isArray(tableData.rows)) {
    for (const row of tableData.rows) {
      html += '<tr>'
      if (row.cells && Array.isArray(row.cells)) {
        for (const cell of row.cells) {
          const cellValue = cell?.value || ''
          html += `<td>${escapeHtml(cellValue)}</td>`
        }
      }
      html += '</tr>'
    }
  }

  html += '</table>'
  return html
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
