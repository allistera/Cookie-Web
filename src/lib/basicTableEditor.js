// Plain tables keep the legacy content-grid shape and need no spreadsheet runtime.
export function supportsBasicTable(data) {
  return (
    !data.workbook &&
    !(data.content ?? []).some((row) =>
      row.some((cell) =>
        String(cell)
          .replace(/<[^>]+>/g, '')
          .trim()
          .startsWith('='),
      ),
    )
  )
}

export function basicTableEditor(data, onChange, openSpreadsheet) {
  const root = document.createElement('div')
  root.className = 'basic-table-editor'
  const cells = (
    data.content?.length
      ? data.content
      : [
          ['', ''],
          ['', ''],
        ]
  ).map((row) => [...row])
  const table = document.createElement('table')
  table.setAttribute('aria-label', 'Table cells')
  const body = document.createElement('tbody')
  table.append(body)
  root.append(table)
  const save = () => onChange({ ...data, content: cells.map((row) => [...row]) })
  function renderRows() {
    body.replaceChildren()
    const width = Math.max(1, ...cells.map((row) => row.length))
    cells.forEach((row, rowIndex) => {
      const tr = document.createElement('tr')
      for (let column = 0; column < width; column++) {
        const td = document.createElement('td')
        td.contentEditable = 'plaintext-only'
        td.tabIndex = 0
        td.setAttribute('role', 'textbox')
        td.setAttribute('aria-label', `Row ${rowIndex + 1}, column ${column + 1}`)
        td.textContent = String(row[column] ?? '')
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&')
        td.addEventListener('input', () => {
          row[column] = (td.textContent ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
          save()
        })
        tr.append(td)
      }
      body.append(tr)
    })
  }
  renderRows()
  const actions = document.createElement('div')
  actions.className = 'basic-table-actions'
  function button(label, action) {
    const element = document.createElement('button')
    element.type = 'button'
    element.textContent = label
    element.addEventListener('click', action)
    actions.append(element)
    return element
  }
  button('Add row', () => {
    cells.push(Array(Math.max(1, ...cells.map((row) => row.length))).fill(''))
    renderRows()
    save()
  })
  button('Add column', () => {
    const width = Math.max(1, ...cells.map((row) => row.length))
    cells.forEach((row) => {
      while (row.length < width + 1) row.push('')
    })
    renderRows()
    save()
  })
  const upgrade = button('Open spreadsheet', () => {
    upgrade.disabled = true
    openSpreadsheet(root)
  })
  root.append(actions)
  return root
}
